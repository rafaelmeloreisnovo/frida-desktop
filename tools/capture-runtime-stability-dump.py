#!/usr/bin/env python3
"""Capture one privacy-safe RAFAELIA Frida runtime stability dump V2."""

from __future__ import annotations

import argparse
import datetime as dt
import fcntl
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import threading
from typing import Any

import frida

SCHEMA = "rafaelia.android.runtime-stability/v2"
CHANNEL = "rafaelia.android.runtime.stability"
DEFAULT_MAX_BYTES = 8 * 1024 * 1024


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    target = parser.add_mutually_exclusive_group()
    target.add_argument("--pid", type=int)
    target.add_argument("--process", default="Gadget")

    transport = parser.add_mutually_exclusive_group()
    transport.add_argument("--endpoint", default="127.0.0.1:27042")
    transport.add_argument("--usb", action="store_true")

    parser.add_argument(
        "--allow-remote",
        action="store_true",
        help="Allow a non-loopback Frida endpoint. Off by default.",
    )
    parser.add_argument(
        "--agent",
        type=Path,
        default=Path(__file__).resolve().parents[1]
        / "agents"
        / "android-runtime-stability-dump.js",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=Path.home()
        / ".local"
        / "state"
        / "rafaelia"
        / "frida-runtime-stability",
    )
    parser.add_argument("--timeout-seconds", type=float, default=10.0)
    parser.add_argument("--max-bytes", type=int, default=DEFAULT_MAX_BYTES)
    return parser.parse_args()


def endpoint_host(endpoint: str) -> str:
    endpoint = endpoint.strip()
    if endpoint.startswith("["):
        end = endpoint.find("]")
        if end < 0:
            raise ValueError("invalid bracketed endpoint")
        return endpoint[1:end]
    if ":" not in endpoint:
        return endpoint
    return endpoint.rsplit(":", 1)[0]


def endpoint_is_loopback(endpoint: str) -> bool:
    host = endpoint_host(endpoint)
    if host.lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def resolve_device(args: argparse.Namespace):
    import frida

    if args.usb:
        return frida.get_usb_device(timeout=int(args.timeout_seconds * 1000))

    if not args.allow_remote and not endpoint_is_loopback(args.endpoint):
        raise RuntimeError(
            "non-loopback endpoint refused; pass --allow-remote only for an "
            "explicitly authorized target"
        )

    manager = frida.get_device_manager()
    return manager.add_remote_device(args.endpoint)


def resolve_pid(device: Any, args: argparse.Namespace) -> int:
    if args.pid is not None:
        return args.pid

    for process in device.enumerate_processes():
        if process.name == args.process:
            return process.pid
    raise RuntimeError("authorized target process was not found")


def validate_dump(dump: dict[str, Any]) -> None:
    if dump.get("schema") != SCHEMA:
        raise RuntimeError(
            f"unexpected dump schema: {dump.get('schema', 'TOKEN_VAZIO')}"
        )
    if dump.get("claim_allowed") is not False:
        raise RuntimeError("dump must keep claim_allowed=false")

    for section in ("stable_identity", "instrumentation_identity", "visibility", "runtime_state"):
        if not isinstance(dump.get(section), dict):
            raise RuntimeError(f"missing required section: {section}")

    forbidden_runtime_keys = {
        "process_name",
        "device_serial",
        "android_id",
        "sim_serial",
        "subscriber_id",
        "clipboard",
        "credential",
        "password",
        "network_payload",
    }

    def scan(value: Any, path: str) -> None:
        if isinstance(value, dict):
            for key, nested in value.items():
                lowered = str(key).lower()
                if lowered in forbidden_runtime_keys:
                    raise RuntimeError(f"forbidden runtime key at {path}.{key}")
                scan(nested, f"{path}.{key}")
        elif isinstance(value, list):
            for index, nested in enumerate(value):
                scan(nested, f"{path}[{index}]")

    scan(dump["stable_identity"], "stable_identity")
    scan(dump["runtime_state"], "runtime_state")


def encode_dump(dump: dict[str, Any], max_bytes: int) -> tuple[bytes, str]:
    encoded = (
        json.dumps(dump, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    ).encode("utf-8")
    if len(encoded) > max_bytes:
        raise RuntimeError(
            f"dump exceeds configured size ceiling: {len(encoded)} > {max_bytes}"
        )
    return encoded, hashlib.sha256(encoded).hexdigest()


def append_hash_chain(
    out_dir: Path,
    *,
    filename: str,
    digest: str,
    dump: dict[str, Any],
) -> str:
    ledger_path = out_dir / "ledger.jsonl"
    fd = os.open(ledger_path, os.O_RDWR | os.O_CREAT | os.O_APPEND, 0o600)
    previous = "GENESIS"
    with os.fdopen(fd, "r+b", buffering=0) as ledger:
        fcntl.flock(ledger.fileno(), fcntl.LOCK_EX)
        ledger.seek(0)
        lines = [line for line in ledger.read().splitlines() if line.strip()]
        if lines:
            try:
                previous_record = json.loads(lines[-1].decode("utf-8"))
                previous = str(
                    previous_record.get("dump_sha256", "TOKEN_VAZIO")
                )
            except Exception:
                previous = "TOKEN_VAZIO_LEDGER_PARSE"

        record = {
            "schema": "rafaelia.android.runtime-stability-ledger/v1",
            "filename": filename,
            "dump_sha256": digest,
            "previous_dump_sha256": previous,
            "dump_schema": dump.get("schema", "TOKEN_VAZIO"),
            "capture_seq": dump.get("capture_seq", "TOKEN_VAZIO"),
            "wall_end_epoch_ms":
                dump.get("timing", {}).get("wall_end_epoch_ms", "TOKEN_VAZIO"),
            "claim_allowed": False,
        }
        line = (json.dumps(record, sort_keys=True) + "\n").encode("utf-8")
        ledger.seek(0, os.SEEK_END)
        ledger.write(line)
        ledger.flush()
        os.fsync(ledger.fileno())
        fcntl.flock(ledger.fileno(), fcntl.LOCK_UN)

    return previous


def write_append_only(
    out_dir: Path,
    dump: dict[str, Any],
    max_bytes: int,
) -> tuple[Path, str, str]:
    out_dir.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(out_dir, 0o700)
    except OSError:
        pass

    validate_dump(dump)
    encoded, digest = encode_dump(dump, max_bytes)

    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    path = out_dir / f"runtime-stability-{stamp}.json"

    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as handle:
        handle.write(encoded)
        handle.flush()
        os.fsync(handle.fileno())

    sha_path = Path(str(path) + ".sha256")
    sha_line = f"{digest}  {path.name}\n".encode("ascii")
    fd = os.open(sha_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as handle:
        handle.write(sha_line)
        handle.flush()
        os.fsync(handle.fileno())

    previous = append_hash_chain(
        out_dir,
        filename=path.name,
        digest=digest,
        dump=dump,
    )
    return path, digest, previous


def main() -> int:
    args = parse_args()
    if args.max_bytes <= 0:
        raise SystemExit("--max-bytes must be > 0")

    source = args.agent.read_text(encoding="utf-8")
    device = resolve_device(args)
    pid = resolve_pid(device, args)

    session = None
    script = None
    done = threading.Event()
    holder: dict[str, Any] = {}

    def on_message(message: dict[str, Any], data: Any) -> None:
        if message.get("type") != "send":
            if message.get("type") == "error":
                holder["error"] = (
                    message.get("stack")
                    or message.get("description")
                    or "Frida agent error"
                )
                done.set()
            return

        payload = message.get("payload")
        if not isinstance(payload, dict):
            return
        if (
            payload.get("schema") == SCHEMA
            and payload.get("channel") == CHANNEL
            and payload.get("kind") == "RUNTIME_STABILITY_DUMP"
            and isinstance(payload.get("dump"), dict)
        ):
            holder["dump"] = payload["dump"]
            done.set()

    try:
        session = device.attach(pid)
        script = session.create_script(source)
        script.on("message", on_message)
        script.load()

        if not done.wait(args.timeout_seconds):
            raise TimeoutError("runtime stability dump timed out")
        if "error" in holder:
            raise RuntimeError(str(holder["error"]))

        dump = holder.get("dump")
        if not isinstance(dump, dict):
            raise RuntimeError("agent returned no stability dump")

        path, digest, previous = write_append_only(
            args.out_dir, dump, args.max_bytes
        )

        print("RAFAELIA_RUNTIME_STABILITY_DUMP_PASS")
        print(f"receipt={path}")
        print(f"sha256={digest}")
        print(f"previous_sha256={previous}")
        print("ledger=ledger.jsonl")
        print("target_name_persisted=NO")
        print("endpoint_persisted=NO")
        print("pid_in_dump=YES_VOLATILE_RUNTIME_STATE")
        print("claim_allowed=false")
        return 0
    finally:
        if script is not None:
            try:
                script.unload()
            except Exception:
                pass
        if session is not None:
            try:
                session.detach()
            except Exception:
                pass


if __name__ == "__main__":
    raise SystemExit(main())

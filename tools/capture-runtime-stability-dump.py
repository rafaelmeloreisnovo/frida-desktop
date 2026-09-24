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
import re
import shutil
import uuid
from pathlib import Path
import threading
from typing import Any

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
    parser.add_argument(
        "--condition-id",
        default="UNSPECIFIED",
        help="Comparability label: 1-64 chars [A-Za-z0-9_.-].",
    )
    parser.add_argument("--max-dumps", type=int, default=256)
    parser.add_argument("--max-dir-bytes", type=int, default=64 * 1024 * 1024)
    parser.add_argument("--min-free-bytes", type=int, default=16 * 1024 * 1024)
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



CONDITION_RE = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")


def validate_condition_id(value: str) -> str:
    if not CONDITION_RE.fullmatch(value):
        raise ValueError("--condition-id must match [A-Za-z0-9_.-]{1,64}")
    return value


def collect_controller_context(args: argparse.Namespace) -> dict[str, Any]:
    same_device = not args.usb and endpoint_is_loopback(args.endpoint)
    context: dict[str, Any] = {
        "causal_role": "CONTEXT_ONLY",
        "same_device_target": same_device,
        "scope": (
            "CONTROLLER_LOCAL_ANDROID_SAME_DEVICE_TARGET"
            if same_device
            else "NOT_COLLECTED_REMOTE_OR_USB_TARGET"
        ),
        "boot_session_sha256": "TOKEN_VAZIO",
    }
    if not same_device:
        return context

    try:
        boot_id = Path("/proc/sys/kernel/random/boot_id").read_text(
            encoding="ascii"
        ).strip()
        if boot_id:
            context["boot_session_sha256"] = hashlib.sha256(
                boot_id.encode("ascii")
            ).hexdigest()
    except Exception:
        pass
    return context


def retention_preflight(
    out_dir: Path,
    *,
    max_dumps: int,
    max_dir_bytes: int,
    min_free_bytes: int,
    max_next_bytes: int,
) -> None:
    if max_dumps < 1 or max_dir_bytes < 1 or min_free_bytes < 0:
        raise ValueError("invalid retention limits")
    out_dir.mkdir(parents=True, exist_ok=True)
    dumps = list(out_dir.glob("runtime-stability-*.json"))
    if len(dumps) >= max_dumps:
        raise RuntimeError(
            f"dump retention limit reached: {len(dumps)} >= {max_dumps}; "
            "no evidence was deleted automatically"
        )
    total = sum(p.stat().st_size for p in out_dir.iterdir() if p.is_file())
    if total + max_next_bytes > max_dir_bytes:
        raise RuntimeError(
            "dump directory byte bound would be exceeded; "
            "no evidence was deleted automatically"
        )
    free = shutil.disk_usage(out_dir).free
    if free - max_next_bytes < min_free_bytes:
        raise RuntimeError("insufficient free-space reserve for evidence capture")


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
    validate_condition_id(args.condition_id)
    retention_preflight(
        args.out_dir,
        max_dumps=args.max_dumps,
        max_dir_bytes=args.max_dir_bytes,
        min_free_bytes=args.min_free_bytes,
        max_next_bytes=args.max_bytes + 4096,
    )

    source = args.agent.read_text(encoding="utf-8")
    agent_sha256 = hashlib.sha256(source.encode("utf-8")).hexdigest()
    controller_sha256 = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    controller_run_id = str(uuid.uuid4())
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

        import frida

        dump["capture_provenance"] = {
            "agent_sha256": agent_sha256,
            "controller_sha256": controller_sha256,
            "frida_python_version": getattr(frida, "__version__", "TOKEN_VAZIO"),
            "controller_run_id": controller_run_id,
            "condition_id": args.condition_id,
            "condition_semantics": (
                "EXPLICIT_COMPARABILITY_LABEL"
                if args.condition_id != "UNSPECIFIED"
                else "UNSPECIFIED_DESCRIPTIVE_ONLY"
            ),
            "transport_selector_persisted": False,
            "target_selector_persisted": False,
        }
        dump["platform_context"] = collect_controller_context(args)

        path, digest, previous = write_append_only(
            args.out_dir, dump, args.max_bytes
        )

        print("RAFAELIA_RUNTIME_STABILITY_DUMP_PASS")
        print(f"receipt={path}")
        print(f"sha256={digest}")
        print(f"previous_sha256={previous}")
        print("ledger=ledger.jsonl")
        print(f"agent_sha256={agent_sha256}")
        print(f"controller_sha256={controller_sha256}")
        print(f"controller_run_id={controller_run_id}")
        print(f"condition_id={args.condition_id}")
        print(f"max_dumps={args.max_dumps}")
        print(f"max_dir_bytes={args.max_dir_bytes}")
        print(f"min_free_bytes={args.min_free_bytes}")
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

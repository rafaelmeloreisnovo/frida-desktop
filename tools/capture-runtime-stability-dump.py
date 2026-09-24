#!/usr/bin/env python3
"""Capture one privacy-safe RAFAELIA Frida runtime stability dump.

This controller writes only the sanitized dump emitted by
agents/android-runtime-stability-dump.js. Target-selection inputs are used
only to attach and are not persisted as identity metadata.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import shutil
import threading
from typing import Any

import frida


SCHEMA = "rafaelia.android.runtime-stability/v1"
CHANNEL = "rafaelia.android.runtime.stability"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    target = parser.add_mutually_exclusive_group()
    target.add_argument("--pid", type=int)
    target.add_argument("--process", default="Gadget")
    transport = parser.add_mutually_exclusive_group()
    transport.add_argument("--endpoint", default="127.0.0.1:27042")
    transport.add_argument("--usb", action="store_true")
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
    parser.add_argument("--max-dumps", type=int, default=256)
    parser.add_argument("--max-dir-bytes", type=int, default=64 * 1024 * 1024)
    parser.add_argument("--min-free-bytes", type=int, default=16 * 1024 * 1024)
    return parser.parse_args()


def canonical_sha256(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def strong_fingerprints(dump: dict[str, Any]) -> dict[str, str]:
    identity = dump.get("stable_identity", "TOKEN_VAZIO")
    rows = (
        dump.get("runtime_state", {})
        .get("modules", {})
        .get("modules", [])
    )
    module_surface = []
    if isinstance(rows, list):
        for row in rows:
            if not isinstance(row, dict):
                continue
            name = row.get("name")
            size = row.get("size")
            if isinstance(name, str) and isinstance(size, int):
                module_surface.append({"name": name, "size": size})
    module_surface.sort(key=lambda row: (row["name"], row["size"]))

    identity_sha = canonical_sha256(identity)
    module_sha = canonical_sha256(module_surface)
    recognition_sha = hashlib.sha256(
        f"{identity_sha}|{module_sha}".encode("ascii")
    ).hexdigest()
    return {
        "stable_identity_sha256": identity_sha,
        "module_surface_sha256": module_sha,
        "recognition_sha256": recognition_sha,
        "role": "DERIVED_SHORTCUT_STRUCTURE_REMAINS_AUTHORITATIVE",
    }


def resolve_device(args: argparse.Namespace):
    if args.usb:
        return frida.get_usb_device(timeout=int(args.timeout_seconds * 1000))
    manager = frida.get_device_manager()
    return manager.add_remote_device(args.endpoint)


def resolve_pid(device: Any, args: argparse.Namespace) -> int:
    if args.pid is not None:
        return args.pid

    for process in device.enumerate_processes():
        if process.name == args.process:
            return process.pid
    raise RuntimeError("authorized target process was not found")


def _fsync_directory(path: Path) -> None:
    flags = os.O_RDONLY
    if hasattr(os, "O_DIRECTORY"):
        flags |= os.O_DIRECTORY
    fd = os.open(path, flags)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _publish_exclusive(path: Path, data: bytes) -> None:
    temp = path.parent / f".{path.name}.tmp.{os.getpid()}"
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "wb", closefd=True) as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        if path.exists():
            raise FileExistsError(path)
        os.link(temp, path)
        _fsync_directory(path.parent)
    finally:
        try:
            temp.unlink()
        except FileNotFoundError:
            pass


def _retention_preflight(
    out_dir: Path,
    encoded_bytes: int,
    max_dumps: int,
    max_dir_bytes: int,
    min_free_bytes: int,
) -> None:
    if max_dumps < 1 or max_dir_bytes < 1 or min_free_bytes < 0:
        raise ValueError("retention limits must be positive (min_free_bytes may be zero)")

    dumps = list(out_dir.glob("runtime-stability-*.json"))
    if len(dumps) >= max_dumps:
        raise RuntimeError(
            f"dump retention limit reached: {len(dumps)} >= {max_dumps}; "
            "no evidence was deleted automatically"
        )

    total_bytes = sum(
        item.stat().st_size
        for item in out_dir.iterdir()
        if item.is_file()
    )
    if total_bytes + encoded_bytes > max_dir_bytes:
        raise RuntimeError(
            f"dump directory byte limit would be exceeded: "
            f"{total_bytes + encoded_bytes} > {max_dir_bytes}; "
            "no evidence was deleted automatically"
        )

    free_bytes = shutil.disk_usage(out_dir).free
    if free_bytes - encoded_bytes < min_free_bytes:
        raise RuntimeError(
            f"insufficient free-space reserve: free={free_bytes} "
            f"encoded={encoded_bytes} reserve={min_free_bytes}"
        )


def write_append_only(
    out_dir: Path,
    dump: dict[str, Any],
    *,
    max_dumps: int,
    max_dir_bytes: int,
    min_free_bytes: int,
) -> tuple[Path, str]:
    out_dir.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(out_dir, 0o700)
    except OSError:
        pass

    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    encoded = (
        json.dumps(
            dump,
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
            allow_nan=False,
        )
        + "\n"
    ).encode("utf-8")
    digest = hashlib.sha256(encoded).hexdigest()

    _retention_preflight(
        out_dir,
        len(encoded),
        max_dumps,
        max_dir_bytes,
        min_free_bytes,
    )

    path = out_dir / f"runtime-stability-{stamp}.json"
    sha_path = Path(str(path) + ".sha256")
    sha_line = f"{digest}  {path.name}\n".encode("ascii")

    _publish_exclusive(path, encoded)
    _publish_exclusive(sha_path, sha_line)
    return path, digest


def main() -> int:
    args = parse_args()
    source = args.agent.read_text(encoding="utf-8")
    agent_sha256 = hashlib.sha256(source.encode("utf-8")).hexdigest()
    controller_path = Path(__file__).resolve()
    controller_sha256 = hashlib.sha256(controller_path.read_bytes()).hexdigest()

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

        dump["strong_fingerprints"] = strong_fingerprints(dump)
        dump["capture_provenance"] = {
            "agent_sha256": agent_sha256,
            "controller_sha256": controller_sha256,
            "frida_python_version": getattr(frida, "__version__", "TOKEN_VAZIO"),
            "transport_selector_persisted": False,
            "target_selector_persisted": False,
            "source_binding": "LOCAL_FILE_SHA256",
        }

        path, digest = write_append_only(
            args.out_dir,
            dump,
            max_dumps=args.max_dumps,
            max_dir_bytes=args.max_dir_bytes,
            min_free_bytes=args.min_free_bytes,
        )
        print("RAFAELIA_RUNTIME_STABILITY_DUMP_PASS")
        print(f"receipt={path}")
        print(f"sha256={digest}")
        print("target_name_persisted=NO")
        print("endpoint_persisted=NO")
        print("pid_in_dump=YES_VOLATILE_RUNTIME_STATE")
        print(f"agent_sha256={agent_sha256}")
        print(f"controller_sha256={controller_sha256}")
        print(f"max_dumps={args.max_dumps}")
        print(f"max_dir_bytes={args.max_dir_bytes}")
        print(f"min_free_bytes={args.min_free_bytes}")
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

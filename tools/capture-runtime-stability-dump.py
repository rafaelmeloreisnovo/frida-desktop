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
    return parser.parse_args()


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


def write_append_only(out_dir: Path, dump: dict[str, Any]) -> tuple[Path, str]:
    out_dir.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(out_dir, 0o700)
    except OSError:
        pass

    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    encoded = (
        json.dumps(dump, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    ).encode("utf-8")
    digest = hashlib.sha256(encoded).hexdigest()

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

    return path, digest


def main() -> int:
    args = parse_args()
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

        path, digest = write_append_only(args.out_dir, dump)
        print("RAFAELIA_RUNTIME_STABILITY_DUMP_PASS")
        print(f"receipt={path}")
        print(f"sha256={digest}")
        print("target_selector_persisted=NO")
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

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
import subprocess
import threading
from typing import Any
import uuid

import frida

from runtime_stability_storage import (
    latest_dump_sha256,
    strong_fingerprints,
    write_append_only,
)


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
        "--allow-remote-endpoint",
        action="store_true",
        help="explicitly permit a non-loopback Frida endpoint",
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
    parser.add_argument("--max-dumps", type=int, default=256)
    parser.add_argument("--max-dir-bytes", type=int, default=64 * 1024 * 1024)
    parser.add_argument("--min-free-bytes", type=int, default=16 * 1024 * 1024)
    return parser.parse_args()


def is_loopback_endpoint(endpoint: str) -> bool:
    value = endpoint.strip().lower()
    if value.startswith("["):
        host = value[1:value.find("]")] if "]" in value else value
    else:
        host = value.rsplit(":", 1)[0] if ":" in value else value
    return host in {"127.0.0.1", "localhost", "::1"}


def resolve_device(args: argparse.Namespace):
    if args.usb:
        return frida.get_usb_device(timeout=int(args.timeout_seconds * 1000))
    if not is_loopback_endpoint(args.endpoint) and not args.allow_remote_endpoint:
        raise ValueError(
            "non-loopback Frida endpoint requires --allow-remote-endpoint"
        )
    manager = frida.get_device_manager()
    return manager.add_remote_device(args.endpoint)



SAFE_GETPROP_KEYS = [
    "sys.use_memfd",
    "init.svc.ashmemd",
    "init.svc.hidl_memory",
    "init.svc.lmkd",
    "init.svc.tombstoned",
    "init.svc.traced",
    "init.svc.traced_probes",
    "init.svc.aee_aed",
    "ro.config.per_app_memcg",
    "ro.lmk.downgrade_pressure",
    "ro.zygote",
    "ro.product.cpu.abilist64",
    "ro.boot.verifiedbootstate",
    "ro.boot.veritymode",
    "ro.crypto.state",
    "ro.crypto.type",
    "ro.build.ab_update",
    "ro.boot.dynamic_partitions",
    "ro.boot.slot_suffix",
    "ro.debuggable",
    "ro.secure",
    "ro.vendor.mediatek.platform",
    "ro.boot.hardware",
    "ro.board.platform",
]

MEMINFO_KEYS = {
    "MemTotal",
    "MemFree",
    "MemAvailable",
    "Buffers",
    "Cached",
    "SwapTotal",
    "SwapFree",
    "Dirty",
    "SReclaimable",
    "Shmem",
}


def collect_local_android_context() -> dict[str, Any]:
    getprop = "/system/bin/getprop"
    if not Path(getprop).exists():
        candidate = shutil.which("getprop")
        if candidate is None:
            return {
                "scope": "TOKEN_VAZIO_NOT_LOCAL_ANDROID",
                "causal_role": "CONTEXT_ONLY",
            }
        getprop = candidate

    properties: dict[str, str] = {}
    for key in SAFE_GETPROP_KEYS:
        try:
            value = subprocess.check_output(
                [getprop, key],
                stderr=subprocess.DEVNULL,
                text=True,
                timeout=1.0,
            ).rstrip("\n")
            properties[key] = value
        except Exception:
            properties[key] = "TOKEN_VAZIO"

    memory: dict[str, int] = {}
    try:
        for line in Path("/proc/meminfo").read_text(encoding="utf-8").splitlines():
            key, _, rest = line.partition(":")
            if key not in MEMINFO_KEYS:
                continue
            token = rest.strip().split()[0]
            memory[f"{key}_kb"] = int(token)
    except Exception:
        memory = {}

    pressure: dict[str, dict[str, float | int | str]] = {}
    pressure_path = Path("/proc/pressure/memory")
    if pressure_path.exists():
        try:
            for line in pressure_path.read_text(encoding="utf-8").splitlines():
                parts = line.split()
                if not parts:
                    continue
                row: dict[str, float | int | str] = {}
                for item in parts[1:]:
                    key, _, raw = item.partition("=")
                    if not key:
                        continue
                    try:
                        row[key] = int(raw) if key == "total" else float(raw)
                    except ValueError:
                        row[key] = raw
                pressure[parts[0]] = row
        except Exception:
            pressure = {}

    uname = os.uname()
    return {
        "scope": "CONTROLLER_LOCAL_ANDROID",
        "causal_role": "CONTEXT_ONLY",
        "properties": properties,
        "memory": memory if memory else "TOKEN_VAZIO",
        "psi_memory": pressure if pressure else "TOKEN_VAZIO",
        "kernel": {
            "sysname": uname.sysname,
            "release": uname.release,
            "machine": uname.machine,
        },
        "privacy": "ALLOWLISTED_STRUCTURAL_AND_RESOURCE_METRICS_ONLY",
    }


def resolve_pid(device: Any, args: argparse.Namespace) -> int:
    if args.pid is not None:
        return args.pid

    for process in device.enumerate_processes():
        if process.name == args.process:
            return process.pid
    raise RuntimeError("authorized target process was not found")


def main() -> int:
    args = parse_args()
    source = args.agent.read_text(encoding="utf-8")
    agent_sha256 = hashlib.sha256(source.encode("utf-8")).hexdigest()
    controller_path = Path(__file__).resolve()
    controller_sha256 = hashlib.sha256(controller_path.read_bytes()).hexdigest()
    controller_run_id = str(uuid.uuid4())
    previous_dump_sha256 = latest_dump_sha256(args.out_dir)

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
        dump["platform_context"] = collect_local_android_context()
        dump["capture_provenance"] = {
            "agent_sha256": agent_sha256,
            "controller_sha256": controller_sha256,
            "frida_python_version": getattr(frida, "__version__", "TOKEN_VAZIO"),
            "transport_selector_persisted": False,
            "target_selector_persisted": False,
            "source_binding": "LOCAL_FILE_SHA256",
            "controller_run_id": controller_run_id,
            "previous_dump_sha256": previous_dump_sha256,
            "chain_semantics": "LOCAL_APPEND_ORDER_INTEGRITY_NOT_CAUSALITY",
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
        print(f"controller_run_id={controller_run_id}")
        print(f"previous_dump_sha256={previous_dump_sha256}")
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

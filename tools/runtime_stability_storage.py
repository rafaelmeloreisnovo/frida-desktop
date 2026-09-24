#!/usr/bin/env python3
"""Crash-consistent local storage helpers for runtime stability dumps."""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import shutil
from typing import Any


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
    module_surface_observed = isinstance(rows, list)
    if module_surface_observed:
        for row in rows:
            if not isinstance(row, dict):
                continue
            name = row.get("name")
            size = row.get("size")
            if isinstance(name, str) and isinstance(size, int):
                module_surface.append({"name": name, "size": size})
        module_surface.sort(key=lambda row: (row["name"], row["size"]))

    identity_sha = canonical_sha256(identity)
    module_sha = (
        canonical_sha256(module_surface)
        if module_surface_observed
        else "TOKEN_VAZIO"
    )
    recognition_sha = (
        hashlib.sha256(f"{identity_sha}|{module_sha}".encode("ascii")).hexdigest()
        if module_sha != "TOKEN_VAZIO"
        else "TOKEN_VAZIO"
    )
    return {
        "stable_identity_sha256": identity_sha,
        "module_surface_sha256": module_sha,
        "recognition_sha256": recognition_sha,
        "role": "DERIVED_SHORTCUT_STRUCTURE_REMAINS_AUTHORITATIVE",
    }


def fsync_directory(path: Path) -> None:
    flags = os.O_RDONLY
    if hasattr(os, "O_DIRECTORY"):
        flags |= os.O_DIRECTORY
    fd = os.open(path, flags)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def publish_exclusive(path: Path, data: bytes) -> None:
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
        fsync_directory(path.parent)
    finally:
        try:
            temp.unlink()
        except FileNotFoundError:
            pass


def validate_directory_integrity(out_dir: Path) -> None:
    temp_artifacts = list(out_dir.glob(".runtime-stability-*.tmp.*"))
    if temp_artifacts:
        raise RuntimeError(
            "incomplete temporary dump artifacts require manual inspection: "
            + ", ".join(item.name for item in temp_artifacts)
        )

    dumps = sorted(out_dir.glob("runtime-stability-*.json"))
    sidecars = sorted(out_dir.glob("runtime-stability-*.json.sha256"))

    expected_sidecars = {Path(str(item) + ".sha256") for item in dumps}
    orphan_sidecars = [item for item in sidecars if Path(str(item)[:-7]) not in dumps]
    missing_sidecars = [item for item in expected_sidecars if not item.exists()]

    if orphan_sidecars or missing_sidecars:
        raise RuntimeError(
            "dump directory integrity mismatch: orphan_sidecars="
            + ",".join(item.name for item in orphan_sidecars)
            + " missing_sidecars="
            + ",".join(item.name for item in missing_sidecars)
        )

    for dump in dumps:
        digest = hashlib.sha256(dump.read_bytes()).hexdigest()
        sidecar = Path(str(dump) + ".sha256")
        line = sidecar.read_text(encoding="ascii").strip().split()
        if len(line) != 2 or line[0] != digest or line[1] != dump.name:
            raise RuntimeError(
                f"dump integrity verification failed for {dump.name}"
            )


def retention_preflight(
    out_dir: Path,
    encoded_bytes: int,
    max_dumps: int,
    max_dir_bytes: int,
    min_free_bytes: int,
) -> None:
    if max_dumps < 1 or max_dir_bytes < 1 or min_free_bytes < 0:
        raise ValueError(
            "retention limits must be positive (min_free_bytes may be zero)"
        )

    dumps = list(out_dir.glob("runtime-stability-*.json"))
    if len(dumps) >= max_dumps:
        raise RuntimeError(
            f"dump retention limit reached: {len(dumps)} >= {max_dumps}; "
            "no evidence was deleted automatically"
        )

    validate_directory_integrity(out_dir)

    total_bytes = sum(
        item.stat().st_size
        for item in out_dir.iterdir()
        if item.is_file()
    )
    if total_bytes + encoded_bytes > max_dir_bytes:
        raise RuntimeError(
            "dump directory byte limit would be exceeded: "
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

    path = out_dir / f"runtime-stability-{stamp}.json"
    sha_path = Path(str(path) + ".sha256")
    sha_line = f"{digest}  {path.name}\n".encode("ascii")

    retention_preflight(
        out_dir,
        len(encoded) + len(sha_line),
        max_dumps,
        max_dir_bytes,
        min_free_bytes,
    )

    publish_exclusive(path, encoded)
    publish_exclusive(sha_path, sha_line)
    return path, digest

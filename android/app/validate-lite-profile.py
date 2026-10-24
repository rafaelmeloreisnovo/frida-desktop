#!/usr/bin/env python3
"""Bounded Android lite dependency and artifact-footprint gate (stdlib only).

STATIC PASS is not a Gradle build, Frida attachment, or physical-device PASS.
The default operator excludes archived research UI/bridge Java sources without
deleting or changing their bytes. Artifacts are inventoried only when supplied.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys

REPO = Path(__file__).resolve().parents[2]
ACTIVE = REPO / "android/app/src/io/rafaelia/fridalab/MainActivity.java"
BUILD = REPO / "android/app/build.gradle"
EXCLUDES = (
    "java.exclude 'io/rafaelia/fridalab/learning/**'",
    "java.exclude 'io/rafaelia/fridalab/ui/**'",
)
ALLOWED_IMPORTS = ("android.", "java.", "javax.", "org.json.")
RUNTIME_DEP = re.compile(
    r"(?m)^\s*(?:implementation|api|runtimeOnly|compileOnly)\s*\(?\s*['\"]"
)
IMPORT = re.compile(r"(?m)^\s*import\s+([\w.]+)\s*;")
SUFFIXES = {".apk", ".so", ".dex", ".elf"}


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def inspect_artifacts(roots):
    results = []
    for root_name in roots:
        root = Path(root_name).resolve()
        if not root.is_dir():
            raise ValueError("artifact directory missing: " + str(root))
        for file in sorted(root.rglob("*")):
            if not file.is_file() or file.is_symlink() or file.suffix.lower() not in SUFFIXES:
                continue
            results.append({
                "root": str(root),
                "path": str(file.relative_to(root)),
                "bytes": file.stat().st_size,
                "sha256": sha256(file),
            })
    return results


def validate():
    build = BUILD.read_text(encoding="utf-8")
    activity = ACTIVE.read_text(encoding="utf-8")
    checks = {
        "legacy_sources_excluded": all(item in build for item in EXCLUDES),
        "no_declared_external_runtime_libraries": RUNTIME_DEP.search(build) is None,
        "active_screen_has_only_platform_imports": all(
            name.startswith(ALLOWED_IMPORTS) for name in IMPORT.findall(activity)
        ),
        "active_screen_does_not_reference_legacy_ui": not re.search(
            r"\b(?:ResearchModePanel|MetricsPoller|RFLBridge)\b", activity
        ),
        "native_gadget_and_probe_unmodified_by_this_gate": True,
    }
    # The last check refers only to this read-only validator's own behavior.
    return checks


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifact-root", action="append", default=[],
                        help="Directory containing built APK/ELF/DEX files; repeatable")
    parser.add_argument("--receipt", help="New JSON receipt path (exclusive create)")
    opts = parser.parse_args()
    failures = []
    try:
        checks = validate()
        artifacts = inspect_artifacts(opts.artifact_root)
        if opts.artifact_root and not any(row["path"].endswith(".apk") for row in artifacts):
            failures.append("NO_APK_IN_ARTIFACT_ROOTS")
    except (OSError, ValueError) as exc:
        checks, artifacts = {}, []
        failures.append(type(exc).__name__ + ": " + str(exc))
    failures.extend(name for name, good in checks.items() if not good)
    report = {
        "schema": "rafaelia.frida.android-lite-footprint.v1",
        "source_ref": os.environ.get("RAFAELIA_SOURCE_SHA") or "TOKEN_VAZIO_SOURCE_REF",
        "static_gate": "PASS_SCOPED" if not failures else "FAIL",
        "build_execution": "TOKEN_VAZIO_NOT_PERFORMED_BY_VALIDATOR",
        "physical_runtime": "TOKEN_VAZIO_NOT_OBSERVED",
        "memory_rss": "TOKEN_VAZIO_NOT_MEASURED",
        "cpu_overhead": "TOKEN_VAZIO_NOT_MEASURED",
        "claim_allowed": False,
        "checks": checks,
        "failures": failures,
        "artifact_count": len(artifacts),
        "artifact_total_bytes": sum(item["bytes"] for item in artifacts),
        "artifacts": artifacts,
    }
    encoded = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if opts.receipt:
        dest = Path(opts.receipt)
        dest.parent.mkdir(parents=True, exist_ok=True)
        with dest.open("x", encoding="utf-8") as stream:
            stream.write(encoded)
    print(encoded, end="")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

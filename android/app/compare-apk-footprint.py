#!/usr/bin/env python3
"""Compare two Android17 APK manifests without promoting unmeasured claims.

An APK ZIP byte delta is not a RAM, install, runtime, or Gradle-size delta.
Dependencies: Python standard library only. Receipts are append-only.
"""
import argparse
import json
from pathlib import Path
import re
import sys

BASE_SCHEMA = "rafaelia.frida.android17.apk_baseline.v1"
CANDIDATE_SCHEMA = "rafaelia.frida.android-lite-footprint.v1"
EXPECTED = frozenset((
    "frida-lab-armv7-debug.apk",
    "frida-lab-arm64-debug.apk",
    "frida-lab-universal-debug.apk",
    "frida-lab-physical-universal-debug.apk",
))
HASH = re.compile(r"[0-9a-f]{64}\Z")
GIT_SHA = re.compile(r"[0-9a-f]{40}\Z")


def checked_artifact(record):
    if not isinstance(record, dict):
        raise ValueError("artifact is not an object")
    size, digest = record.get("bytes"), record.get("sha256")
    if type(size) is not int or size < 0:
        raise ValueError("invalid APK size")
    if not isinstance(digest, str) or not HASH.fullmatch(digest):
        raise ValueError("invalid APK SHA-256")
    return {"bytes": size, "sha256": digest}


def compare(baseline, candidate, source_sha, frida_version):
    """Return typed evidence; all invalid inputs raise ValueError (fail closed)."""
    if not isinstance(baseline, dict) or baseline.get("schema") != BASE_SCHEMA:
        raise ValueError("unknown baseline schema")
    if not isinstance(candidate, dict) or candidate.get("schema") != CANDIDATE_SCHEMA:
        raise ValueError("unknown candidate schema")
    if baseline.get("route") != "android17-apk-elf-dex":
        raise ValueError("baseline build route unknown")
    if baseline.get("gadget_pin") != frida_version:
        raise ValueError("Frida Gadget version mismatch")
    if not isinstance(source_sha, str) or not GIT_SHA.fullmatch(source_sha):
        raise ValueError("candidate source commit not bound to full SHA")
    if candidate.get("source_ref") != source_sha:
        raise ValueError("candidate receipt source does not match head")
    if candidate.get("static_gate") != "PASS_SCOPED" or candidate.get("failures"):
        raise ValueError("candidate structural gate is not PASS_SCOPED")
    if not isinstance(baseline.get("files"), dict) or set(baseline["files"]) != EXPECTED:
        raise ValueError("baseline APK names differ from expected set")
    rows = candidate.get("artifacts")
    if not isinstance(rows, list):
        raise ValueError("candidate artifact list missing")
    apk_records = {}
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("candidate artifact record invalid")
        path = row.get("path")
        if isinstance(path, str) and path.endswith(".apk"):
            if "/" in path or "\\" in path or path not in EXPECTED:
                raise ValueError("unexpected APK path in candidate")
            if path in apk_records:
                raise ValueError("duplicate APK path in candidate")
            apk_records[path] = checked_artifact(row)
    if set(apk_records) != EXPECTED:
        raise ValueError("candidate APK set incomplete")
    deltas = []
    for name in sorted(EXPECTED):
        older = checked_artifact(baseline["files"][name])
        newer = apk_records[name]
        delta = newer["bytes"] - older["bytes"]
        deltas.append({
            "path": name,
            "baseline_bytes": older["bytes"],
            "candidate_bytes": newer["bytes"],
            "delta_bytes": delta,
            "sha256_equal": newer["sha256"] == older["sha256"],
            "byte_identity": ("BYTE_IDENTICAL" if newer["sha256"] == older["sha256"]
                              else "DISTINCT_DIGESTS_NOT_BYTE_IDENTICAL"),
        })
    regressions = [x["path"] for x in deltas if x["delta_bytes"] > 0]
    return {
        "schema": "rafaelia.frida.android17.apk_size_comparison.v1",
        "baseline_run_id": baseline["provenance"]["workflow_run_id"],
        "baseline_head": baseline["provenance"]["source_commit"],
        "candidate_head": source_sha,
        "gadget_pin": frida_version,
        "comparison_scope": "APK_ARCHIVE_BYTES_ONLY_NON_CONTROLLED_CI_RUNS",
        "total_apk_sum_is_installed_size": False,
        "gradle_build_verified": False,
        "physical_rss_verified": False,
        "upstream_frida_freestanding": False,
        "claim_allowed": False,
        "status": "PASS_SCOPED_SIZE_NONREGRESSION" if not regressions else "FAIL_SIZE_REGRESSION",
        "size_regressions": regressions,
        "apks": deltas,
    }


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--baseline", required=True)
    p.add_argument("--candidate", required=True)
    p.add_argument("--source-sha", required=True)
    p.add_argument("--frida-version", required=True)
    p.add_argument("--receipt")
    opts = p.parse_args()
    try:
        baseline = json.loads(Path(opts.baseline).read_text(encoding="utf-8"))
        candidate = json.loads(Path(opts.candidate).read_text(encoding="utf-8"))
        result = compare(baseline, candidate, opts.source_sha, opts.frida_version)
    except (OSError, ValueError, KeyError, TypeError) as exc:
        result = {
            "schema": "rafaelia.frida.android17.apk_size_comparison.v1",
            "status": "FAIL_INPUT_OR_PROVENANCE",
            "reason": "%s: %s" % (type(exc).__name__, exc),
            "claim_allowed": False,
        }
    encoded = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if opts.receipt:
        path = Path(opts.receipt)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("x", encoding="utf-8") as f:
            f.write(encoded)
    print(encoded, end="")
    return 0 if result.get("status") == "PASS_SCOPED_SIZE_NONREGRESSION" else 1


if __name__ == "__main__":
    sys.exit(main())

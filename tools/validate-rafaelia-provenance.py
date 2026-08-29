#!/usr/bin/env python3
"""Fail-closed provenance validator for the RAFAELIA Frida fork.

This validator deliberately separates three different facts:
  1. upstream material is present and governed by upstream terms;
  2. a path changed in this fork relative to a pinned baseline;
  3. authorship/origin of the changed hunks.

A fork delta is not, by itself, proof of exclusive authorship. The validator
therefore generates path-level evidence while keeping hunk-origin claims closed
until separately reviewed.
"""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path
from typing import Any

DEFAULT_MANIFEST = Path("profiles/rafaelia-provenance-scope.v1.json")
DEFAULT_EVIDENCE = Path("evidence/provenance/delta-inventory.v1.json")


def die(msg: str) -> None:
    raise SystemExit(f"FAIL: {msg}")


def git(*args: str) -> str:
    try:
        result = subprocess.run(
            ["git", *args],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
    except subprocess.CalledProcessError as exc:
        detail = exc.stderr.strip() or exc.stdout.strip() or "git command failed"
        die(f"git {' '.join(args)}: {detail}")
    return result.stdout.strip()


def require_dict(value: Any, name: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        die(f"{name} must be an object")
    return value


def parse_name_status(base: str, head: str) -> list[dict[str, Any]]:
    raw = git("diff", "--name-status", "--find-renames", "-z", f"{base}..{head}")
    if not raw:
        return []

    tokens = raw.split("\0")
    if tokens and tokens[-1] == "":
        tokens.pop()

    entries: list[dict[str, Any]] = []
    i = 0
    while i < len(tokens):
        status = tokens[i]
        i += 1
        kind = status[:1]
        if kind in {"R", "C"}:
            if i + 1 >= len(tokens):
                die("malformed rename/copy record in git diff")
            old_path = tokens[i]
            new_path = tokens[i + 1]
            i += 2
            entry = {
                "path": new_path,
                "previous_path": old_path,
                "git_status": status,
                "path_relation": "FORK_DELTA_RENAMED_OR_COPIED_REQUIRES_HUNK_REVIEW",
            }
        else:
            if i >= len(tokens):
                die("malformed path record in git diff")
            path = tokens[i]
            i += 1
            relation = {
                "A": "FORK_DELTA_PATH_ADDED",
                "M": "MIXED_PATH_MODIFIED_REQUIRES_HUNK_REVIEW",
                "D": "UPSTREAM_PATH_REMOVED_IN_FORK",
                "T": "MIXED_PATH_TYPE_CHANGED_REQUIRES_HUNK_REVIEW",
                "U": "UNMERGED_PATH_REQUIRES_RESOLUTION",
            }.get(kind, "TOKEN_VAZIO_UNKNOWN_GIT_STATUS")
            entry = {
                "path": path,
                "git_status": status,
                "path_relation": relation,
            }

        entry["authorship_claimed"] = False
        entry["hunk_origin_state"] = "TOKEN_VAZIO_REQUIRES_ORIGIN_REVIEW"
        entries.append(entry)

    entries.sort(key=lambda item: (item["path"], item["git_status"]))
    return entries


def validate(manifest_path: Path, evidence_path: Path) -> None:
    if not manifest_path.is_file():
        die(f"manifest missing: {manifest_path}")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("schema") != "rafaelia.upstream-delta-provenance.v1":
        die("schema")
    if manifest.get("repository") != "rafaelmeloreisnovo/frida-desktop":
        die("repository identity mismatch")
    if manifest.get("claim_allowed") is not False:
        die("claim_allowed must remain false")

    license_info = require_dict(manifest.get("upstream_license"), "upstream_license")
    if license_info.get("preserved") is not True:
        die("upstream license not preserved")
    copying = Path(str(license_info.get("path", "")))
    if not copying.is_file():
        die("COPYING missing")
    expected_blob = license_info.get("blob")
    actual_blob = git("hash-object", str(copying))
    if expected_blob != actual_blob:
        die(f"upstream license blob drift: expected {expected_blob}, got {actual_blob}")

    baseline = require_dict(manifest.get("baseline"), "baseline")
    if baseline.get("repository") != "wojcikiewicz17/frida":
        die("unexpected upstream baseline repository")
    base_commit = str(baseline.get("commit", ""))
    if len(base_commit) != 40:
        die("baseline commit must be a full SHA-1")
    git("cat-file", "-e", f"{base_commit}^{{commit}}")

    head = git("rev-parse", "HEAD")
    try:
        subprocess.run(
            ["git", "merge-base", "--is-ancestor", base_commit, head],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
    except subprocess.CalledProcessError:
        die("pinned baseline is not an ancestor of HEAD")

    observed_commit = str(manifest.get("observed_commit", ""))
    if len(observed_commit) != 40:
        die("observed_commit must be a full SHA-1")
    git("cat-file", "-e", f"{observed_commit}^{{commit}}")
    try:
        subprocess.run(
            ["git", "merge-base", "--is-ancestor", observed_commit, head],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
    except subprocess.CalledProcessError:
        die("observed main anchor is not an ancestor of HEAD")

    authorial = require_dict(manifest.get("authorial_delta"), "authorial_delta")
    if authorial.get("ownership_claimed_by_this_manifest") is not False:
        die("manifest must not claim ownership before hunk-origin review")

    path_diff = require_dict(authorial.get("path_diff"), "authorial_delta.path_diff")
    if path_diff.get("state") != "IMPLEMENTED_AUTOMATED":
        die("path-level delta inventory must remain automated")
    hunk_origin = require_dict(authorial.get("hunk_origin"), "authorial_delta.hunk_origin")
    if "TOKEN_VAZIO" not in str(hunk_origin.get("state", "")):
        die("hunk origin may not be promoted without separate evidence")
    if hunk_origin.get("ownership_claimed") is not False:
        die("hunk-origin ownership claim must remain false")

    third_party = require_dict(manifest.get("third_party"), "third_party")
    if third_party.get("flatten_to_single_license") is not False:
        die("third-party licensing must not be flattened")

    governance = require_dict(manifest.get("governance"), "governance")
    main_protection = require_dict(governance.get("main_branch_protection"), "governance.main_branch_protection")
    if main_protection.get("observed_protected") is not False:
        die("main protection may not be promoted by repository content alone")
    if main_protection.get("required_checks_enforced") is not False:
        die("required checks may not be claimed enforced without GitHub settings evidence")
    if int(main_protection.get("observed_ruleset_count", -1)) != 0:
        die("ruleset count differs from the pinned observed governance gap")
    if "TOKEN_VAZIO" not in str(main_protection.get("state", "")):
        die("unprotected-main governance gap must remain TOKEN_VAZIO until settings evidence exists")

    rollback = require_dict(manifest.get("rollback"), "rollback")
    if rollback.get("available") is not True:
        die("rollback required")

    entries = parse_name_status(base_commit, head)
    if not entries:
        die("pinned baseline produced an empty fork delta")

    changed_paths = {entry["path"] for entry in entries}
    for path in authorial.get("candidate_paths_observed_from_readme", []):
        if not Path(path).exists():
            die(f"candidate path missing: {path}")
        if path not in changed_paths:
            die(f"candidate path is not in pinned-baseline delta: {path}")

    counts: dict[str, int] = {}
    for entry in entries:
        key = entry["path_relation"]
        counts[key] = counts.get(key, 0) + 1

    evidence = {
        "schema": "rafaelia.delta-inventory-evidence.v1",
        "repository": manifest["repository"],
        "baseline_repository": baseline["repository"],
        "baseline_commit": base_commit,
        "head_commit": head,
        "path_diff_state": "OBSERVED_AUTOMATED",
        "hunk_origin_state": "TOKEN_VAZIO_REQUIRES_ORIGIN_REVIEW",
        "ownership_claimed": False,
        "claim_allowed": False,
        "governance_required_checks_enforced": False,
        "counts": dict(sorted(counts.items())),
        "total_changed_paths": len(entries),
        "entries": entries,
    }
    evidence_path.parent.mkdir(parents=True, exist_ok=True)
    evidence_path.write_text(
        json.dumps(evidence, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    print(
        "PASS: license blob pinned; baseline ancestry verified; "
        f"{len(entries)} fork-delta paths inventoried; hunk authorship and main enforcement remain fail-closed"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--evidence", type=Path, default=DEFAULT_EVIDENCE)
    args = parser.parse_args()
    validate(args.manifest, args.evidence)


if __name__ == "__main__":
    main()

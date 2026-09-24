#!/usr/bin/env python3
"""Compare RAFAELIA Frida runtime-stability dumps without inventing causality.

Fail-closed rules:
- missing evidence is not equality;
- compact hashes are hints only;
- non-atomic capture races block module-surface claims;
- observer drift is separated from target drift;
- expected clock progression is context, not runtime drift.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


TOKEN_VAZIO = "TOKEN_VAZIO"
DUMP_SCHEMA = "rafaelia.android.runtime-stability/v1"
RESULT_SCHEMA = "rafaelia.android.runtime-stability-diff/v2"

REQUIRED_PATHS = [
    "schema",
    "stable_identity.arch",
    "stable_identity.pointer_size",
    "stable_identity.page_size",
    "stable_identity.platform",
    "stable_identity.java_identity",
    "observer.agent_schema",
    "observer.frida_version",
    "observer.instrumentation_present",
    "observer.introspection_visibility",
    "observer.memory_range_semantics",
    "capture_provenance.agent_sha256",
    "capture_provenance.controller_sha256",
    "capture_provenance.frida_python_version",
    "runtime_state.modules.modules",
    "runtime_state.threads.count",
    "runtime_state.memory_ranges",
]


def load_json(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict) and "payload" in data:
        payload = data["payload"]
        if isinstance(payload, dict) and isinstance(payload.get("dump"), dict):
            return payload["dump"]
    if isinstance(data, dict) and isinstance(data.get("dump"), dict):
        return data["dump"]
    if isinstance(data, dict):
        return data
    raise ValueError(f"{path}: expected JSON object")


def get_path(data: dict[str, Any], dotted: str) -> Any:
    current: Any = data
    for part in dotted.split("."):
        if not isinstance(current, dict) or part not in current:
            return TOKEN_VAZIO
        current = current[part]
    return current


def is_missing(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str) and value.startswith("TOKEN_VAZIO"):
        return True
    return False


def missing_required(data: dict[str, Any]) -> list[str]:
    missing = []
    for path in REQUIRED_PATHS:
        value = get_path(data, path)
        if is_missing(value):
            missing.append(path)
    return missing


def compare_paths(
    baseline: dict[str, Any],
    candidate: dict[str, Any],
    paths: list[str],
) -> list[dict[str, Any]]:
    changes: list[dict[str, Any]] = []
    for path in paths:
        before = get_path(baseline, path)
        after = get_path(candidate, path)
        if before != after:
            changes.append({"path": path, "before": before, "after": after})
    return changes


def module_surface(data: dict[str, Any]) -> Any:
    """Return authoritative module name+size multiset; ASLR bases are excluded."""
    modules = get_path(data, "runtime_state.modules.modules")
    if not isinstance(modules, list):
        return TOKEN_VAZIO

    surface: list[dict[str, Any]] = []
    for row in modules:
        if not isinstance(row, dict):
            return TOKEN_VAZIO
        name = row.get("name")
        size = row.get("size")
        if not isinstance(name, str) or not name:
            return TOKEN_VAZIO
        if not isinstance(size, int) or isinstance(size, bool) or size < 0:
            return TOKEN_VAZIO
        surface.append({"name": name, "size": size})
    return sorted(surface, key=lambda row: (row["name"], row["size"]))


def module_name_ambiguity(data: dict[str, Any]) -> list[str]:
    surface = module_surface(data)
    if not isinstance(surface, list):
        return []
    counts: dict[str, int] = {}
    for row in surface:
        counts[row["name"]] = counts.get(row["name"], 0) + 1
    return sorted(name for name, count in counts.items() if count > 1)


def java_runtime_projection(data: dict[str, Any]) -> Any:
    value = get_path(data, "runtime_state.java_runtime")
    if not isinstance(value, dict):
        return value
    # Monotonic elapsed time must advance between valid captures. It is context,
    # not target-state drift by itself.
    return {
        key: val
        for key, val in value.items()
        if key != "device_elapsed_ms"
    }


def consistency_state(data: dict[str, Any]) -> Any:
    return get_path(data, "consistency.module_surface_stable_during_capture")


def render_incomparable(
    classification: str,
    baseline: dict[str, Any],
    candidate: dict[str, Any],
    *,
    baseline_missing: list[str],
    candidate_missing: list[str],
    reason: str,
) -> dict[str, Any]:
    return {
        "schema": RESULT_SCHEMA,
        "classification": classification,
        "comparison_status": "FAIL_CLOSED",
        "reason": reason,
        "baseline_missing_required": baseline_missing,
        "candidate_missing_required": candidate_missing,
        "platform_identity_match": TOKEN_VAZIO,
        "observer_match": TOKEN_VAZIO,
        "module_surface_match": TOKEN_VAZIO,
        "recognition_match": TOKEN_VAZIO,
        "identity_changes": [],
        "observer_changes": [],
        "module_surface_changes": [],
        "runtime_changes": [],
        "hint_changes": [],
        "module_name_ambiguity": {
            "baseline": module_name_ambiguity(baseline),
            "candidate": module_name_ambiguity(candidate),
        },
        "compact_fingerprints_authoritative": False,
        "causality": "NOT_INFERRED",
        "claim_allowed": False,
    }


def compare(baseline: dict[str, Any], candidate: dict[str, Any]) -> dict[str, Any]:
    if baseline.get("schema") != DUMP_SCHEMA or candidate.get("schema") != DUMP_SCHEMA:
        return render_incomparable(
            "INCOMPARABLE_SCHEMA",
            baseline,
            candidate,
            baseline_missing=[],
            candidate_missing=[],
            reason="both dumps must use the supported runtime-stability schema",
        )

    baseline_missing = missing_required(baseline)
    candidate_missing = missing_required(candidate)
    if baseline_missing or candidate_missing:
        return render_incomparable(
            "INSUFFICIENT_EVIDENCE",
            baseline,
            candidate,
            baseline_missing=baseline_missing,
            candidate_missing=candidate_missing,
            reason="missing observations cannot be treated as equal observations",
        )

    if consistency_state(baseline) is False or consistency_state(candidate) is False:
        return render_incomparable(
            "INCOMPARABLE_CAPTURE_RACE",
            baseline,
            candidate,
            baseline_missing=[],
            candidate_missing=[],
            reason="module surface changed during at least one non-atomic capture",
        )

    identity_paths = [
        "stable_identity.arch",
        "stable_identity.pointer_size",
        "stable_identity.page_size",
        "stable_identity.platform",
        "stable_identity.java_identity",
    ]
    observer_paths = [
        "observer.agent_schema",
        "observer.frida_version",
        "observer.instrumentation_present",
        "observer.introspection_visibility",
        "observer.memory_range_semantics",
        "capture_provenance.agent_sha256",
        "capture_provenance.controller_sha256",
        "capture_provenance.frida_python_version",
    ]
    runtime_paths = [
        "runtime_state.debugger_attached",
        "runtime_state.code_signing_policy",
        "runtime_state.threads.count",
        "runtime_state.threads.states",
        "runtime_state.memory_ranges",
    ]
    hint_paths = [
        "platform_key",
        "module_surface_key",
        "recognition_key",
        "runtime_state.modules.stable_set_fingerprint",
    ]

    identity_changes = compare_paths(baseline, candidate, identity_paths)
    observer_changes = compare_paths(baseline, candidate, observer_paths)
    runtime_changes = compare_paths(baseline, candidate, runtime_paths)

    before_java = java_runtime_projection(baseline)
    after_java = java_runtime_projection(candidate)
    if before_java != after_java:
        runtime_changes.append({
            "path": "runtime_state.java_runtime[excluding_device_elapsed_ms]",
            "before": before_java,
            "after": after_java,
        })

    baseline_surface = module_surface(baseline)
    candidate_surface = module_surface(candidate)
    module_changes: list[dict[str, Any]] = []
    if baseline_surface != candidate_surface:
        module_changes.append({
            "path": "runtime_state.modules.modules[name,size]",
            "before": baseline_surface,
            "after": candidate_surface,
        })

    hint_changes = compare_paths(baseline, candidate, hint_paths)

    if identity_changes:
        classification = "IDENTITY_DRIFT"
    elif observer_changes:
        classification = "OBSERVER_DRIFT"
    elif module_changes:
        classification = "MODULE_SURFACE_DRIFT"
    elif runtime_changes:
        classification = "RUNTIME_DRIFT"
    else:
        classification = "NO_OBSERVED_DRIFT"

    return {
        "schema": RESULT_SCHEMA,
        "classification": classification,
        "comparison_status": "COMPARABLE",
        "platform_identity_match": not identity_changes,
        "observer_match": not observer_changes,
        "module_surface_match": not module_changes,
        "recognition_match": not identity_changes and not module_changes,
        "identity_changes": identity_changes,
        "observer_changes": observer_changes,
        "module_surface_changes": module_changes,
        "runtime_changes": runtime_changes,
        "hint_changes": hint_changes,
        "module_name_ambiguity": {
            "baseline": module_name_ambiguity(baseline),
            "candidate": module_name_ambiguity(candidate),
        },
        "compact_fingerprints_authoritative": False,
        "causality": "NOT_INFERRED",
        "claim_allowed": False,
        "invariant": (
            "missing evidence != equality; drift != instability; "
            "platform, observer, module and runtime drift are distinct"
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("baseline", type=Path)
    parser.add_argument("candidate", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()

    result = compare(load_json(args.baseline), load_json(args.candidate))
    rendered = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if args.out:
        args.out.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

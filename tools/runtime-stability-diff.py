#!/usr/bin/env python3
"""Compare RAFAELIA Frida runtime-stability dumps without inventing causality."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

SCHEMA_V2 = "rafaelia.android.runtime-stability/v2"


def load_json(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))

    if isinstance(data, dict) and "payload" in data:
        payload = data["payload"]
        if isinstance(payload, dict) and "dump" in payload:
            return payload["dump"]

    if isinstance(data, dict) and "dump" in data:
        return data["dump"]

    if isinstance(data, dict):
        return data

    raise ValueError(f"{path}: expected JSON object")


def get_path(data: dict[str, Any], dotted: str) -> Any:
    current: Any = data
    for part in dotted.split("."):
        if not isinstance(current, dict) or part not in current:
            return "TOKEN_VAZIO"
        current = current[part]
    return current


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
    modules = get_path(data, "runtime_state.modules.modules")
    if modules == "TOKEN_VAZIO" or not isinstance(modules, list):
        return "TOKEN_VAZIO"

    surface: list[dict[str, Any]] = []
    for row in modules:
        if not isinstance(row, dict):
            return "TOKEN_VAZIO"
        surface.append(
            {
                "name": row.get("name", "TOKEN_VAZIO"),
                "size": row.get("size", "TOKEN_VAZIO"),
            }
        )
    return sorted(surface, key=lambda row: (str(row["name"]), str(row["size"])))


def java_runtime_surface(data: dict[str, Any]) -> Any:
    runtime = get_path(data, "runtime_state.java_runtime")
    if runtime == "TOKEN_VAZIO" or not isinstance(runtime, dict):
        return runtime
    allowed = (
        "java_heap_total_bytes",
        "java_heap_free_bytes",
        "java_heap_max_bytes",
        "native_heap_allocated_bytes",
        "native_heap_size_bytes",
        "native_heap_free_bytes",
        "process_pss_kb",
        "loaded_class_count",
    )
    return {key: runtime.get(key, "TOKEN_VAZIO") for key in allowed}


def validate_dump(data: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if data.get("schema") != SCHEMA_V2:
        errors.append(f"unsupported_schema:{data.get('schema', 'TOKEN_VAZIO')}")
    for path in (
        "stable_identity",
        "instrumentation_identity",
        "visibility",
        "runtime_state",
        "runtime_state.modules",
        "runtime_state.threads",
        "runtime_state.memory_ranges",
        "runtime_state.android_services",
    ):
        if get_path(data, path) == "TOKEN_VAZIO":
            errors.append(f"missing:{path}")
    if data.get("claim_allowed") is not False:
        errors.append("claim_allowed_must_be_false")
    return errors


def render_result(result: dict[str, Any], out: Path | None) -> None:
    rendered = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if out:
        out.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("baseline", type=Path)
    parser.add_argument("candidate", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()

    baseline = load_json(args.baseline)
    candidate = load_json(args.candidate)

    baseline_errors = validate_dump(baseline)
    candidate_errors = validate_dump(candidate)
    if baseline_errors or candidate_errors:
        result = {
            "schema": "rafaelia.android.runtime-stability-diff/v2",
            "classification": "INCOMPARABLE",
            "comparable": False,
            "baseline_errors": baseline_errors,
            "candidate_errors": candidate_errors,
            "causality": "NOT_INFERRED",
            "claim_allowed": False,
        }
        render_result(result, args.out)
        return 2

    visibility_paths = [
        "visibility.modules",
        "visibility.threads",
        "visibility.memory_ranges",
        "visibility.java_runtime",
    ]
    instrumentation_paths = [
        "instrumentation_identity.frida_version",
        "instrumentation_identity.script_runtime",
    ]
    identity_paths = [
        "stable_identity.arch",
        "stable_identity.pointer_size",
        "stable_identity.page_size",
        "stable_identity.platform",
        "stable_identity.java_identity",
        "stable_identity.platform_contract",
    ]
    module_hint_paths = [
        "platform_key_hint",
        "module_surface_key_hint",
        "recognition_key_hint",
    ]
    runtime_paths = [
        "runtime_state.debugger_attached",
        "runtime_state.code_signing_policy",
        "runtime_state.threads.count",
        "runtime_state.threads.states",
        "runtime_state.memory_ranges",
    ]
    process_instance_paths = [
        "runtime_state.pid",
        "runtime_state.current_tid",
    ]
    observer_paths = [
        "runtime_state.observer.frida_heap_size_bytes",
        "runtime_state.observer.kernel_api_available",
        "timing.wall_duration_ms",
        "timing.monotonic_duration_ms",
    ]

    visibility_changes = compare_paths(baseline, candidate, visibility_paths)
    instrumentation_changes = compare_paths(
        baseline, candidate, instrumentation_paths
    )
    identity_changes = compare_paths(baseline, candidate, identity_paths)
    hint_changes = compare_paths(baseline, candidate, module_hint_paths)
    runtime_changes = compare_paths(baseline, candidate, runtime_paths)
    process_instance_changes = compare_paths(
        baseline, candidate, process_instance_paths
    )
    observer_changes = compare_paths(baseline, candidate, observer_paths)

    before_java = java_runtime_surface(baseline)
    after_java = java_runtime_surface(candidate)
    if before_java != after_java:
        runtime_changes.append(
            {
                "path": "runtime_state.java_runtime[heap_counters]",
                "before": before_java,
                "after": after_java,
            }
        )

    baseline_module_surface = module_surface(baseline)
    candidate_module_surface = module_surface(candidate)
    module_changes: list[dict[str, Any]] = []
    if baseline_module_surface != candidate_module_surface:
        module_changes.append(
            {
                "path": "runtime_state.modules.modules[name,size]",
                "before": baseline_module_surface,
                "after": candidate_module_surface,
            }
        )

    if visibility_changes:
        classification = "VISIBILITY_DRIFT"
    elif instrumentation_changes:
        classification = "INSTRUMENTATION_DRIFT"
    elif identity_changes:
        classification = "IDENTITY_DRIFT"
    elif module_changes:
        classification = "MODULE_SURFACE_DRIFT"
    elif runtime_changes:
        classification = "RUNTIME_DRIFT"
    else:
        classification = "NO_OBSERVED_DRIFT"

    result = {
        "schema": "rafaelia.android.runtime-stability-diff/v2",
        "classification": classification,
        "comparable": True,
        "platform_identity_match": not identity_changes,
        "module_surface_match": not module_changes,
        "recognition_match": not identity_changes and not module_changes,
        "visibility_changes": visibility_changes,
        "instrumentation_changes": instrumentation_changes,
        "identity_changes": identity_changes,
        "module_surface_changes": module_changes,
        "runtime_changes": runtime_changes,
        "process_instance_changes": process_instance_changes,
        "observer_effect_changes": observer_changes,
        "compact_hint_changes": hint_changes,
        "excluded_from_classification": [
            "wall/monotonic clock position",
            "capture sequence",
            "capture reason",
            "ASLR module bases",
            "PID/TID process instance",
            "observer capture duration",
            "compact hash hints",
        ],
        "causality": "NOT_INFERRED",
        "claim_allowed": False,
        "invariant":
            "schema/visibility/instrumentation/platform/module/runtime drift are distinct evidence classes",
    }

    render_result(result, args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

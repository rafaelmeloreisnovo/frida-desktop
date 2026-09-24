#!/usr/bin/env python3
"""Compare RAFAELIA Frida runtime-stability V2 dumps without inventing causality.

The comparator is deliberately fail-closed:
- missing observation is not equality;
- observer/instrument drift is separate from target drift;
- condition, boot and process-generation context remain explicit;
- ASLR, PID/TID and monotonic counters are not instability by themselves;
- module name+size is a recognition surface, not binary identity.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

SCHEMA_V2 = "rafaelia.android.runtime-stability/v2"
RESULT_SCHEMA = "rafaelia.android.runtime-stability-diff/v2"
TOKEN_VAZIO = "TOKEN_VAZIO"


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
    return value is None or (
        isinstance(value, str) and value.startswith("TOKEN_VAZIO")
    )


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
    rows = get_path(data, "runtime_state.modules.modules")
    if not isinstance(rows, list):
        return TOKEN_VAZIO
    surface: list[dict[str, Any]] = []
    for row in rows:
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


def java_runtime_surface(data: dict[str, Any]) -> Any:
    runtime = get_path(data, "runtime_state.java_runtime")
    if is_missing(runtime):
        return runtime
    if not isinstance(runtime, dict):
        return TOKEN_VAZIO

    # These advance by construction and are process/clock context, not
    # stability drift by themselves.
    context_only = {
        "device_elapsed_ms",
        "process_start_elapsed_ms",
        "process_age_ms",
        "process_elapsed_cpu_ms",
    }
    return {
        key: value
        for key, value in runtime.items()
        if key not in context_only
    }


def condition_id(data: dict[str, Any]) -> str:
    value = get_path(data, "capture_provenance.condition_id")
    if is_missing(value):
        return "UNSPECIFIED"
    return str(value)


def boot_session(data: dict[str, Any]) -> Any:
    return get_path(data, "platform_context.boot_session_sha256")


def process_instance(data: dict[str, Any]) -> dict[str, Any]:
    return {
        "pid": get_path(data, "runtime_state.pid"),
        "process_start_elapsed_ms":
            get_path(data, "runtime_state.java_runtime.process_start_elapsed_ms"),
    }


def capture_consistency(data: dict[str, Any]) -> Any:
    return get_path(data, "consistency.module_surface_stable_during_capture")


def validate_dump(data: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if data.get("schema") != SCHEMA_V2:
        errors.append(f"unsupported_schema:{data.get('schema', TOKEN_VAZIO)}")
    if data.get("claim_allowed") is not False:
        errors.append("claim_allowed_must_be_false")

    required = (
        "stable_identity",
        "instrumentation_identity",
        "visibility",
        "runtime_state",
        "runtime_state.modules",
        "runtime_state.threads",
        "runtime_state.memory_ranges",
        "runtime_state.android_services",
    )
    for path in required:
        value = get_path(data, path)
        if is_missing(value):
            errors.append(f"missing:{path}")

    modules = module_surface(data)
    if is_missing(modules):
        errors.append("missing:runtime_state.modules.modules")

    return sorted(set(errors))


def visibility_state(data: dict[str, Any]) -> dict[str, Any]:
    return {
        "modules": get_path(data, "visibility.modules"),
        "threads": get_path(data, "visibility.threads"),
        "memory_ranges": get_path(data, "visibility.memory_ranges"),
        "java_runtime": get_path(data, "visibility.java_runtime"),
        "system_properties": get_path(data, "visibility.system_properties"),
    }


def render_result(result: dict[str, Any], out: Path | None) -> None:
    rendered = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if out:
        out.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")


def incomparable(
    classification: str,
    reason: str,
    baseline_errors: list[str],
    candidate_errors: list[str],
) -> dict[str, Any]:
    return {
        "schema": RESULT_SCHEMA,
        "classification": classification,
        "comparison_status": "FAIL_CLOSED",
        "comparable": False,
        "reason": reason,
        "baseline_errors": baseline_errors,
        "candidate_errors": candidate_errors,
        "causality": "NOT_INFERRED",
        "claim_allowed": False,
    }


def compare(
    baseline: dict[str, Any],
    candidate: dict[str, Any],
) -> dict[str, Any]:
    baseline_errors = validate_dump(baseline)
    candidate_errors = validate_dump(candidate)
    if baseline_errors or candidate_errors:
        return incomparable(
            "INCOMPARABLE",
            "unsupported or incomplete structural observation",
            baseline_errors,
            candidate_errors,
        )

    baseline_visibility = visibility_state(baseline)
    candidate_visibility = visibility_state(candidate)
    visibility_changes = []
    for key in sorted(set(baseline_visibility) | set(candidate_visibility)):
        before = baseline_visibility.get(key, TOKEN_VAZIO)
        after = candidate_visibility.get(key, TOKEN_VAZIO)
        if before != after:
            visibility_changes.append({
                "path": f"visibility.{key}",
                "before": before,
                "after": after,
            })

    # Same missing visibility on both sides is not evidence of equality.
    shared_missing_visibility = sorted(
        key for key in baseline_visibility
        if is_missing(baseline_visibility[key])
        and is_missing(candidate_visibility.get(key))
        and key in {"modules", "threads", "memory_ranges"}
    )
    if shared_missing_visibility:
        return incomparable(
            "INCOMPARABLE_VISIBILITY",
            "same missing observation cannot be treated as observed equality: "
            + ",".join(shared_missing_visibility),
            [],
            [],
        )

    baseline_condition = condition_id(baseline)
    candidate_condition = condition_id(candidate)
    if baseline_condition != candidate_condition:
        result = incomparable(
            "INCOMPARABLE_CONDITION",
            "experimental/workload condition_id differs",
            [],
            [],
        )
        result["baseline_condition_id"] = baseline_condition
        result["candidate_condition_id"] = candidate_condition
        return result

    baseline_consistency = capture_consistency(baseline)
    candidate_consistency = capture_consistency(candidate)
    if baseline_consistency is False or candidate_consistency is False:
        return incomparable(
            "INCOMPARABLE_CAPTURE_RACE",
            "module surface changed between endpoint fences of a non-atomic capture",
            [],
            [],
        )

    instrumentation_paths = [
        "instrumentation_identity.frida_version",
        "instrumentation_identity.script_runtime",
    ]
    identity_paths = [
        "stable_identity.arch",
        "stable_identity.pointer_size",
        "stable_identity.page_size",
        "stable_identity.platform",
        "stable_identity.java_available",
        "stable_identity.java_identity",
        "stable_identity.platform_contract",
    ]
    runtime_paths = [
        "runtime_state.debugger_attached",
        "runtime_state.code_signing_policy",
        "runtime_state.threads.count",
        "runtime_state.threads.states",
        "runtime_state.memory_ranges",
        "runtime_state.android_services",
    ]
    hint_paths = [
        "platform_key_hint",
        "module_surface_key_hint",
        "recognition_key_hint",
    ]
    observer_paths = [
        "runtime_state.observer.frida_heap_size_bytes",
        "runtime_state.observer.kernel_api_available",
        "timing.wall_duration_ms",
        "timing.monotonic_duration_ms",
    ]

    instrumentation_changes = compare_paths(
        baseline, candidate, instrumentation_paths
    )
    identity_changes = compare_paths(baseline, candidate, identity_paths)
    runtime_changes = compare_paths(baseline, candidate, runtime_paths)
    hint_changes = compare_paths(baseline, candidate, hint_paths)
    observer_changes = compare_paths(baseline, candidate, observer_paths)

    before_java = java_runtime_surface(baseline)
    after_java = java_runtime_surface(candidate)
    if before_java != after_java:
        runtime_changes.append({
            "path": "runtime_state.java_runtime[excluding_monotonic_context]",
            "before": before_java,
            "after": after_java,
        })

    before_modules = module_surface(baseline)
    after_modules = module_surface(candidate)
    module_changes: list[dict[str, Any]] = []
    if before_modules != after_modules:
        module_changes.append({
            "path": "runtime_state.modules.modules[name,size]",
            "before": before_modules,
            "after": after_modules,
        })

    before_boot = boot_session(baseline)
    after_boot = boot_session(candidate)
    boot_comparable = not is_missing(before_boot) and not is_missing(after_boot)
    boot_session_match: bool | str = (
        before_boot == after_boot if boot_comparable else TOKEN_VAZIO
    )

    before_process = process_instance(baseline)
    after_process = process_instance(candidate)
    process_instance_match = before_process == after_process

    if visibility_changes:
        classification = "VISIBILITY_DRIFT"
    elif instrumentation_changes:
        classification = "INSTRUMENTATION_DRIFT"
    elif identity_changes:
        classification = "IDENTITY_DRIFT"
    elif boot_comparable and boot_session_match is False:
        classification = "BOOT_SESSION_DRIFT"
    elif not process_instance_match:
        classification = "PROCESS_INSTANCE_DRIFT"
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
        "comparable": True,
        "condition_id": baseline_condition,
        "condition_control": (
            "EXPLICIT"
            if baseline_condition != "UNSPECIFIED"
            else "UNSPECIFIED_DESCRIPTIVE_ONLY"
        ),
        "platform_identity_match": not identity_changes,
        "instrumentation_match": not instrumentation_changes,
        "module_surface_match": not module_changes,
        "recognition_match": not identity_changes and not module_changes,
        "boot_session_match": boot_session_match,
        "process_instance_match": process_instance_match,
        "process_instance": {
            "baseline": before_process,
            "candidate": after_process,
        },
        "visibility_changes": visibility_changes,
        "instrumentation_changes": instrumentation_changes,
        "identity_changes": identity_changes,
        "module_surface_changes": module_changes,
        "runtime_changes": runtime_changes,
        "process_instance_changes": (
            [] if process_instance_match else [{
                "path": "process_instance",
                "before": before_process,
                "after": after_process,
            }]
        ),
        "observer_effect_changes": observer_changes,
        "compact_hint_changes": hint_changes,
        "module_name_ambiguity": {
            "baseline": module_name_ambiguity(baseline),
            "candidate": module_name_ambiguity(candidate),
        },
        "excluded_from_classification": [
            "wall/monotonic clock position",
            "capture sequence",
            "capture reason",
            "ASLR module bases",
            "current TID",
            "process age/cumulative CPU counters",
            "observer capture duration",
            "compact hash hints",
        ],
        "compact_fingerprints_authoritative": False,
        "module_name_size_is_binary_identity": False,
        "causality": "NOT_INFERRED",
        "claim_allowed": False,
        "invariant": (
            "missing evidence != equality; drift != instability; "
            "condition/visibility/instrument/platform/boot/process/module/runtime "
            "are distinct evidence dimensions"
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("baseline", type=Path)
    parser.add_argument("candidate", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()

    result = compare(load_json(args.baseline), load_json(args.candidate))
    render_result(result, args.out)
    return 0 if result.get("comparable") is True else 2


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Compare RAFAELIA Frida runtime-stability dumps without inventing causality."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


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


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("baseline", type=Path)
    parser.add_argument("candidate", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()

    baseline = load_json(args.baseline)
    candidate = load_json(args.candidate)

    identity_paths = [
        "stable_identity.arch",
        "stable_identity.pointer_size",
        "stable_identity.page_size",
        "stable_identity.platform",
        "stable_identity.java_identity",
        "platform_key",
    ]

    module_paths = [
        "module_surface_key",
        "runtime_state.modules.count",
        "runtime_state.modules.stable_set_fingerprint",
    ]

    runtime_paths = [
        "runtime_state.debugger_attached",
        "runtime_state.code_signing_policy",
        "runtime_state.threads.count",
        "runtime_state.threads.states",
        "runtime_state.memory_ranges",
        "runtime_state.java_runtime",
    ]

    identity_changes = compare_paths(baseline, candidate, identity_paths)
    module_changes = compare_paths(baseline, candidate, module_paths)
    runtime_changes = compare_paths(baseline, candidate, runtime_paths)

    if identity_changes:
        classification = "IDENTITY_DRIFT"
    elif module_changes:
        classification = "MODULE_SURFACE_DRIFT"
    elif runtime_changes:
        classification = "RUNTIME_DRIFT"
    else:
        classification = "NO_OBSERVED_DRIFT"

    result = {
        "schema": "rafaelia.android.runtime-stability-diff/v1",
        "classification": classification,
        "platform_identity_match": not identity_changes,
        "module_surface_match": not module_changes,
        "recognition_match": not identity_changes and not module_changes,
        "identity_changes": identity_changes,
        "module_surface_changes": module_changes,
        "runtime_changes": runtime_changes,
        "causality": "NOT_INFERRED",
        "claim_allowed": False,
        "invariant":
            "platform drift, module-surface drift and runtime drift are distinct evidence classes",
    }

    rendered = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if args.out:
        args.out.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

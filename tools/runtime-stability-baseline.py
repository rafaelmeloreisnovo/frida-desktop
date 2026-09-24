#!/usr/bin/env python3
"""Build and evaluate robust runtime-stability baselines.

No external dependencies. The tool separates:
- baseline validity (same stable platform);
- structural module prevalence;
- robust volatile metric envelopes (median + MAD);
- candidate observations from causal interpretation.

It never labels an observed deviation as a bug or root cause.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import statistics
from pathlib import Path
from collections import Counter
from typing import Any, Iterable


TOKEN_VAZIO = "TOKEN_VAZIO"
DUMP_SCHEMA = "rafaelia.android.runtime-stability/v2"
BASELINE_SCHEMA = "rafaelia.android.runtime-stability-baseline/v1"
ASSESSMENT_SCHEMA = "rafaelia.android.runtime-stability-assessment/v1"

NUMERIC_PATHS = [
    "timing.wall_duration_ms",
    "runtime_state.threads.count",
    "runtime_state.memory_ranges.total_ranges",
    "runtime_state.memory_ranges.total_bytes",
    "runtime_state.java_runtime.java_heap_total_bytes",
    "runtime_state.java_runtime.java_heap_free_bytes",
    "runtime_state.java_runtime.java_heap_max_bytes",
    "runtime_state.java_runtime.native_heap_allocated_bytes",
    "runtime_state.java_runtime.native_heap_size_bytes",
    "runtime_state.java_runtime.native_heap_free_bytes",
    "runtime_state.java_runtime.process_pss_kb",
    "runtime_state.java_runtime.loaded_class_count",
]

REQUIRED_PATHS = [
    "schema",
    "stable_identity.arch",
    "stable_identity.pointer_size",
    "stable_identity.page_size",
    "stable_identity.platform",
    "stable_identity.java_available",
    "instrumentation_identity.frida_version",
    "instrumentation_identity.script_runtime",
    "visibility.modules",
    "visibility.threads",
    "visibility.memory_ranges",
    "consistency.module_surface_stable_during_capture",
    "capture_provenance.agent_sha256",
    "capture_provenance.controller_sha256",
    "capture_provenance.frida_python_version",
    "capture_provenance.controller_run_id",
    "capture_provenance.condition_id",
    "runtime_state.modules.status",
    "runtime_state.modules.modules",
    "runtime_state.threads.status",
    "runtime_state.threads.count",
    "runtime_state.memory_ranges.status",
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
    cur: Any = data
    for part in dotted.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return TOKEN_VAZIO
        cur = cur[part]
    return cur


def module_surface(data: dict[str, Any]) -> Counter[tuple[str, int]]:
    if get_path(data, "runtime_state.modules.status") != "PASS":
        return Counter()
    rows = get_path(data, "runtime_state.modules.modules")
    out: Counter[tuple[str, int]] = Counter()
    if not isinstance(rows, list):
        return out
    for row in rows:
        if not isinstance(row, dict):
            continue
        name = row.get("name")
        size = row.get("size")
        if isinstance(name, str) and isinstance(size, int):
            out[(name, size)] += 1
    return out


def numeric_values(dumps: Iterable[dict[str, Any]], path: str) -> list[float]:
    out: list[float] = []
    for dump in dumps:
        value = get_path(dump, path)
        if isinstance(value, bool):
            continue
        if isinstance(value, (int, float)) and math.isfinite(float(value)):
            out.append(float(value))
    return out


def robust_summary(values: list[float]) -> dict[str, Any]:
    if not values:
        return {
            "n": 0,
            "state": TOKEN_VAZIO,
            "min": TOKEN_VAZIO,
            "max": TOKEN_VAZIO,
            "median": TOKEN_VAZIO,
            "mad": TOKEN_VAZIO,
        }
    median = float(statistics.median(values))
    mad = float(statistics.median(abs(v - median) for v in values))
    return {
        "n": len(values),
        "state": "OBSERVED",
        "min": min(values),
        "max": max(values),
        "median": median,
        "mad": mad,
    }


def completeness(dump: dict[str, Any]) -> dict[str, Any]:
    required = list(REQUIRED_PATHS)
    if get_path(dump, "stable_identity.java_available") is True:
        required.append("stable_identity.java_identity")

    present = []
    missing = []
    for path in required:
        value = get_path(dump, path)
        if value == TOKEN_VAZIO or value is None:
            missing.append(path)
        else:
            present.append(path)
    ratio = len(present) / len(required)
    return {
        "required_count": len(required),
        "present_count": len(present),
        "ratio": ratio,
        "missing": missing,
        "java_scope": (
            "JAVA_AWARE"
            if get_path(dump, "stable_identity.java_available") is True
            else "NATIVE_ONLY"
            if get_path(dump, "stable_identity.java_available") is False
            else TOKEN_VAZIO
        ),
    }


def stable_identity_projection(dump: dict[str, Any]) -> dict[str, Any]:
    identity = get_path(dump, "stable_identity")
    if not isinstance(identity, dict):
        return {"state": TOKEN_VAZIO}
    return identity


def observer_projection(dump: dict[str, Any]) -> dict[str, Any]:
    return {
        "frida_version": get_path(
            dump, "instrumentation_identity.frida_version"
        ),
        "script_runtime": get_path(
            dump, "instrumentation_identity.script_runtime"
        ),
        "agent_sha256": get_path(dump, "capture_provenance.agent_sha256"),
        "controller_sha256": get_path(
            dump, "capture_provenance.controller_sha256"
        ),
        "frida_python_version": get_path(
            dump, "capture_provenance.frida_python_version"
        ),
    }


def build_baseline(paths: list[Path]) -> dict[str, Any]:
    if len(paths) < 3:
        raise ValueError("baseline requires at least 3 independent snapshots")

    resolved_paths = [path.resolve() for path in paths]
    if len(set(resolved_paths)) != len(resolved_paths):
        raise ValueError("baseline input paths must be unique")

    source_sha256 = [hashlib.sha256(path.read_bytes()).hexdigest() for path in paths]
    if len(set(source_sha256)) != len(source_sha256):
        raise ValueError("baseline snapshots must be independently captured; duplicate bytes detected")

    dumps = [load_json(path) for path in paths]
    run_ids = [get_path(d, "capture_provenance.controller_run_id") for d in dumps]
    if any(run_id == TOKEN_VAZIO for run_id in run_ids):
        raise ValueError("baseline snapshots require controller_run_id provenance")
    if len(set(run_ids)) != len(run_ids):
        raise ValueError("baseline snapshots must come from distinct controller runs")

    bad_schema = [i for i, d in enumerate(dumps) if d.get("schema") != DUMP_SCHEMA]
    if bad_schema:
        raise ValueError(f"unsupported dump schema at indexes: {bad_schema}")

    identities = [stable_identity_projection(d) for d in dumps]
    identity_reference = identities[0]
    identity_consistent = all(item == identity_reference for item in identities[1:])

    observers = [observer_projection(d) for d in dumps]
    observer_reference = observers[0]
    observer_consistent = all(item == observer_reference for item in observers[1:])

    platform_keys = [get_path(d, "platform_key_hint") for d in dumps]
    platform_key_hint_consistent = all(
        key == platform_keys[0] for key in platform_keys[1:]
    )

    condition_ids = [
        get_path(d, "capture_provenance.condition_id") for d in dumps
    ]
    condition_consistent = all(
        value == condition_ids[0] for value in condition_ids[1:]
    )
    condition_id = condition_ids[0] if condition_consistent else TOKEN_VAZIO

    boot_sessions = [
        get_path(d, "platform_context.boot_session_sha256") for d in dumps
    ]
    observed_boot_sessions = sorted({
        str(value)
        for value in boot_sessions
        if value != TOKEN_VAZIO
        and not (
            isinstance(value, str)
            and value.startswith("TOKEN_VAZIO")
        )
    })

    surfaces = [module_surface(d) for d in dumps]
    union = set().union(*(set(surface.keys()) for surface in surfaces))
    prevalence = []
    for item in sorted(union):
        present_count = sum(1 for surface in surfaces if surface[item] > 0)
        multiplicities = [surface[item] for surface in surfaces]
        prevalence.append({
            "name": item[0],
            "size": item[1],
            "snapshot_presence_count": present_count,
            "prevalence": present_count / len(dumps),
            "core": present_count == len(dumps),
            "min_multiplicity": min(multiplicities),
            "max_multiplicity": max(multiplicities),
        })

    metrics = {
        path: robust_summary(numeric_values(dumps, path))
        for path in NUMERIC_PATHS
    }

    quality = [completeness(d) for d in dumps]
    min_quality = min(item["ratio"] for item in quality)
    capture_consistent = all(
        get_path(d, "consistency.module_surface_stable_during_capture") is True
        for d in dumps
    )

    baseline_strength = (
        "MINIMAL" if len(dumps) < 5
        else "ROBUST" if len(dumps) < 10
        else "STRONG"
    )

    valid = (
        identity_consistent
        and observer_consistent
        and capture_consistent
        and condition_consistent
        and min_quality == 1.0
    )

    return {
        "schema": BASELINE_SCHEMA,
        "sample_count": len(dumps),
        "baseline_strength": baseline_strength,
        "baseline_strength_semantics": "SAMPLE_DEPTH_ONLY_NOT_EVIDENCE_STRENGTH",
        "sampling_depth": baseline_strength,
        "independent_snapshot_sha256": source_sha256,
        "independent_controller_run_ids": run_ids,
        "independence_claim": "DISTINCT_ACQUISITIONS_NOT_STATISTICAL_INDEPENDENCE",
        "minimum_required_samples": 3,
        "baseline_valid": valid,
        "baseline_gate": "PASS" if valid else "FAIL",
        "stable_identity_consistent": identity_consistent,
        "observer_consistent": observer_consistent,
        "capture_consistent": capture_consistent,
        "condition_consistent": condition_consistent,
        "condition_id": condition_id,
        "condition_control": (
            "EXPLICIT"
            if condition_consistent and condition_id != "UNSPECIFIED"
            else "UNSPECIFIED_DESCRIPTIVE_ONLY"
            if condition_consistent
            else "INCOMPARABLE"
        ),
        "boot_session_count": len(observed_boot_sessions),
        "boot_sessions_sha256": observed_boot_sessions,
        "cross_boot_sampling": len(observed_boot_sessions) > 1,
        "observer_identity": observer_reference if observer_consistent else TOKEN_VAZIO,
        "platform_key_hint_consistent": platform_key_hint_consistent,
        "stable_identity": identity_reference if identity_consistent else TOKEN_VAZIO,
        "platform_key_hint": platform_keys[0] if platform_key_hint_consistent else TOKEN_VAZIO,
        "compact_fingerprints_authoritative": False,
        "quality": {
            "minimum_completeness_ratio": min_quality,
            "snapshots": quality,
        },
        "module_prevalence": prevalence,
        "metrics": metrics,
        "methodology": {
            "numeric_center": "MEDIAN",
            "numeric_dispersion": "MAD",
            "robust_sigma_scale": 1.4826,
            "candidate_outlier_threshold": 6.0,
            "module_model": "EMPIRICAL_PREVALENCE",
            "causal_inference": "FORBIDDEN",
            "multiple_comparisons_note": "descriptive outlier screening only; no p-value or causal promotion",
        },
        "falsifiers": [
            "stable identity differs across baseline snapshots",
            "observer identity/source binding differs across baseline snapshots",
            "compact platform hints may differ without invalidating the baseline; full stable identity is authoritative",
            "any required observation is missing",
            "fewer than 3 distinct captures",
            "controller_run_id is missing or repeated",
            "capture condition differs across baseline snapshots",
            "module surface changed during a non-atomic capture",
        ],
        "claim_allowed": False,
    }


def assess_candidate(baseline: dict[str, Any], candidate: dict[str, Any]) -> dict[str, Any]:
    if baseline.get("schema") != BASELINE_SCHEMA:
        raise ValueError("unsupported baseline schema")
    if not baseline.get("baseline_valid"):
        raise ValueError("cannot assess against invalid baseline")
    if candidate.get("schema") != DUMP_SCHEMA:
        raise ValueError("unsupported candidate dump schema")

    candidate_quality = completeness(candidate)
    candidate_condition = get_path(
        candidate, "capture_provenance.condition_id"
    )
    condition_match = candidate_condition == baseline.get("condition_id")
    candidate_capture_consistent = (
        get_path(candidate, "consistency.module_surface_stable_during_capture")
        is True
    )
    identity_match = stable_identity_projection(candidate) == baseline["stable_identity"]
    observer_match = observer_projection(candidate) == baseline["observer_identity"]
    platform_key_hint_match = get_path(candidate, "platform_key_hint") == baseline["platform_key_hint"]

    baseline_modules = baseline.get("module_prevalence", [])
    expected = {
        (row["name"], row["size"]): (
            int(row.get("min_multiplicity", 0)),
            int(row.get("max_multiplicity", 0)),
        )
        for row in baseline_modules
    }
    candidate_modules = module_surface(candidate)
    missing_core = []
    novel = []
    multiplicity_outside_baseline = []

    for item, (minimum, maximum) in expected.items():
        observed = candidate_modules[item]
        if minimum > 0 and observed < minimum:
            missing_core.append((item[0], item[1], minimum, observed))
        if observed > maximum:
            multiplicity_outside_baseline.append(
                (item[0], item[1], minimum, maximum, observed)
            )

    for item, observed in candidate_modules.items():
        if item not in expected:
            novel.append((item[0], item[1], observed))

    metric_assessments = []
    outlier_count = 0
    token_vazio_count = 0
    for path, summary in baseline.get("metrics", {}).items():
        value = get_path(candidate, path)
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            metric_assessments.append({
                "path": path,
                "value": TOKEN_VAZIO,
                "state": TOKEN_VAZIO,
            })
            token_vazio_count += 1
            continue

        if summary.get("state") != "OBSERVED" or summary.get("n", 0) < 3:
            metric_assessments.append({
                "path": path,
                "value": value,
                "state": TOKEN_VAZIO,
            })
            token_vazio_count += 1
            continue

        median = float(summary["median"])
        mad = float(summary["mad"])
        if mad > 0:
            robust_z = abs(float(value) - median) / (1.4826 * mad)
            outlier = robust_z > 6.0
            state = "ROBUST_OUTLIER" if outlier else "WITHIN_ROBUST_ENVELOPE"
        else:
            robust_z = TOKEN_VAZIO
            outlier = float(value) < float(summary["min"]) or float(value) > float(summary["max"])
            state = "OUTSIDE_ZERO_MAD_RANGE" if outlier else "WITHIN_ZERO_MAD_RANGE"

        if outlier:
            outlier_count += 1

        metric_assessments.append({
            "path": path,
            "value": value,
            "state": state,
            "robust_z": robust_z,
            "baseline": summary,
        })

    if not candidate_capture_consistent:
        classification = "INCOMPARABLE_CAPTURE_RACE"
    elif not condition_match:
        classification = "INCOMPARABLE_CONDITION"
    elif candidate_quality["ratio"] < 1.0:
        classification = "INSUFFICIENT_OBSERVATION"
    elif not identity_match:
        classification = "IDENTITY_DRIFT"
    elif not observer_match:
        classification = "OBSERVER_DRIFT"
    elif missing_core or novel or multiplicity_outside_baseline:
        classification = "MODULE_SURFACE_OUTSIDE_BASELINE"
    elif outlier_count:
        classification = "RUNTIME_OUTLIER_OBSERVED"
    elif token_vazio_count:
        classification = "INSUFFICIENT_OBSERVATION"
    else:
        classification = "WITHIN_OBSERVED_BASELINE"

    return {
        "schema": ASSESSMENT_SCHEMA,
        "classification": classification,
        "stable_identity_match": identity_match,
        "observer_match": observer_match,
        "capture_consistent": candidate_capture_consistent,
        "condition_match": condition_match,
        "candidate_condition_id": candidate_condition,
        "platform_key_hint_match": platform_key_hint_match,
        "compact_fingerprints_authoritative": False,
        "candidate_quality": candidate_quality,
        "modules": {
            "missing_core": [
                {
                    "name": name,
                    "size": size,
                    "baseline_min_multiplicity": minimum,
                    "candidate_multiplicity": observed,
                }
                for name, size, minimum, observed in missing_core
            ],
            "novel": [
                {"name": name, "size": size, "candidate_multiplicity": observed}
                for name, size, observed in novel
            ],
            "multiplicity_outside_baseline": [
                {
                    "name": name,
                    "size": size,
                    "baseline_min_multiplicity": minimum,
                    "baseline_max_multiplicity": maximum,
                    "candidate_multiplicity": observed,
                }
                for name, size, minimum, maximum, observed
                in multiplicity_outside_baseline
            ],
        },
        "metrics": metric_assessments,
        "runtime_outlier_count": outlier_count,
        "token_vazio_metric_count": token_vazio_count,
        "causality": "NOT_INFERRED",
        "stability_claim": "NOT_PROMOTED",
        "claim_allowed": False,
        "falsifier_note": (
            "A candidate outside the empirical baseline is an observed deviation only. "
            "Repetition, temporal ordering and independent evidence are required before "
            "promoting any stability hypothesis."
        ),
    }


def write_json(path: Path | None, value: dict[str, Any]) -> None:
    rendered = json.dumps(value, indent=2, sort_keys=True) + "\n"
    if path is None:
        print(rendered, end="")
    else:
        path.write_text(rendered, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    build = sub.add_parser("build")
    build.add_argument("snapshots", type=Path, nargs="+")
    build.add_argument("--out", type=Path)

    assess = sub.add_parser("assess")
    assess.add_argument("baseline", type=Path)
    assess.add_argument("candidate", type=Path)
    assess.add_argument("--out", type=Path)

    args = parser.parse_args()

    if args.command == "build":
        result = build_baseline(args.snapshots)
        write_json(args.out, result)
        return 0 if result["baseline_gate"] == "PASS" else 2

    baseline = load_json(args.baseline)
    candidate = load_json(args.candidate)
    result = assess_candidate(baseline, candidate)
    write_json(args.out, result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

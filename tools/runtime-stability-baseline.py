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
import json
import math
import statistics
from pathlib import Path
from typing import Any, Iterable


TOKEN_VAZIO = "TOKEN_VAZIO"
DUMP_SCHEMA = "rafaelia.android.runtime-stability/v1"
BASELINE_SCHEMA = "rafaelia.android.runtime-stability-baseline/v1"
ASSESSMENT_SCHEMA = "rafaelia.android.runtime-stability-assessment/v1"

NUMERIC_PATHS = [
    "runtime_state.memory_ranges.---.count",
    "runtime_state.memory_ranges.---.bytes",
    "runtime_state.memory_ranges.--x.count",
    "runtime_state.memory_ranges.--x.bytes",
    "runtime_state.memory_ranges.-w-.count",
    "runtime_state.memory_ranges.-w-.bytes",
    "runtime_state.memory_ranges.-wx.count",
    "runtime_state.memory_ranges.-wx.bytes",
    "runtime_state.threads.count",
    "runtime_state.memory_ranges.r--.count",
    "runtime_state.memory_ranges.r--.bytes",
    "runtime_state.memory_ranges.rw-.count",
    "runtime_state.memory_ranges.rw-.bytes",
    "runtime_state.memory_ranges.r-x.count",
    "runtime_state.memory_ranges.r-x.bytes",
    "runtime_state.memory_ranges.rwx.count",
    "runtime_state.memory_ranges.rwx.bytes",
    "runtime_state.java_runtime.java_heap_total_bytes",
    "runtime_state.java_runtime.java_heap_free_bytes",
    "runtime_state.java_runtime.java_heap_max_bytes",
    "runtime_state.java_runtime.native_heap_allocated_bytes",
]

REQUIRED_PATHS = [
    "schema",
    "stable_identity.arch",
    "stable_identity.pointer_size",
    "stable_identity.page_size",
    "stable_identity.platform",
    "platform_key",
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
    cur: Any = data
    for part in dotted.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return TOKEN_VAZIO
        cur = cur[part]
    return cur


def module_surface(data: dict[str, Any]) -> set[tuple[str, int]]:
    rows = get_path(data, "runtime_state.modules.modules")
    if not isinstance(rows, list):
        return set()
    out: set[tuple[str, int]] = set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        name = row.get("name")
        size = row.get("size")
        if isinstance(name, str) and isinstance(size, int):
            out.add((name, size))
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
    present = []
    missing = []
    for path in REQUIRED_PATHS:
        value = get_path(dump, path)
        if value == TOKEN_VAZIO or value is None:
            missing.append(path)
        else:
            present.append(path)
    ratio = len(present) / len(REQUIRED_PATHS)
    return {
        "required_count": len(REQUIRED_PATHS),
        "present_count": len(present),
        "ratio": ratio,
        "missing": missing,
    }


def stable_identity_projection(dump: dict[str, Any]) -> dict[str, Any]:
    identity = get_path(dump, "stable_identity")
    if not isinstance(identity, dict):
        return {"state": TOKEN_VAZIO}
    return identity


def build_baseline(paths: list[Path]) -> dict[str, Any]:
    if len(paths) < 3:
        raise ValueError("baseline requires at least 3 independent snapshots")

    dumps = [load_json(path) for path in paths]
    bad_schema = [i for i, d in enumerate(dumps) if d.get("schema") != DUMP_SCHEMA]
    if bad_schema:
        raise ValueError(f"unsupported dump schema at indexes: {bad_schema}")

    identities = [stable_identity_projection(d) for d in dumps]
    identity_reference = identities[0]
    identity_consistent = all(item == identity_reference for item in identities[1:])

    platform_keys = [get_path(d, "platform_key") for d in dumps]
    platform_key_consistent = all(key == platform_keys[0] for key in platform_keys[1:])

    surfaces = [module_surface(d) for d in dumps]
    union = set().union(*surfaces)
    prevalence = []
    for item in sorted(union):
        count = sum(1 for surface in surfaces if item in surface)
        prevalence.append({
            "name": item[0],
            "size": item[1],
            "count": count,
            "prevalence": count / len(dumps),
            "core": count == len(dumps),
        })

    metrics = {
        path: robust_summary(numeric_values(dumps, path))
        for path in NUMERIC_PATHS
    }

    quality = [completeness(d) for d in dumps]
    min_quality = min(item["ratio"] for item in quality)

    valid = (
        identity_consistent
        and platform_key_consistent
        and min_quality == 1.0
    )

    return {
        "schema": BASELINE_SCHEMA,
        "sample_count": len(dumps),
        "minimum_required_samples": 3,
        "baseline_valid": valid,
        "baseline_gate": "PASS" if valid else "FAIL",
        "stable_identity_consistent": identity_consistent,
        "platform_key_consistent": platform_key_consistent,
        "stable_identity": identity_reference if identity_consistent else TOKEN_VAZIO,
        "platform_key": platform_keys[0] if platform_key_consistent else TOKEN_VAZIO,
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
        },
        "falsifiers": [
            "stable identity differs across baseline snapshots",
            "platform_key differs across baseline snapshots",
            "any required observation is missing",
            "fewer than 3 independent snapshots",
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
    identity_match = stable_identity_projection(candidate) == baseline["stable_identity"]
    platform_key_match = get_path(candidate, "platform_key") == baseline["platform_key"]

    baseline_modules = baseline.get("module_prevalence", [])
    core = {
        (row["name"], row["size"])
        for row in baseline_modules
        if row.get("core") is True
    }
    known = {
        (row["name"], row["size"])
        for row in baseline_modules
    }
    candidate_modules = module_surface(candidate)
    missing_core = sorted(core - candidate_modules)
    novel = sorted(candidate_modules - known)

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

    if not identity_match or not platform_key_match:
        classification = "IDENTITY_DRIFT"
    elif missing_core or novel:
        classification = "MODULE_SURFACE_OUTSIDE_BASELINE"
    elif outlier_count:
        classification = "RUNTIME_OUTLIER_OBSERVED"
    elif token_vazio_count or candidate_quality["ratio"] < 1.0:
        classification = "INSUFFICIENT_OBSERVATION"
    else:
        classification = "WITHIN_OBSERVED_BASELINE"

    return {
        "schema": ASSESSMENT_SCHEMA,
        "classification": classification,
        "stable_identity_match": identity_match,
        "platform_key_match": platform_key_match,
        "candidate_quality": candidate_quality,
        "modules": {
            "missing_core": [
                {"name": name, "size": size} for name, size in missing_core
            ],
            "novel": [
                {"name": name, "size": size} for name, size in novel
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

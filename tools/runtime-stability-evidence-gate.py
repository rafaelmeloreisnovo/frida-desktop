#!/usr/bin/env python3
"""Fail-closed epistemic gate for runtime-stability claims.

The gate validates evidence structure; it does not decide scientific truth.
Promotion is monotonic and requires increasingly strong, independently sourced
evidence. Missing prerequisites remain TOKEN_VAZIO.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


SCHEMA = "rafaelia.runtime-stability.falsifiability-packet/v1"
RESULT_SCHEMA = "rafaelia.runtime-stability.falsifiability-result/v1"

LEVELS = [
    "OBSERVED",
    "REPEATED",
    "ASSOCIATED",
    "CAUSAL_CANDIDATE",
    "CAUSAL_SUPPORTED",
]

REQUIREMENTS = {
    "OBSERVED": {
        "minimum_observations": 1,
        "minimum_independent_source_types": 1,
        "requires_temporal_precedence": False,
        "requires_falsifier_attempt": False,
        "requires_intervention_or_reversal": False,
        "requires_alternative_explanation_check": False,
    },
    "REPEATED": {
        "minimum_observations": 3,
        "minimum_independent_source_types": 1,
        "requires_temporal_precedence": False,
        "requires_falsifier_attempt": True,
        "requires_intervention_or_reversal": False,
        "requires_alternative_explanation_check": False,
    },
    "ASSOCIATED": {
        "minimum_observations": 3,
        "minimum_independent_source_types": 2,
        "requires_temporal_precedence": False,
        "requires_falsifier_attempt": True,
        "requires_intervention_or_reversal": False,
        "requires_alternative_explanation_check": True,
    },
    "CAUSAL_CANDIDATE": {
        "minimum_observations": 3,
        "minimum_independent_source_types": 2,
        "requires_temporal_precedence": True,
        "requires_falsifier_attempt": True,
        "requires_intervention_or_reversal": False,
        "requires_alternative_explanation_check": True,
    },
    "CAUSAL_SUPPORTED": {
        "minimum_observations": 3,
        "minimum_independent_source_types": 2,
        "requires_temporal_precedence": True,
        "requires_falsifier_attempt": True,
        "requires_intervention_or_reversal": True,
        "requires_alternative_explanation_check": True,
    },
}


def load(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("packet must be a JSON object")
    return value


def source_types(packet: dict[str, Any]) -> set[str]:
    out: set[str] = set()
    for evidence in packet.get("evidence", []):
        if not isinstance(evidence, dict):
            continue
        source_type = evidence.get("source_type")
        if isinstance(source_type, str) and source_type:
            out.add(source_type)
    return out


def gate(packet: dict[str, Any]) -> dict[str, Any]:
    if packet.get("schema") != SCHEMA:
        raise ValueError("unsupported falsifiability packet schema")

    requested = packet.get("requested_level")
    if requested not in LEVELS:
        raise ValueError(f"requested_level must be one of {LEVELS}")

    hypothesis = packet.get("hypothesis")
    falsifiers = packet.get("falsifiers")
    if not isinstance(hypothesis, str) or not hypothesis.strip():
        raise ValueError("hypothesis is required")
    if not isinstance(falsifiers, list) or not falsifiers:
        raise ValueError("at least one explicit falsifier is required")

    observations = packet.get("observations")
    if not isinstance(observations, list):
        observations = []

    types = source_types(packet)
    checks: list[dict[str, Any]] = []

    def add(name: str, passed: bool, observed: Any, required: Any) -> None:
        checks.append({
            "check": name,
            "state": "PASS" if passed else "FAIL",
            "observed": observed,
            "required": required,
        })

    req = REQUIREMENTS[requested]
    add(
        "minimum_observations",
        len(observations) >= req["minimum_observations"],
        len(observations),
        req["minimum_observations"],
    )
    add(
        "independent_source_types",
        len(types) >= req["minimum_independent_source_types"],
        sorted(types),
        req["minimum_independent_source_types"],
    )

    booleans = [
        ("temporal_precedence", "requires_temporal_precedence"),
        ("falsifier_attempted", "requires_falsifier_attempt"),
        ("intervention_or_reversal", "requires_intervention_or_reversal"),
        ("alternative_explanations_checked", "requires_alternative_explanation_check"),
    ]
    for field, requirement_name in booleans:
        required = bool(req[requirement_name])
        observed = packet.get(field, False)
        passed = (observed is True) if required else True
        add(field, passed, observed, required)

    contradictions = [
        item for item in packet.get("contradictory_evidence", [])
        if isinstance(item, dict)
    ]
    unresolved_contradiction = any(
        item.get("resolved") is not True for item in contradictions
    )
    add(
        "contradictory_evidence_resolved",
        not unresolved_contradiction,
        len(contradictions),
        "all contradictions resolved or explicitly superseded",
    )

    passed = all(item["state"] == "PASS" for item in checks)

    if passed:
        promoted_level = requested
        gate_state = "PASS"
    else:
        requested_index = LEVELS.index(requested)
        promoted_level = "TOKEN_VAZIO"
        for level in reversed(LEVELS[:requested_index]):
            lower_packet = dict(packet)
            lower_packet["requested_level"] = level
            lower_result = gate(lower_packet)
            if lower_result["gate"] == "PASS":
                promoted_level = level
                break
        gate_state = "FAIL"

    return {
        "schema": RESULT_SCHEMA,
        "hypothesis_id": packet.get("hypothesis_id", "TOKEN_VAZIO"),
        "requested_level": requested,
        "gate": gate_state,
        "highest_supported_level": promoted_level,
        "checks": checks,
        "source_types": sorted(types),
        "contradictory_evidence_count": len(contradictions),
        "causal_claim_allowed": promoted_level == "CAUSAL_SUPPORTED",
        "claim_allowed": promoted_level != "TOKEN_VAZIO",
        "invariant": (
            "observation != repetition != association != causal candidate != causal support"
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("packet", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()

    result = gate(load(args.packet))
    rendered = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if args.out:
        args.out.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")
    return 0 if result["gate"] == "PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())

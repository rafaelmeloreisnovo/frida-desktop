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


def independence_groups(packet: dict[str, Any]) -> set[str]:
    out: set[str] = set()
    for evidence in packet.get("evidence", []):
        if not isinstance(evidence, dict):
            continue
        group = evidence.get("independence_group")
        if isinstance(group, str) and group:
            out.add(group)
    return out


def unique_observations(packet: dict[str, Any]) -> tuple[int, bool]:
    values = packet.get("observations")
    if not isinstance(values, list):
        return 0, False
    ids: list[str] = []
    for item in values:
        if not isinstance(item, dict):
            return 0, False
        value = item.get("id")
        if value is None:
            return 0, False
        ids.append(str(value))
    return len(set(ids)), len(set(ids)) == len(ids)


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

    unique_observation_count, observations_unique = unique_observations(packet)
    types = source_types(packet)
    groups = independence_groups(packet)
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
        unique_observation_count >= req["minimum_observations"] and observations_unique,
        {"declared": len(observations), "unique": unique_observation_count, "all_unique": observations_unique},
        req["minimum_observations"],
    )
    add(
        "independent_source_types",
        len(types) >= req["minimum_independent_source_types"],
        sorted(types),
        req["minimum_independent_source_types"],
    )
    add(
        "independence_groups",
        len(groups) >= req["minimum_independent_source_types"],
        sorted(groups),
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

    falsifier_results = [
        item for item in packet.get("falsifier_results", [])
        if isinstance(item, dict)
    ]
    temporal_order_evidence = [
        item for item in packet.get("temporal_order_evidence", [])
        if isinstance(item, dict)
    ]
    interventions = [
        item for item in packet.get("interventions", [])
        if isinstance(item, dict)
    ]
    alternative_explanations = [
        item for item in packet.get("alternative_explanations", [])
        if isinstance(item, dict)
    ]

    if req["requires_falsifier_attempt"]:
        add(
            "falsifier_result_recorded",
            len(falsifier_results) >= 1,
            len(falsifier_results),
            ">=1 structured falsifier result",
        )
    if req["requires_temporal_precedence"]:
        add(
            "temporal_order_evidence_recorded",
            len(temporal_order_evidence) >= 1,
            len(temporal_order_evidence),
            ">=1 structured temporal-order evidence item",
        )
    if req["requires_intervention_or_reversal"]:
        add(
            "intervention_recorded",
            len(interventions) >= 1,
            len(interventions),
            ">=1 controlled intervention/reversal record",
        )
    if req["requires_alternative_explanation_check"]:
        add(
            "alternative_explanations_recorded",
            len(alternative_explanations) >= 1,
            len(alternative_explanations),
            ">=1 structured alternative-explanation review",
        )
        if requested == "CAUSAL_SUPPORTED":
            unresolved_alternatives = [
                item for item in alternative_explanations
                if item.get("status") not in (
                    "REJECTED_BY_EVIDENCE",
                    "BOUNDED_NOT_EXPLANATORY",
                )
            ]
            add(
                "alternative_explanations_resolved_for_causal_support",
                not unresolved_alternatives,
                len(unresolved_alternatives),
                0,
            )

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

    study_mode = packet.get("study_mode", "EXPLORATORY")
    hypothesis_registered_before_test = (
        packet.get("hypothesis_registered_before_test") is True
    )
    confirmatory_ready = (
        passed
        and study_mode == "CONFIRMATORY"
        and hypothesis_registered_before_test
    )

    return {
        "schema": RESULT_SCHEMA,
        "hypothesis_id": packet.get("hypothesis_id", "TOKEN_VAZIO"),
        "requested_level": requested,
        "gate": gate_state,
        "highest_supported_level": promoted_level,
        "checks": checks,
        "source_types": sorted(types),
        "independence_groups": sorted(groups),
        "contradictory_evidence_count": len(contradictions),
        "methodology_structure_complete": promoted_level != "TOKEN_VAZIO",
        "causal_support_structure_complete": promoted_level == "CAUSAL_SUPPORTED",
        "causal_claim_allowed": False,
        "study_mode": study_mode,
        "hypothesis_registered_before_test": hypothesis_registered_before_test,
        "confirmatory_structure_ready": confirmatory_ready,
        "confirmatory_ready": False,
        "publication_grade_causal_support": False,
        "scientific_claim_review_required": True,
        "claim_allowed": False,
        "invariant": (
            "observation != repetition != association != causal candidate != causal support; "
            "methodology structure != scientific truth != claim permission"
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

#!/usr/bin/env python3
"""Fail-closed structural methodology gate for runtime-stability evidence.

This validates whether an evidence packet has the declared methodological
structure. It never decides scientific truth and never authorizes a causal
claim.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


SCHEMA = "rafaelia.runtime-stability.falsifiability-packet/v1"
RESULT_SCHEMA = "rafaelia.runtime-stability.falsifiability-result/v2"

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
        "requires_repeated_fingerprints": False,
        "requires_temporal_precedence": False,
        "requires_falsifier_attempt": False,
        "requires_intervention_or_reversal": False,
        "requires_alternative_explanation_check": False,
    },
    "REPEATED": {
        "minimum_observations": 3,
        "minimum_independent_source_types": 1,
        "requires_repeated_fingerprints": True,
        "requires_temporal_precedence": False,
        "requires_falsifier_attempt": True,
        "requires_intervention_or_reversal": False,
        "requires_alternative_explanation_check": False,
    },
    "ASSOCIATED": {
        "minimum_observations": 3,
        "minimum_independent_source_types": 2,
        "requires_repeated_fingerprints": True,
        "requires_temporal_precedence": False,
        "requires_falsifier_attempt": True,
        "requires_intervention_or_reversal": False,
        "requires_alternative_explanation_check": True,
    },
    "CAUSAL_CANDIDATE": {
        "minimum_observations": 3,
        "minimum_independent_source_types": 2,
        "requires_repeated_fingerprints": True,
        "requires_temporal_precedence": True,
        "requires_falsifier_attempt": True,
        "requires_intervention_or_reversal": False,
        "requires_alternative_explanation_check": True,
    },
    "CAUSAL_SUPPORTED": {
        "minimum_observations": 3,
        "minimum_independent_source_types": 2,
        "requires_repeated_fingerprints": True,
        "requires_temporal_precedence": True,
        "requires_falsifier_attempt": True,
        "requires_intervention_or_reversal": True,
        "requires_alternative_explanation_check": True,
    },
}

ALTERNATIVE_RESOLVED_STATES = {
    "REJECTED_BY_EVIDENCE",
    "BOUNDED_NOT_EXPLANATORY",
}


def load(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("packet must be a JSON object")
    return value


def nonempty_text(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def valid_evidence(packet: dict[str, Any]) -> list[dict[str, str]]:
    values = packet.get("evidence")
    if not isinstance(values, list):
        return []
    out: list[dict[str, str]] = []
    for item in values:
        if not isinstance(item, dict):
            continue
        source_type = item.get("source_type")
        group = item.get("independence_group")
        ref = item.get("ref")
        if all(nonempty_text(value) for value in (source_type, group, ref)):
            out.append({
                "source_type": str(source_type).strip(),
                "independence_group": str(group).strip(),
                "ref": str(ref).strip(),
            })
    return out


def observation_identity(
    packet: dict[str, Any],
) -> tuple[int, bool, int, bool, bool]:
    values = packet.get("observations")
    if not isinstance(values, list):
        return 0, False, 0, False, False

    ids: list[str] = []
    fingerprints: list[str] = []
    complete = True
    for item in values:
        if not isinstance(item, dict):
            complete = False
            continue
        identifier = item.get("id")
        if identifier is None:
            complete = False
        else:
            ids.append(str(identifier))

        fingerprint = item.get("fingerprint")
        if nonempty_text(fingerprint):
            fingerprints.append(str(fingerprint).strip())

    ids_unique = complete and len(ids) == len(values) and len(set(ids)) == len(ids)
    fingerprints_complete = (
        len(fingerprints) == len(values)
        and len(values) > 0
    )
    fingerprints_unique = (
        fingerprints_complete
        and len(set(fingerprints)) == len(fingerprints)
    )
    return (
        len(set(ids)),
        ids_unique,
        len(set(fingerprints)),
        fingerprints_complete,
        fingerprints_unique,
    )


def structured_records(
    packet: dict[str, Any],
    field: str,
    required_text_fields: tuple[str, ...],
) -> tuple[list[dict[str, Any]], bool]:
    values = packet.get(field, [])
    if not isinstance(values, list):
        return [], False
    records = [item for item in values if isinstance(item, dict)]
    valid = len(records) == len(values)
    for item in records:
        if not all(nonempty_text(item.get(key)) for key in required_text_fields):
            valid = False
    return records, valid


def gate(packet: dict[str, Any]) -> dict[str, Any]:
    if packet.get("schema") != SCHEMA:
        raise ValueError("unsupported falsifiability packet schema")

    requested = packet.get("requested_level")
    if requested not in LEVELS:
        raise ValueError(f"requested_level must be one of {LEVELS}")

    hypothesis = packet.get("hypothesis")
    falsifiers = packet.get("falsifiers")
    if not nonempty_text(hypothesis):
        raise ValueError("hypothesis is required")
    if (
        not isinstance(falsifiers, list)
        or not falsifiers
        or not all(nonempty_text(item) for item in falsifiers)
    ):
        raise ValueError("at least one non-empty explicit falsifier is required")

    req = REQUIREMENTS[requested]
    observations = packet.get("observations")
    if not isinstance(observations, list):
        observations = []

    (
        unique_observation_count,
        observations_unique,
        unique_fingerprint_count,
        fingerprints_complete,
        fingerprints_unique,
    ) = observation_identity(packet)

    evidence = valid_evidence(packet)
    declared_evidence = packet.get("evidence")
    declared_evidence_count = (
        len(declared_evidence) if isinstance(declared_evidence, list) else 0
    )
    evidence_structurally_valid = (
        declared_evidence_count > 0
        and len(evidence) == declared_evidence_count
    )
    types = {item["source_type"] for item in evidence}
    groups = {item["independence_group"] for item in evidence}
    refs = [item["ref"] for item in evidence]
    unique_refs = set(refs)

    checks: list[dict[str, Any]] = []

    def add(name: str, passed: bool, observed: Any, required: Any) -> None:
        checks.append({
            "check": name,
            "state": "PASS" if passed else "FAIL",
            "observed": observed,
            "required": required,
        })

    add(
        "minimum_observations",
        unique_observation_count >= req["minimum_observations"]
        and observations_unique,
        {
            "declared": len(observations),
            "unique_ids": unique_observation_count,
            "all_ids_unique": observations_unique,
        },
        req["minimum_observations"],
    )

    if req["requires_repeated_fingerprints"]:
        add(
            "distinct_observation_fingerprints",
            fingerprints_complete
            and fingerprints_unique
            and unique_fingerprint_count >= req["minimum_observations"],
            {
                "unique_fingerprints": unique_fingerprint_count,
                "complete": fingerprints_complete,
                "all_unique": fingerprints_unique,
            },
            req["minimum_observations"],
        )

    add(
        "evidence_records_structurally_valid",
        evidence_structurally_valid,
        {
            "declared": declared_evidence_count,
            "valid": len(evidence),
        },
        "all evidence records require source_type, independence_group and ref",
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
    if req["minimum_independent_source_types"] >= 2:
        add(
            "distinct_evidence_refs",
            len(unique_refs) >= req["minimum_independent_source_types"]
            and len(unique_refs) == len(refs),
            sorted(unique_refs),
            (
                f">={req['minimum_independent_source_types']} distinct refs "
                "with no duplicated evidence ref"
            ),
        )

    booleans = [
        ("temporal_precedence", "requires_temporal_precedence"),
        ("falsifier_attempted", "requires_falsifier_attempt"),
        ("intervention_or_reversal", "requires_intervention_or_reversal"),
        (
            "alternative_explanations_checked",
            "requires_alternative_explanation_check",
        ),
    ]
    for field, requirement_name in booleans:
        required = bool(req[requirement_name])
        observed = packet.get(field, False)
        add(field, (observed is True) if required else True, observed, required)

    falsifier_results, falsifier_valid = structured_records(
        packet, "falsifier_results", ("falsifier", "result")
    )
    temporal_records, temporal_valid = structured_records(
        packet, "temporal_order_evidence", ("source", "result")
    )
    interventions, interventions_valid = structured_records(
        packet, "interventions", ("kind", "result")
    )
    alternatives, alternatives_valid = structured_records(
        packet, "alternative_explanations", ("name", "status")
    )

    if req["requires_falsifier_attempt"]:
        add(
            "falsifier_result_recorded",
            falsifier_valid and len(falsifier_results) >= 1,
            {
                "count": len(falsifier_results),
                "structurally_valid": falsifier_valid,
            },
            ">=1 non-empty structured falsifier result",
        )
    if req["requires_temporal_precedence"]:
        add(
            "temporal_order_evidence_recorded",
            temporal_valid and len(temporal_records) >= 1,
            {
                "count": len(temporal_records),
                "structurally_valid": temporal_valid,
            },
            ">=1 non-empty structured temporal-order evidence item",
        )
    if req["requires_intervention_or_reversal"]:
        add(
            "intervention_recorded",
            interventions_valid and len(interventions) >= 1,
            {
                "count": len(interventions),
                "structurally_valid": interventions_valid,
            },
            ">=1 non-empty controlled intervention/reversal record",
        )
    if req["requires_alternative_explanation_check"]:
        add(
            "alternative_explanations_recorded",
            alternatives_valid and len(alternatives) >= 1,
            {
                "count": len(alternatives),
                "structurally_valid": alternatives_valid,
            },
            ">=1 non-empty structured alternative-explanation review",
        )
        if requested == "CAUSAL_SUPPORTED":
            unresolved_alternatives = [
                item for item in alternatives
                if item.get("status") not in ALTERNATIVE_RESOLVED_STATES
            ]
            add(
                "alternative_explanations_resolved_for_causal_support",
                alternatives_valid
                and bool(alternatives)
                and not unresolved_alternatives,
                len(unresolved_alternatives),
                0,
            )

    contradiction_values = packet.get("contradictory_evidence", [])
    contradictions = (
        [item for item in contradiction_values if isinstance(item, dict)]
        if isinstance(contradiction_values, list)
        else []
    )
    contradictions_valid = (
        isinstance(contradiction_values, list)
        and len(contradictions) == len(contradiction_values)
        and all(nonempty_text(item.get("ref")) for item in contradictions)
    )
    unresolved_contradiction = (
        not contradictions_valid
        or any(item.get("resolved") is not True for item in contradictions)
    )
    add(
        "contradictory_evidence_resolved",
        not unresolved_contradiction,
        {
            "count": len(contradictions),
            "structurally_valid": contradictions_valid,
        },
        "all contradiction records valid and resolved/superseded",
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
    study_mode_valid = study_mode in ("EXPLORATORY", "CONFIRMATORY")
    hypothesis_registered_before_test = (
        packet.get("hypothesis_registered_before_test") is True
    )
    confirmatory_structure_ready = (
        passed
        and study_mode_valid
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
        "evidence_refs": sorted(unique_refs),
        "contradictory_evidence_count": len(contradictions),
        "methodology_structure_complete": promoted_level != "TOKEN_VAZIO",
        "causal_support_structure_complete": promoted_level == "CAUSAL_SUPPORTED",
        "causal_claim_allowed": False,
        "study_mode": study_mode if study_mode_valid else "TOKEN_VAZIO",
        "hypothesis_registered_before_test": hypothesis_registered_before_test,
        "confirmatory_structure_ready": confirmatory_structure_ready,
        "confirmatory_ready": False,
        "publication_grade_causal_support": False,
        "scientific_claim_review_required": True,
        "claim_allowed": False,
        "invariant": (
            "observation != repetition != association != causal candidate "
            "!= causal support; distinct id != distinct observation; "
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

#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

CONTRACT = Path("docs/contracts/frida_atlas_mission_execution_consumer.v1.json")

REQUIRED_INVARIANTS = {
    "DATASET_INFORMS!=MISSION_AUTHORITY",
    "MODEL_PROPOSAL!=EXECUTION_PERMISSION",
    "RETRIEVAL_CONTEXT!=WEIGHT_UPDATE",
    "LEARN_APPEND_ONLY!=ONLINE_SELF_TRAINING",
    "CONTINUE_APPROVED_SCOPE!=AUTONOMOUS_GOAL_CREATION",
    "SOURCE!=DERIVED_INDEX!=EXECUTION!=EVIDENCE!=CLAIM",
    "TOKEN_VAZIO!=0",
    "EXTERNAL_AUTHORITY_REQUIREMENT!=ORCHESTRATOR_PERMISSION",
    "GREEN_GATE_PROMOTES_ONLY_MEASURED_SCOPE",
}

EXPECTED_ROUTE_SUFFIX = [
    "AuthorizedAction",
    "FridaBoundedExecutionProducer",
    "ExecutionResult",
    "ProvenanceReceipt",
    "LEARN:X",
]


def fail(message: str) -> None:
    raise SystemExit(f"FAIL: {message}")


def main() -> None:
    data = json.loads(CONTRACT.read_text(encoding="utf-8"))

    if data.get("schema") != "rafaelia.frida.atlas_mission_execution_consumer/v1":
        fail("unexpected schema")
    if data.get("claim_allowed") is not False:
        fail("claim_allowed must remain false")
    if data.get("source_first") is not True:
        fail("source_first must be true")

    consumer = data.get("consumer", {})
    for key in ("mission_authority", "orchestration_authority", "model_weight_training_authority"):
        if consumer.get(key) is not False:
            fail(f"consumer.{key} must be false")

    producer = data.get("producer_contract", {})
    if producer.get("accepts_only") != "AuthorizedAction":
        fail("producer must accept only AuthorizedAction")
    forbidden_true = (
        "may_create_mission",
        "may_expand_scope_without_authority",
        "may_treat_dataset_as_permission",
        "may_treat_model_output_as_permission",
        "may_train_or_finetune_weights",
        "may_promote_unmeasured_runtime_claim",
    )
    for key in forbidden_true:
        if producer.get(key) is not False:
            fail(f"producer_contract.{key} must be false")

    for key in ("must_emit_execution_result", "must_emit_provenance_receipt", "must_preserve_token_vazio"):
        if producer.get(key) is not True:
            fail(f"producer_contract.{key} must be true")

    invariants = set(data.get("required_invariants", []))
    missing = sorted(REQUIRED_INVARIANTS - invariants)
    if missing:
        fail(f"missing invariants: {missing}")

    route = data.get("route_binding", [])
    if route[-len(EXPECTED_ROUTE_SUFFIX):] != EXPECTED_ROUTE_SUFFIX:
        fail("route suffix does not bind Frida below AuthorizedAction")

    sources = data.get("authority_sources", {})
    expected_sources = {
        "routing": ("rafaelmeloreisnovo/Mapa", "indices/ATLAS_X_MISSION_EXECUTION_CURRENT_V1.json"),
        "orchestration": ("rafaelmeloreisnovo/termux-app-rafacodephi", "docs/contracts/mission_execution_boundary.v1.json"),
        "protected_mission_semantics": ("rafaelmeloreisnovo/Rafaelia_Private", "docs/audit/MISSION_COHESION_SUCCESSOR_RECEIPT_20260907.v1.json"),
    }
    for key, (repo, path) in expected_sources.items():
        source = sources.get(key, {})
        if source.get("repository") != repo or source.get("path") != path:
            fail(f"authority source mismatch: {key}")

    gates = data.get("runtime_gates", {})
    if not gates:
        fail("runtime_gates missing")
    for key, value in gates.items():
        if not isinstance(value, str) or not value.startswith("TOKEN_VAZIO"):
            fail(f"runtime gate {key} must remain TOKEN_VAZIO until evidenced")

    print("PASS: FRIDA_ATLAS_MISSION_BINDING_SOURCE_SCOPE")
    print("claim_allowed=false")
    print("physical_device=TOKEN_VAZIO_DEVICE")
    print("weight_training=TOKEN_VAZIO_SEPARATE_EXPLICIT_CONTRACT_REQUIRED")


if __name__ == "__main__":
    main()

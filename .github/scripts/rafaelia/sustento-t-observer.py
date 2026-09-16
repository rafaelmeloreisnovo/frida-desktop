#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


def canonical(obj: Any) -> bytes:
    return json.dumps(
        obj, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")


def verify_producer_hash(receipt: dict[str, Any]) -> None:
    claimed = receipt.get("receipt_sha256")
    if not isinstance(claimed, str) or len(claimed) != 64:
        raise ValueError("producer receipt_sha256 missing or malformed")
    if any(ch not in "0123456789abcdef" for ch in claimed):
        raise ValueError("producer receipt_sha256 must be lowercase hex")
    material = dict(receipt)
    material.pop("receipt_sha256", None)
    observed = hashlib.sha256(canonical(material)).hexdigest()
    if observed != claimed:
        raise ValueError("producer receipt hash mismatch")


def require_token_vazio(receipt: dict[str, Any], key: str) -> None:
    value = receipt.get(key)
    if not isinstance(value, str) or not value.startswith("TOKEN_VAZIO"):
        raise ValueError(f"{key} cannot be promoted by observer")


def observe(receipt: dict[str, Any], profile: dict[str, Any]) -> dict[str, Any]:
    if profile.get("schema") != "rafaelia.frida.sustento-t-observer.profile.v1":
        raise ValueError("bad observer profile")
    if profile.get("claim_allowed") is not False:
        raise ValueError("observer profile must remain claim_allowed=false")
    if receipt.get("schema") != profile.get("accepted_receipt_schema"):
        raise ValueError("receipt schema mismatch")
    if receipt.get("claim_allowed") is not False:
        raise ValueError("claim promotion forbidden")
    if receipt.get("promotion_allowed") is not False:
        raise ValueError("producer promotion must remain false")
    if receipt.get("boundary") != profile.get("required_boundary"):
        raise ValueError("producer boundary mismatch")

    verify_producer_hash(receipt)
    require_token_vazio(receipt, "physical_detector")
    require_token_vazio(receipt, "quantum_causal_binding")
    require_token_vazio(receipt, "frida_physical_runtime")

    gate = receipt.get("gate")
    if not isinstance(gate, dict):
        raise ValueError("gate object missing")
    if gate.get("state") not in {"PASS", "HOLD", "TOKEN_VAZIO_GATE_INPUT"}:
        raise ValueError("unsupported gate state")
    tau = gate.get("tau")
    if not isinstance(tau, (int, float)) or not 0.0 <= float(tau) <= 1.0:
        raise ValueError("invalid gate tau")
    score = gate.get("score")
    if score is not None and (
        not isinstance(score, (int, float)) or not 0.0 <= float(score) <= 1.0
    ):
        raise ValueError("invalid diagnostic score")

    producer_digest = receipt["receipt_sha256"]
    output = {
        "schema": profile["emitted_receipt_schema"],
        "state": "OBSERVED_BOUNDED_PRODUCER_RECEIPT",
        "claim_allowed": False,
        "promotion_allowed": False,
        "physical_device": "TOKEN_VAZIO",
        "producer_receipt_sha256": producer_digest,
        "gate_state": gate["state"],
        "diagnostic_gate_score": score,
        "gate_tau": float(tau),
        "score_semantics": "DIAGNOSTIC_AGGREGATOR_NOT_TRUTH_PROBABILITY",
        "physical_detector": "TOKEN_VAZIO",
        "quantum_causal_binding": "TOKEN_VAZIO",
        "boundary": "OBSERVATION!=PHYSICAL_RUNTIME!=CLAIM",
    }
    output["observer_receipt_sha256"] = hashlib.sha256(canonical(output)).hexdigest()
    return output


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--receipt", required=True)
    ap.add_argument(
        "--profile", default="profiles/sustento-t-observer.v1.json"
    )
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    receipt = json.loads(Path(args.receipt).read_text(encoding="utf-8"))
    profile = json.loads(Path(args.profile).read_text(encoding="utf-8"))
    result = observe(receipt, profile)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

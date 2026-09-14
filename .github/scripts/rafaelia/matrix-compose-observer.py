#!/usr/bin/env python3
import argparse
import hashlib
import json
from pathlib import Path

def canonical(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":")).encode()

def observe(receipt, profile):
    if profile.get("schema") != "rafaelia.frida.matrix-compose-observer.profile.v1":
        raise ValueError("bad observer profile")
    if profile.get("claim_allowed") is not False:
        raise ValueError("observer profile must remain claim_allowed=false")
    if receipt.get("schema") != profile.get("accepted_receipt_schema"):
        raise ValueError("receipt schema mismatch")
    if receipt.get("claim_allowed") is not False:
        raise ValueError("producer receipt cannot promote claim")
    if receipt.get("boundary") != profile.get("required_boundary"):
        raise ValueError("producer boundary mismatch")
    for key in ("source_spec_sha256", "ifdex_sha256", "packed_cell10_sha256"):
        value = receipt.get(key)
        if not isinstance(value, str) or len(value) != 64 or any(ch not in "0123456789abcdef" for ch in value):
            raise ValueError(f"invalid digest {key}")

    return {
        "schema": profile["emitted_receipt_schema"],
        "state": "OBSERVED_RECEIPT_CI_OR_LOCAL",
        "claim_allowed": False,
        "physical_device": "TOKEN_VAZIO",
        "producer_receipt_sha256": hashlib.sha256(canonical(receipt)).hexdigest(),
        "producer_state": receipt.get("state"),
        "shape": receipt.get("shape"),
        "operator": receipt.get("operator"),
        "boundary": "OBSERVATION!=PHYSICAL_RUNTIME!=CLAIM",
    }

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--receipt", required=True)
    parser.add_argument("--profile", default="profiles/matrix-compose-observer.v1.json")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    receipt = json.loads(Path(args.receipt).read_text())
    profile = json.loads(Path(args.profile).read_text())
    result = observe(receipt, profile)
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_bytes(canonical(result) + b"\n")
    print(json.dumps(result, sort_keys=True))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
import hashlib
import importlib.util
import json
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
MODULE_PATH = HERE / "sustento-t-observer.py"
spec = importlib.util.spec_from_file_location("sustento_t_observer", MODULE_PATH)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def producer_receipt():
    r = {
        "schema": "rafaelia.sustento-t-observation.receipt.v1",
        "state": "EXECUTED_DETERMINISTIC_REFERENCE",
        "claim_allowed": False,
        "promotion_allowed": False,
        "boundary": "SOURCE!=ARTEFACT!=EXECUTION!=EVIDENCE!=CLAIM",
        "model": {},
        "gate": {"state": "PASS", "score": 0.91, "tau": 0.8, "pass": True},
        "noise_sweep": [{"p": 0.1}],
        "geometry": {"exact": {"r6": "27/64"}},
        "physical_detector": "TOKEN_VAZIO",
        "quantum_causal_binding": "TOKEN_VAZIO",
        "frida_physical_runtime": "TOKEN_VAZIO",
    }
    r["receipt_sha256"] = hashlib.sha256(mod.canonical(r)).hexdigest()
    return r


class ObserverTests(unittest.TestCase):
    def setUp(self):
        root = Path(__file__).resolve().parents[3]
        self.profile = json.loads(
            (root / "profiles/sustento-t-observer.v1.json").read_text()
        )

    def test_accepts_bounded_receipt(self):
        result = mod.observe(producer_receipt(), self.profile)
        self.assertFalse(result["claim_allowed"])
        self.assertEqual(result["physical_device"], "TOKEN_VAZIO")
        self.assertEqual(
            result["score_semantics"],
            "DIAGNOSTIC_AGGREGATOR_NOT_TRUTH_PROBABILITY",
        )

    def test_rejects_claim_promotion(self):
        r = producer_receipt()
        r["claim_allowed"] = True
        with self.assertRaises(ValueError):
            mod.observe(r, self.profile)

    def test_rejects_physical_promotion(self):
        r = producer_receipt()
        r["quantum_causal_binding"] = "PASS"
        r["receipt_sha256"] = hashlib.sha256(
            mod.canonical({k: v for k, v in r.items() if k != "receipt_sha256"})
        ).hexdigest()
        with self.assertRaises(ValueError):
            mod.observe(r, self.profile)

    def test_rejects_hash_drift(self):
        r = producer_receipt()
        r["gate"]["score"] = 0.92
        with self.assertRaises(ValueError):
            mod.observe(r, self.profile)


if __name__ == "__main__":
    unittest.main()

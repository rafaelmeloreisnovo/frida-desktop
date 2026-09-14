import importlib.util
import json
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
MODULE_PATH = HERE / "matrix-compose-observer.py"
spec = importlib.util.spec_from_file_location("matrix_compose_observer", MODULE_PATH)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class ObserverTests(unittest.TestCase):
    def setUp(self):
        root = Path(__file__).resolve().parents[3]
        self.profile = json.loads((root / "profiles/matrix-compose-observer.v1.json").read_text())
        self.receipt = {
            "schema": "rafaelia.matrix-compose.receipt.v1",
            "state": "EXECUTED_LOCAL_OR_CI",
            "claim_allowed": False,
            "source_spec_sha256": "0" * 64,
            "ifdex_sha256": "1" * 64,
            "packed_cell10_sha256": "2" * 64,
            "shape": [2, 3],
            "operator": "xor",
            "boundary": "SOURCE!=EXECUTION!=EVIDENCE!=CLAIM"
        }

    def test_accepts_bounded_receipt(self):
        result = mod.observe(self.receipt, self.profile)
        self.assertFalse(result["claim_allowed"])
        self.assertEqual(result["physical_device"], "TOKEN_VAZIO")

    def test_rejects_claim_promotion(self):
        self.receipt["claim_allowed"] = True
        with self.assertRaises(ValueError):
            mod.observe(self.receipt, self.profile)

    def test_rejects_digest_drift(self):
        self.receipt["ifdex_sha256"] = "xyz"
        with self.assertRaises(ValueError):
            mod.observe(self.receipt, self.profile)

if __name__ == "__main__":
    unittest.main()

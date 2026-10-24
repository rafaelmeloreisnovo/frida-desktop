#!/usr/bin/env python3
"""Pure stdlib tests for the Android17 historical APK size comparator."""
import copy
from pathlib import Path
import runpy
import unittest

compare = runpy.run_path(
    str(Path(__file__).resolve().parents[1] / "compare-apk-footprint.py")
)["compare"]
NAMES = (
    "frida-lab-armv7-debug.apk",
    "frida-lab-arm64-debug.apk",
    "frida-lab-universal-debug.apk",
    "frida-lab-physical-universal-debug.apk",
)
HEAD = "d" * 40


def fixtures():
    baseline = {
        "schema": "rafaelia.frida.android17.apk_baseline.v1",
        "route": "android17-apk-elf-dex",
        "gadget_pin": "17.9.11",
        "provenance": {"workflow_run_id": 42, "source_commit": "e" * 40},
        "files": {name: {"bytes": i * 100, "sha256": "a" * 64}
                  for i, name in enumerate(NAMES, start=1)},
    }
    candidate = {
        "schema": "rafaelia.frida.android-lite-footprint.v1",
        "source_ref": HEAD,
        "static_gate": "PASS_SCOPED",
        "failures": [],
        "artifacts": [
            {"path": name, "bytes": i * 100, "sha256": "b" * 64}
            for i, name in enumerate(NAMES, start=1)
        ],
    }
    return baseline, candidate


class ApkCompareTest(unittest.TestCase):
    def test_equal_size_different_bytes_is_not_byte_identical(self):
        b, c = fixtures()
        result = compare(b, c, HEAD, "17.9.11")
        self.assertEqual(result["status"], "PASS_SCOPED_SIZE_NONREGRESSION")
        self.assertTrue(all(item["delta_bytes"] == 0 for item in result["apks"]))
        self.assertTrue(all(not item["sha256_equal"] for item in result["apks"]))
        self.assertFalse(result["claim_allowed"])
        self.assertFalse(result["gradle_build_verified"])

    def test_size_increase_fails(self):
        b, c = fixtures()
        c["artifacts"][0]["bytes"] += 1
        result = compare(b, c, HEAD, "17.9.11")
        self.assertEqual(result["status"], "FAIL_SIZE_REGRESSION")
        self.assertEqual(len(result["size_regressions"]), 1)

    def test_size_reduction_is_only_archive_metric(self):
        b, c = fixtures()
        c["artifacts"][0]["bytes"] -= 1
        result = compare(b, c, HEAD, "17.9.11")
        self.assertEqual(result["status"], "PASS_SCOPED_SIZE_NONREGRESSION")
        self.assertFalse(result["physical_rss_verified"])

    def test_missing_artifact_fails_closed(self):
        b, c = fixtures()
        c["artifacts"].pop()
        with self.assertRaises(ValueError):
            compare(b, c, HEAD, "17.9.11")

    def test_duplicate_artifact_fails_closed(self):
        b, c = fixtures()
        c["artifacts"].append(copy.deepcopy(c["artifacts"][0]))
        with self.assertRaises(ValueError):
            compare(b, c, HEAD, "17.9.11")

    def test_mismatched_commit_fails_closed(self):
        b, c = fixtures()
        with self.assertRaises(ValueError):
            compare(b, c, "f" * 40, "17.9.11")

    def test_mismatched_frida_version_fails_closed(self):
        b, c = fixtures()
        with self.assertRaises(ValueError):
            compare(b, c, HEAD, "17.8.0")

    def test_bad_digest_fails_closed(self):
        b, c = fixtures()
        c["artifacts"][0]["sha256"] = "b" * 40
        with self.assertRaises(ValueError):
            compare(b, c, HEAD, "17.9.11")

    def test_baseline_wrong_route_fails_closed(self):
        b, c = fixtures()
        b["route"] = "gradle"
        with self.assertRaises(ValueError):
            compare(b, c, HEAD, "17.9.11")


if __name__ == "__main__":
    unittest.main()

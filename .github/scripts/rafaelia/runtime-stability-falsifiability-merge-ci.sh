#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

BUILD_DIR="build/runtime-stability-falsifiability-merge"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

python3 -m py_compile \
  tools/runtime-stability-baseline.py \
  tools/runtime-stability-evidence-gate.py \
  tools/runtime_stability_storage.py \
  tools/runtime-stability-diff.py \
  tools/capture-runtime-stability-dump.py

python3 - <<'PY'
import copy
import json
from pathlib import Path

root = Path("build/runtime-stability-falsifiability-merge")

base = {
  "schema": "rafaelia.android.runtime-stability/v2",
  "claim_allowed": False,
  "instrumentation_identity": {
    "frida_version": "17.0.0",
    "script_runtime": "QJS"
  },
  "stable_identity": {
    "arch": "arm",
    "pointer_size": 4,
    "page_size": 4096,
    "platform": "linux",
    "java_available": False,
    "java_identity": "TOKEN_VAZIO_NATIVE_ONLY",
    "platform_contract": {}
  },
  "visibility": {
    "modules": "PASS",
    "threads": "PASS",
    "memory_ranges": "PASS",
    "java_runtime": "TOKEN_VAZIO",
    "system_properties": "TOKEN_VAZIO"
  },
  "consistency": {
    "snapshot_atomic": False,
    "module_surface_stable_during_capture": True
  },
  "timing": {"wall_duration_ms": 2},
  "platform_key_hint": "hint",
  "module_surface_key_hint": "modules",
  "recognition_key_hint": "recognition",
  "runtime_state": {
    "pid": 100,
    "current_tid": 101,
    "debugger_attached": True,
    "code_signing_policy": "optional",
    "modules": {
      "status": "PASS",
      "count": 2,
      "modules": [
        {"name": "liba.so", "size": 4096, "base": "0x1000"},
        {"name": "libb.so", "size": 8192, "base": "0x2000"}
      ]
    },
    "threads": {"status": "PASS", "count": 4, "states": {"waiting": 4}},
    "memory_ranges": {
      "status": "PASS",
      "total_ranges": 10,
      "total_bytes": 40960,
      "by_exact_protection": {}
    },
    "java_runtime": "TOKEN_VAZIO",
    "android_services": {}
  },
  "platform_context": {
    "boot_session_sha256": "b" * 64
  }
}

for i in range(1, 4):
    row = copy.deepcopy(base)
    row["capture_seq"] = i
    row["capture_provenance"] = {
      "agent_sha256": "a" * 64,
      "controller_sha256": "c" * 64,
      "frida_python_version": "17.0.0",
      "controller_run_id": f"run-{i}",
      "condition_id": "idle-v1"
    }
    row["runtime_state"]["threads"]["count"] = 3 + i
    (root / f"sample-{i}.json").write_text(json.dumps(row), encoding="utf-8")

candidate = copy.deepcopy(base)
candidate["capture_seq"] = 10
candidate["capture_provenance"] = {
  "agent_sha256": "a" * 64,
  "controller_sha256": "c" * 64,
  "frida_python_version": "17.0.0",
  "controller_run_id": "candidate-run",
  "condition_id": "idle-v1"
}
candidate["runtime_state"]["threads"]["count"] = 40
(root / "candidate.json").write_text(json.dumps(candidate), encoding="utf-8")

different_condition = copy.deepcopy(candidate)
different_condition["capture_provenance"]["controller_run_id"] = "condition-run"
different_condition["capture_provenance"]["condition_id"] = "load-v1"
(root / "different-condition.json").write_text(
    json.dumps(different_condition), encoding="utf-8"
)
PY

python3 tools/runtime-stability-baseline.py build \
  "$BUILD_DIR/sample-1.json" "$BUILD_DIR/sample-2.json" "$BUILD_DIR/sample-3.json" \
  --out "$BUILD_DIR/baseline.json"
python3 tools/runtime-stability-baseline.py assess \
  "$BUILD_DIR/baseline.json" "$BUILD_DIR/candidate.json" \
  --out "$BUILD_DIR/assessment.json"
python3 tools/runtime-stability-diff.py \
  "$BUILD_DIR/sample-1.json" "$BUILD_DIR/different-condition.json" \
  --out "$BUILD_DIR/condition-diff.json" || true

cat > "$BUILD_DIR/causal-structure.json" <<'JSON'
{
  "schema": "rafaelia.runtime-stability.falsifiability-packet/v1",
  "hypothesis_id": "H-CONTROLLED-FAULT",
  "hypothesis": "controlled fault precedes and reproduces the observed outcome",
  "requested_level": "CAUSAL_SUPPORTED",
  "study_mode": "CONFIRMATORY",
  "hypothesis_registered_before_test": true,
  "falsifiers": ["remove the controlled fault and require the outcome to disappear"],
  "observations": [
    {"id": "o1", "fingerprint": "1111111111111111111111111111111111111111111111111111111111111111"},
    {"id": "o2", "fingerprint": "2222222222222222222222222222222222222222222222222222222222222222"},
    {"id": "o3", "fingerprint": "3333333333333333333333333333333333333333333333333333333333333333"}
  ],
  "evidence": [
    {"source_type": "frida_dump", "independence_group": "frida", "ref": "evidence://frida/a"},
    {"source_type": "tombstone", "independence_group": "android", "ref": "evidence://tombstone/a"}
  ],
  "falsifier_attempted": true,
  "temporal_precedence": true,
  "intervention_or_reversal": true,
  "alternative_explanations_checked": true,
  "falsifier_results": [
    {"falsifier": "remove fault", "result": "outcome absent", "evidence_ref": "evidence://frida/a"}
  ],
  "temporal_order_evidence": [
    {"source": "monotonic clock", "result": "fault before outcome", "evidence_ref": "evidence://tombstone/a"}
  ],
  "interventions": [
    {"kind": "controlled removal", "result": "outcome absent", "evidence_ref": "evidence://frida/a"}
  ],
  "alternative_explanations": [
    {"name": "ASLR", "status": "BOUNDED_NOT_EXPLANATORY", "evidence_ref": "evidence://tombstone/a"}
  ],
  "contradictory_evidence": []
}
JSON

python3 tools/runtime-stability-evidence-gate.py \
  "$BUILD_DIR/causal-structure.json" --out "$BUILD_DIR/causal-result.json"

python3 - <<'PY'
import json
from pathlib import Path

root = Path("build/runtime-stability-falsifiability-merge")
baseline = json.loads((root / "baseline.json").read_text())
assessment = json.loads((root / "assessment.json").read_text())
condition = json.loads((root / "condition-diff.json").read_text())
causal = json.loads((root / "causal-result.json").read_text())

assert baseline["baseline_gate"] == "PASS"
assert baseline["sample_count"] == 3
assert assessment["classification"] == "RUNTIME_OUTLIER_OBSERVED"
assert assessment["causality"] == "NOT_INFERRED"
assert condition["classification"] == "INCOMPARABLE_CONDITION"
assert condition["claim_allowed"] is False
assert causal["gate"] == "PASS"
assert causal["highest_supported_level"] == "CAUSAL_SUPPORTED"
assert causal["causal_support_structure_complete"] is True
assert causal["causal_claim_allowed"] is False
assert causal["publication_grade_causal_support"] is False
assert causal["claim_allowed"] is False
PY

printf '%s\n' 'RUNTIME_STABILITY_FALSIFIABILITY_MERGE_GATE_PASS'

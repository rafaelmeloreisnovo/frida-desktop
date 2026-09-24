#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=ci-common.sh
source "$SCRIPT_DIR/ci-common.sh"

ROOT="$(rafaelia_repo_root)"
cd "$ROOT"

BUILD_DIR="build/android-runtime-stability-dump"
EVIDENCE_DIR="evidence/android-runtime-stability-dump"
mkdir -p "$BUILD_DIR" "$EVIDENCE_DIR"

rafaelia_need_cmd node
rafaelia_need_cmd python3

node --check agents/android-runtime-stability-dump.js
python3 -m py_compile tools/runtime-stability-diff.py tools/capture-runtime-stability-dump.py tools/runtime-stability-baseline.py tools/runtime-stability-evidence-gate.py

python3 - <<'PY'
import json
from pathlib import Path

profile = json.loads(
    Path('profiles/android-runtime-stability-dump.v1.json').read_text()
)
assert profile['claim_allowed'] is False
assert profile['capture_mode']['periodic_polling'] is False
assert profile['capture_mode']['active_mutation'] is False
assert 'ASLR module bases' in profile['recognition']['excludes']
assert profile['privacy']['module_paths'] == 'not collected'
assert profile['privacy']['process_name'] == 'not collected'
assert 'recognition_surface' in profile['semantic_layers']
method = json.loads(Path('profiles/runtime-stability-methodology.v1.json').read_text())
assert method['claim_allowed'] is False
assert method['baseline']['minimum_independent_snapshots'] == 3
assert method['baseline']['numeric_center'] == 'median'
assert method['baseline']['numeric_dispersion'] == 'median_absolute_deviation'
assert 'drift != instability' in method['falsifiability_invariants']
PY

if grep -En 'Build\.SERIAL|ANDROID_ID|TelephonyManager|SubscriberId|SimSerial|ClipboardManager|getText\(|readUtf8String|readByteArray|Memory\.read|enumerateClasses|module\.path'     agents/android-runtime-stability-dump.js; then
  rafaelia_die 'forbidden privacy/content surface detected'
fi

cat > "$BUILD_DIR/baseline.json" <<'JSON'
{
  "schema": "rafaelia.android.runtime-stability/v1",
  "stable_identity": {
    "arch": "arm",
    "pointer_size": 4,
    "page_size": 4096,
    "platform": "linux",
    "java_identity": {"sdk": 29}
  },
  "platform_key": "plat1111",
  "module_surface_key": "mod11111",
  "recognition_key": "rec11111",
  "observer": {"agent_schema":"rafaelia.android.runtime-stability/v1","frida_version":"17.0.0","instrumentation_present":true,"capture_wall_duration_ms":2},
  "capture_provenance": {"agent_sha256":"agent-a","controller_sha256":"controller-a","frida_python_version":"17.0.0","controller_run_id":"fixture-base-run"},
  "runtime_state": {
    "debugger_attached": true,
    "code_signing_policy": "optional",
    "modules": {
      "count": 10,
      "stable_set_fingerprint": "mod11111",
      "modules": [
        {"name": "libalpha.so", "base": "0x1000", "size": 4096},
        {"name": "libbeta.so", "base": "0x2000", "size": 8192}
      ]
    },
    "threads": {"count": 4, "states": {"waiting": 4}},
    "memory_ranges": {"rw-": {"count": 2, "bytes": 8192}},
    "java_runtime": {"java_heap_total_bytes": 100}
  }
}
JSON

cp "$BUILD_DIR/baseline.json" "$BUILD_DIR/same.json"
python3 tools/runtime-stability-diff.py   "$BUILD_DIR/baseline.json" "$BUILD_DIR/same.json"   --out "$BUILD_DIR/no-drift.json"

python3 - <<'PY'
import json
from pathlib import Path

root = Path('build/android-runtime-stability-dump')
base = json.loads((root/'baseline.json').read_text())

runtime = json.loads(json.dumps(base))
runtime['runtime_state']['threads']['count'] = 5
(root/'runtime.json').write_text(json.dumps(runtime))

modules = json.loads(json.dumps(base))
modules['module_surface_key'] = 'mod22222'
modules['runtime_state']['modules']['count'] = 11
modules['runtime_state']['modules']['stable_set_fingerprint'] = 'mod22222'
modules['runtime_state']['modules']['modules'].append(
    {"name": "libgamma.so", "base": "0x3000", "size": 4096}
)
(root/'modules.json').write_text(json.dumps(modules))

hash_collision = json.loads(json.dumps(base))
hash_collision['runtime_state']['modules']['modules'][1]['size'] = 12288
(root/'hash-collision.json').write_text(json.dumps(hash_collision))

aslr_only = json.loads(json.dumps(base))
aslr_only['runtime_state']['modules']['modules'][0]['base'] = '0x9000'
aslr_only['runtime_state']['modules']['modules'][1]['base'] = '0xa000'
(root/'aslr-only.json').write_text(json.dumps(aslr_only))

identity = json.loads(json.dumps(base))
identity['platform_key'] = 'plat2222'
identity['stable_identity']['arch'] = 'arm64'
(root/'identity.json').write_text(json.dumps(identity))

hint_only = json.loads(json.dumps(base))
hint_only['platform_key'] = 'different-hint'
hint_only['module_surface_key'] = 'different-module-hint'
hint_only['recognition_key'] = 'different-recognition-hint'
hint_only['runtime_state']['modules']['stable_set_fingerprint'] = 'different-fnv'
(root/'hint-only.json').write_text(json.dumps(hint_only))

observer = json.loads(json.dumps(base))
observer['observer']['frida_version'] = '18.0.0'
(root/'observer.json').write_text(json.dumps(observer))
PY

python3 tools/runtime-stability-diff.py   "$BUILD_DIR/baseline.json" "$BUILD_DIR/runtime.json"   --out "$BUILD_DIR/runtime-drift.json"
python3 tools/runtime-stability-diff.py   "$BUILD_DIR/baseline.json" "$BUILD_DIR/modules.json"   --out "$BUILD_DIR/module-drift.json"
python3 tools/runtime-stability-diff.py   "$BUILD_DIR/baseline.json" "$BUILD_DIR/identity.json"   --out "$BUILD_DIR/identity-drift.json"
python3 tools/runtime-stability-diff.py   "$BUILD_DIR/baseline.json" "$BUILD_DIR/hash-collision.json"   --out "$BUILD_DIR/hash-collision-drift.json"
python3 tools/runtime-stability-diff.py   "$BUILD_DIR/baseline.json" "$BUILD_DIR/aslr-only.json"   --out "$BUILD_DIR/aslr-only.json.out"
python3 tools/runtime-stability-diff.py   "$BUILD_DIR/baseline.json" "$BUILD_DIR/hint-only.json"   --out "$BUILD_DIR/hint-only.out.json"
python3 tools/runtime-stability-diff.py   "$BUILD_DIR/baseline.json" "$BUILD_DIR/observer.json"   --out "$BUILD_DIR/observer-drift.json"

python3 - <<'PY'
import json
from pathlib import Path

root = Path('build/android-runtime-stability-dump')
base = json.loads((root/'baseline.json').read_text())

for index, threads in enumerate((4, 5, 6), start=1):
    row = json.loads(json.dumps(base))
    row['capture_seq'] = index
    row['capture_provenance']['controller_run_id'] = f'fixture-robust-run-{index}'
    row['runtime_state']['threads']['count'] = threads
    row['runtime_state']['java_runtime']['java_heap_total_bytes'] = 100 + (index - 1) * 5
    (root/f'robust-{index}.json').write_text(json.dumps(row))

candidate = json.loads(json.dumps(base))
candidate['capture_seq'] = 10
candidate['capture_provenance']['controller_run_id'] = 'fixture-candidate-run'
candidate['runtime_state']['threads']['count'] = 40
candidate['runtime_state']['java_runtime']['java_heap_total_bytes'] = 500
(root/'robust-candidate.json').write_text(json.dumps(candidate))
PY

python3 tools/runtime-stability-baseline.py build   "$BUILD_DIR/robust-1.json" "$BUILD_DIR/robust-2.json" "$BUILD_DIR/robust-3.json"   --out "$BUILD_DIR/robust-baseline.json"
python3 tools/runtime-stability-baseline.py assess   "$BUILD_DIR/robust-baseline.json" "$BUILD_DIR/robust-candidate.json"   --out "$BUILD_DIR/robust-assessment.json"

set +e
python3 tools/runtime-stability-baseline.py build   "$BUILD_DIR/robust-1.json" "$BUILD_DIR/robust-1.json" "$BUILD_DIR/robust-2.json"   --out "$BUILD_DIR/duplicate-baseline.json"
DUPLICATE_BASELINE_RC=$?
set -e
[[ "$DUPLICATE_BASELINE_RC" -ne 0 ]] || rafaelia_die "duplicate baseline evidence was accepted"

python3 - <<'PY'
import json
from pathlib import Path
root = Path('build/android-runtime-stability-dump')
a = json.loads((root/'robust-1.json').read_text())
b = json.loads((root/'robust-2.json').read_text())
c = json.loads((root/'robust-3.json').read_text())
c['stable_identity']['arch'] = 'arm64'
c['platform_key'] = 'different-platform'
(root/'identity-mismatch-3.json').write_text(json.dumps(c))
PY

set +e
python3 tools/runtime-stability-baseline.py build   "$BUILD_DIR/robust-1.json" "$BUILD_DIR/robust-2.json" "$BUILD_DIR/identity-mismatch-3.json"   --out "$BUILD_DIR/identity-mismatch-baseline.json"
IDENTITY_BASELINE_RC=$?
set -e
[[ "$IDENTITY_BASELINE_RC" -eq 2 ]] || rafaelia_die "identity-inconsistent baseline did not fail closed"

cat > "$BUILD_DIR/repeated-packet.json" <<'JSON'
{
  "schema": "rafaelia.runtime-stability.falsifiability-packet/v1",
  "hypothesis_id": "H-RUNTIME-THREAD-DRIFT",
  "hypothesis": "thread-count deviation repeats under comparable conditions",
  "requested_level": "REPEATED",
  "falsifiers": ["repeat under same stable identity and fail if deviation disappears"],
  "observations": [{"id":1},{"id":2},{"id":3}],
  "evidence": [{"source_type":"frida_runtime_dump","independence_group":"frida-agent","ref":"dump://1"}],
  "falsifier_attempted": true,
  "temporal_precedence": false,
  "intervention_or_reversal": false,
  "alternative_explanations_checked": false,
  "contradictory_evidence": []
}
JSON

cat > "$BUILD_DIR/causal-pass-packet.json" <<'JSON'
{
  "schema": "rafaelia.runtime-stability.falsifiability-packet/v1",
  "hypothesis_id": "H-NATIVE-FAULT-CAUSE",
  "hypothesis": "a controlled native fault causes the observed outcome",
  "requested_level": "CAUSAL_SUPPORTED",
  "falsifiers": ["remove the controlled fault and require the outcome to disappear"],
  "observations": [{"id":1},{"id":2},{"id":3}],
  "evidence": [
    {"source_type":"frida_runtime_dump","independence_group":"frida-agent","ref":"dump://a"},
    {"source_type":"tombstone","independence_group":"android-tombstoned","ref":"tombstone://a"}
  ],
  "falsifier_attempted": true,
  "temporal_precedence": true,
  "intervention_or_reversal": true,
  "alternative_explanations_checked": true,
  "contradictory_evidence": []
}
JSON

cat > "$BUILD_DIR/duplicate-observation-packet.json" <<'JSON'
{
  "schema": "rafaelia.runtime-stability.falsifiability-packet/v1",
  "hypothesis_id": "H-DUP-OBS",
  "hypothesis": "duplicating one observation counts as repetition",
  "requested_level": "REPEATED",
  "falsifiers": ["require unique observation ids"],
  "observations": [{"id":"same"},{"id":"same"},{"id":"same"}],
  "evidence": [{"source_type":"frida_runtime_dump","independence_group":"frida-agent","ref":"dump://same"}],
  "falsifier_attempted": true,
  "contradictory_evidence": []
}
JSON

cat > "$BUILD_DIR/false-independence-packet.json" <<'JSON'
{
  "schema": "rafaelia.runtime-stability.falsifiability-packet/v1",
  "hypothesis_id": "H-FALSE-INDEPENDENCE",
  "hypothesis": "two labels from one collection channel count as independent evidence",
  "requested_level": "ASSOCIATED",
  "falsifiers": ["require independent acquisition groups"],
  "observations": [{"id":1},{"id":2},{"id":3}],
  "evidence": [
    {"source_type":"frida_runtime_dump","independence_group":"same-channel","ref":"dump://a"},
    {"source_type":"tombstone","independence_group":"same-channel","ref":"derived://a"}
  ],
  "falsifier_attempted": true,
  "temporal_precedence": false,
  "intervention_or_reversal": false,
  "alternative_explanations_checked": true,
  "contradictory_evidence": []
}
JSON

cat > "$BUILD_DIR/causal-fail-packet.json" <<'JSON'
{
  "schema": "rafaelia.runtime-stability.falsifiability-packet/v1",
  "hypothesis_id": "H-UNSUPPORTED-CAUSE",
  "hypothesis": "one drift observation caused the crash",
  "requested_level": "CAUSAL_SUPPORTED",
  "falsifiers": ["repeat without the drift"],
  "observations": [{"id":1}],
  "evidence": [{"source_type":"frida_runtime_dump","independence_group":"frida-agent","ref":"dump://only"}],
  "falsifier_attempted": false,
  "temporal_precedence": false,
  "intervention_or_reversal": false,
  "alternative_explanations_checked": false,
  "contradictory_evidence": []
}
JSON

python3 tools/runtime-stability-evidence-gate.py   "$BUILD_DIR/repeated-packet.json" --out "$BUILD_DIR/repeated-result.json"
python3 tools/runtime-stability-evidence-gate.py   "$BUILD_DIR/causal-pass-packet.json" --out "$BUILD_DIR/causal-pass-result.json"

set +e
python3 tools/runtime-stability-evidence-gate.py   "$BUILD_DIR/duplicate-observation-packet.json" --out "$BUILD_DIR/duplicate-observation-result.json"
DUP_OBS_RC=$?
set -e
[[ "$DUP_OBS_RC" -eq 2 ]] || rafaelia_die "duplicate observations were accepted as repetition"

set +e
python3 tools/runtime-stability-evidence-gate.py   "$BUILD_DIR/false-independence-packet.json" --out "$BUILD_DIR/false-independence-result.json"
FALSE_INDEPENDENCE_RC=$?
set -e
[[ "$FALSE_INDEPENDENCE_RC" -eq 2 ]] || rafaelia_die "false independence was accepted"

set +e
python3 tools/runtime-stability-evidence-gate.py   "$BUILD_DIR/causal-fail-packet.json" --out "$BUILD_DIR/causal-fail-result.json"
CAUSAL_FAIL_RC=$?
set -e
[[ "$CAUSAL_FAIL_RC" -eq 2 ]] || rafaelia_die "unsupported causal packet did not fail closed"

python3 - <<'PY'
import json
from pathlib import Path

root = Path('build/android-runtime-stability-dump')
assert json.loads((root/'no-drift.json').read_text())['classification'] == 'NO_OBSERVED_DRIFT'
assert json.loads((root/'runtime-drift.json').read_text())['classification'] == 'RUNTIME_DRIFT'
assert json.loads((root/'module-drift.json').read_text())['classification'] == 'MODULE_SURFACE_DRIFT'
assert json.loads((root/'identity-drift.json').read_text())['classification'] == 'IDENTITY_DRIFT'
assert json.loads((root/'hash-collision-drift.json').read_text())['classification'] == 'MODULE_SURFACE_DRIFT'
assert json.loads((root/'aslr-only.json.out').read_text())['classification'] == 'NO_OBSERVED_DRIFT'
hint = json.loads((root/'hint-only.out.json').read_text())
assert hint['classification'] == 'NO_OBSERVED_DRIFT'
assert len(hint['hint_changes']) >= 1
assert hint['compact_fingerprints_authoritative'] is False
assert json.loads((root/'observer-drift.json').read_text())['classification'] == 'OBSERVER_DRIFT'
robust = json.loads((root/'robust-baseline.json').read_text())
assert robust['baseline_gate'] == 'PASS'
assert robust['sample_count'] == 3
assert robust['baseline_strength'] == 'MINIMAL'
assessment = json.loads((root/'robust-assessment.json').read_text())
assert assessment['classification'] == 'RUNTIME_OUTLIER_OBSERVED'
assert assessment['causality'] == 'NOT_INFERRED'
repeated = json.loads((root/'repeated-result.json').read_text())
assert repeated['gate'] == 'PASS'
assert repeated['highest_supported_level'] == 'REPEATED'
causal_pass = json.loads((root/'causal-pass-result.json').read_text())
assert causal_pass['gate'] == 'PASS'
assert causal_pass['highest_supported_level'] == 'CAUSAL_SUPPORTED'
assert causal_pass['causal_claim_allowed'] is True
duplicate_observation = json.loads((root/'duplicate-observation-result.json').read_text())
assert duplicate_observation['gate'] == 'FAIL'
false_independence = json.loads((root/'false-independence-result.json').read_text())
assert false_independence['gate'] == 'FAIL'
assert false_independence['causal_claim_allowed'] is False
causal_fail = json.loads((root/'causal-fail-result.json').read_text())
assert causal_fail['gate'] == 'FAIL'
assert causal_fail['causal_claim_allowed'] is False
PY

rafaelia_write_sha256_manifest "$EVIDENCE_DIR/SOURCE_SHA256SUMS.txt"   agents/android-runtime-stability-dump.js   profiles/android-runtime-stability-dump.v1.json   profiles/runtime-stability-methodology.v1.json   tools/runtime-stability-diff.py   tools/capture-runtime-stability-dump.py   tools/runtime-stability-baseline.py   tools/runtime-stability-evidence-gate.py   docs/android-runtime-stability-dump.md   docs/runtime-stability-falsifiability.md

GITHUB_REPOSITORY="${GITHUB_REPOSITORY:-LOCAL}" GITHUB_RUN_ID="${GITHUB_RUN_ID:-0}" GITHUB_SHA="${GITHUB_SHA:-LOCAL}" python3 - <<'PY'
import json
import os
from pathlib import Path

receipt = {
    'schema': 'rafaelia.android.runtime-stability-dump.receipt/v1',
    'repository': os.environ['GITHUB_REPOSITORY'],
    'run_id': int(os.environ['GITHUB_RUN_ID']),
    'sha': os.environ['GITHUB_SHA'],
    'agent_syntax': 'PASS',
    'profile_contract': 'PASS',
    'privacy_guard': 'PASS',
    'diff_no_drift': 'PASS',
    'diff_runtime_drift': 'PASS',
    'diff_module_surface_drift': 'PASS',
    'diff_identity_drift': 'PASS',
    'diff_hash_collision_resistance_by_full_surface': 'PASS',
    'diff_aslr_base_exclusion': 'PASS',
    'append_only_controller_syntax': 'PASS',
    'robust_baseline_median_mad': 'PASS',
    'candidate_outlier_without_causal_promotion': 'PASS',
    'falsifiability_repeated_gate': 'PASS',
    'falsifiability_causal_supported_gate': 'PASS',
    'unsupported_causal_claim_fail_closed': 'PASS',
    'duplicate_baseline_rejected': 'PASS',
    'distinct_controller_run_provenance_required': 'PASS',
    'identity_inconsistent_baseline_rejected': 'PASS',
    'false_independence_rejected': 'PASS',
    'duplicate_observation_rejected': 'PASS',
    'compact_hint_non_authority': 'PASS',
    'observer_drift_separated': 'PASS',
    'atomic_publication_contract_static': 'PASS',
    'frida_device_execution': 'TOKEN_VAZIO',
    'physical_stability': 'TOKEN_VAZIO',
    'causal_attribution': 'TOKEN_VAZIO',
    'claim_allowed': False
}
Path('evidence/android-runtime-stability-dump/receipt.json').write_text(
    json.dumps(receipt, indent=2, sort_keys=True) + '\n',
    encoding='utf-8'
)
PY

printf '%s\n' 'ANDROID_RUNTIME_STABILITY_DUMP_GATE_PASS'

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
python3 -m py_compile tools/runtime-stability-diff.py

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
PY

if grep -En 'Build\.SERIAL|ANDROID_ID|TelephonyManager|SubscriberId|SimSerial|ClipboardManager|getText\(|readUtf8String|readByteArray|Memory\.read|enumerateClasses|module\.path'     agents/android-runtime-stability-dump.js; then
  rafaelia_die 'forbidden privacy/content surface detected'
fi

cat > "$BUILD_DIR/baseline.json" <<'JSON'
{
  "stable_identity": {
    "arch": "arm",
    "pointer_size": 4,
    "page_size": 4096,
    "platform": "linux",
    "module_set_fingerprint": "aaaa1111",
    "java_identity": {"sdk": 29}
  },
  "recognition_key": "bbbb2222",
  "runtime_state": {
    "debugger_attached": true,
    "code_signing_policy": "optional",
    "modules": {"count": 10},
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

base = json.loads(Path('build/android-runtime-stability-dump/baseline.json').read_text())
runtime = json.loads(json.dumps(base))
runtime['runtime_state']['threads']['count'] = 5
Path('build/android-runtime-stability-dump/runtime.json').write_text(
    json.dumps(runtime)
)
identity = json.loads(json.dumps(base))
identity['recognition_key'] = 'cccc3333'
Path('build/android-runtime-stability-dump/identity.json').write_text(
    json.dumps(identity)
)
PY

python3 tools/runtime-stability-diff.py   "$BUILD_DIR/baseline.json" "$BUILD_DIR/runtime.json"   --out "$BUILD_DIR/runtime-drift.json"
python3 tools/runtime-stability-diff.py   "$BUILD_DIR/baseline.json" "$BUILD_DIR/identity.json"   --out "$BUILD_DIR/identity-drift.json"

python3 - <<'PY'
import json
from pathlib import Path

root = Path('build/android-runtime-stability-dump')
assert json.loads((root/'no-drift.json').read_text())['classification'] == 'NO_OBSERVED_DRIFT'
assert json.loads((root/'runtime-drift.json').read_text())['classification'] == 'RUNTIME_DRIFT'
assert json.loads((root/'identity-drift.json').read_text())['classification'] == 'IDENTITY_DRIFT'
PY

rafaelia_write_sha256_manifest "$EVIDENCE_DIR/SOURCE_SHA256SUMS.txt"   agents/android-runtime-stability-dump.js   profiles/android-runtime-stability-dump.v1.json   tools/runtime-stability-diff.py   docs/android-runtime-stability-dump.md

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
    'diff_identity_drift': 'PASS',
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

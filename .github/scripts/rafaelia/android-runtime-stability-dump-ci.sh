#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=ci-common.sh
source "$SCRIPT_DIR/ci-common.sh"

ROOT="$(rafaelia_repo_root)"
cd "$ROOT"

BUILD_DIR="build/android-runtime-stability-dump-v2"
EVIDENCE_DIR="evidence/android-runtime-stability-dump"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR" "$EVIDENCE_DIR"

rafaelia_need_cmd node
rafaelia_need_cmd python3

node --check agents/android-runtime-stability-dump.js
python3 -m py_compile tools/runtime-stability-diff.py tools/capture-runtime-stability-dump.py

python3 - <<'PY'
import json
from pathlib import Path

profile = json.loads(Path('profiles/android-runtime-stability-dump.v2.json').read_text())
matrix = json.loads(Path('profiles/runtime-stability-falsification-matrix.v1.json').read_text())
assert profile['claim_allowed'] is False
assert profile['consistency']['model'] == 'BEST_EFFORT_NON_ATOMIC'
assert profile['capture_mode']['periodic_polling'] is False
assert profile['capture_mode']['event_observers_default'] is False
assert profile['recognition']['compact_fingerprint_role'] == 'HINT_ONLY'
assert profile['privacy']['target_selector_persisted'] is False
assert len(matrix['hypotheses']) >= 16
assert all(row.get('falsifier') for row in matrix['hypotheses'])
assert matrix['physical_promotion_rule']['minimum_independent_runs'] >= 3
PY

if grep -En 'Build\.SERIAL|ANDROID_ID|TelephonyManager|SubscriberId|SimSerial|ClipboardManager|getText\(|readUtf8String|readByteArray|Memory\.read|enumerateClasses|module\.path' agents/android-runtime-stability-dump.js; then
  rafaelia_die 'forbidden privacy/content surface detected'
fi

grep -Fq "protection: '---'" agents/android-runtime-stability-dump.js
! grep -Fq "const protections = ['r--', 'rw-', 'r-x', 'rwx']" agents/android-runtime-stability-dump.js
grep -Fq "BEST_EFFORT_NON_ATOMIC" agents/android-runtime-stability-dump.js
grep -Fq "CALLER_DEFINED" agents/android-runtime-stability-dump.js
grep -Fq "Frida.version" agents/android-runtime-stability-dump.js
grep -Fq "Script.runtime" agents/android-runtime-stability-dump.js
grep -Fq "Process.attachModuleObserver" agents/android-runtime-stability-dump.js
grep -Fq "Process.attachThreadObserver" agents/android-runtime-stability-dump.js
grep -Fq "names_collected: false" agents/android-runtime-stability-dump.js
grep -Fq "SAFE_SYSTEM_PROPERTIES" agents/android-runtime-stability-dump.js
grep -Fq "Debug.getPss()" agents/android-runtime-stability-dump.js
grep -Fq "runtime-stability-hypermemory-event/v1" modules/runtime-learning-engine/runtime-stability-hypermemory-bridge.ts
grep -Fq "causality: 'NOT_INFERRED'" modules/runtime-learning-engine/runtime-stability-hypermemory-bridge.ts
grep -Fq "full_module_list_embedded: false" modules/runtime-learning-engine/runtime-stability-hypermemory-bridge.ts

if grep -En "ro\.boot\.psn|vendor\.gsm\.serial|gsm\.|ril\.|iccid|imsi|operator\.numeric|subscriber" agents/android-runtime-stability-dump.js; then
  rafaelia_die 'forbidden telephony/device-identity property surfaced in stability agent'
fi

cat > "$BUILD_DIR/baseline.json" <<'JSON'
{
  "schema": "rafaelia.android.runtime-stability/v2",
  "claim_allowed": false,
  "capture_seq": 1,
  "reason": "BASELINE",
  "timing": {
    "wall_start_epoch_ms": 1000,
    "wall_end_epoch_ms": 1010,
    "wall_duration_ms": 10,
    "monotonic_duration_ms": 10
  },
  "instrumentation_identity": {
    "frida_version": "17.0.0",
    "script_runtime": "QJS"
  },
  "stable_identity": {
    "arch": "arm",
    "pointer_size": 4,
    "page_size": 4096,
    "platform": "linux",
    "java_identity": {"sdk": 29, "build_fingerprint": "test"},
    "platform_contract": {
      "ro.zygote": "zygote32",
      "sys.use_memfd": "false",
      "ro.vndk.version": "29"
    }
  },
  "platform_key_hint": "plat1111",
  "module_surface_key_hint": "mod11111",
  "recognition_key_hint": "rec11111",
  "visibility": {
    "modules": "PASS",
    "threads": "PASS",
    "memory_ranges": "PASS",
    "java_runtime": "PASS",
    "android_clock_start": "PASS",
    "android_clock_end": "PASS"
  },
  "runtime_state": {
    "pid": 100,
    "current_tid": 101,
    "debugger_attached": true,
    "code_signing_policy": "optional",
    "observer": {
      "frida_heap_size_bytes": 4096,
      "kernel_api_available": false
    },
    "modules": {
      "status": "PASS",
      "count": 2,
      "stable_set_fingerprint_hint": "mod11111",
      "modules": [
        {"name": "libalpha.so", "base": "0x1000", "size": 4096},
        {"name": "libbeta.so", "base": "0x2000", "size": 8192}
      ]
    },
    "threads": {"status": "PASS", "count": 4, "states": {"waiting": 4}},
    "memory_ranges": {
      "status": "PASS",
      "total_ranges": 2,
      "total_bytes": 12288,
      "by_exact_protection": {
        "r--": {"count": 1, "bytes": 4096},
        "rw-": {"count": 1, "bytes": 8192}
      }
    },
    "java_runtime": {
      "java_heap_total_bytes": 100,
      "java_heap_free_bytes": 50,
      "java_heap_max_bytes": 200,
      "native_heap_allocated_bytes": 25,
      "native_heap_size_bytes": 40,
      "native_heap_free_bytes": 15,
      "process_pss_kb": 12000,
      "loaded_class_count": 5000
    },
    "android_services": {
      "init.svc.lmkd": "running",
      "init.svc.ashmemd": "running"
    }
  }
}
JSON

python3 - <<'PY'
import copy
import json
from pathlib import Path

root = Path('build/android-runtime-stability-dump-v2')
base = json.loads((root/'baseline.json').read_text())

def put(name, mutator):
    data = copy.deepcopy(base)
    mutator(data)
    (root/name).write_text(json.dumps(data), encoding='utf-8')

put('same.json', lambda d: None)
put('runtime.json', lambda d: d['runtime_state']['threads'].__setitem__('count', 5))
put('module.json', lambda d: d['runtime_state']['modules']['modules'][1].__setitem__('size', 12288))
put('identity.json', lambda d: d['stable_identity'].__setitem__('arch', 'arm64'))
put('platform-contract.json', lambda d: d['stable_identity']['platform_contract'].__setitem__('sys.use_memfd', 'true'))
put('service.json', lambda d: d['runtime_state']['android_services'].__setitem__('init.svc.lmkd', 'stopped'))
put('instrumentation.json', lambda d: d['instrumentation_identity'].__setitem__('frida_version', '17.1.0'))
put('visibility.json', lambda d: d['visibility'].__setitem__('memory_ranges', 'TOKEN_VAZIO'))
put('aslr.json', lambda d: d['runtime_state']['modules']['modules'][0].__setitem__('base', '0x9000'))
put('clock.json', lambda d: d['timing'].update({'wall_start_epoch_ms': 9000, 'wall_end_epoch_ms': 9025, 'wall_duration_ms': 25, 'monotonic_duration_ms': 24}))
put('pid.json', lambda d: d['runtime_state'].update({'pid': 999, 'current_tid': 1000}))
put('hints.json', lambda d: d.update({'platform_key_hint': 'different', 'module_surface_key_hint': 'different', 'recognition_key_hint': 'different'}))
bad = copy.deepcopy(base)
bad['schema'] = 'rafaelia.android.runtime-stability/v1'
(root/'bad-schema.json').write_text(json.dumps(bad), encoding='utf-8')
PY

run_diff() {
  local input="$1"
  local output="$2"
  python3 tools/runtime-stability-diff.py "$BUILD_DIR/baseline.json" "$BUILD_DIR/$input" --out "$BUILD_DIR/$output"
}

run_diff same.json same.out.json
run_diff runtime.json runtime.out.json
run_diff module.json module.out.json
run_diff identity.json identity.out.json
run_diff platform-contract.json platform-contract.out.json
run_diff service.json service.out.json
run_diff instrumentation.json instrumentation.out.json
run_diff visibility.json visibility.out.json
run_diff aslr.json aslr.out.json
run_diff clock.json clock.out.json
run_diff pid.json pid.out.json
run_diff hints.json hints.out.json

set +e
python3 tools/runtime-stability-diff.py "$BUILD_DIR/baseline.json" "$BUILD_DIR/bad-schema.json" --out "$BUILD_DIR/incomparable.out.json"
incomparable_rc=$?
set -e
[[ "$incomparable_rc" -eq 2 ]]

python3 - <<'PY'
import json
from pathlib import Path
root = Path('build/android-runtime-stability-dump-v2')

def c(name):
    return json.loads((root/name).read_text())

assert c('same.out.json')['classification'] == 'NO_OBSERVED_DRIFT'
assert c('runtime.out.json')['classification'] == 'RUNTIME_DRIFT'
assert c('module.out.json')['classification'] == 'MODULE_SURFACE_DRIFT'
assert c('identity.out.json')['classification'] == 'IDENTITY_DRIFT'
assert c('platform-contract.out.json')['classification'] == 'IDENTITY_DRIFT'
assert c('service.out.json')['classification'] == 'RUNTIME_DRIFT'
assert c('instrumentation.out.json')['classification'] == 'INSTRUMENTATION_DRIFT'
assert c('visibility.out.json')['classification'] == 'VISIBILITY_DRIFT'
assert c('aslr.out.json')['classification'] == 'NO_OBSERVED_DRIFT'
assert c('clock.out.json')['classification'] == 'NO_OBSERVED_DRIFT'
assert c('pid.out.json')['classification'] == 'NO_OBSERVED_DRIFT'
assert c('pid.out.json')['process_instance_changes']
assert c('hints.out.json')['classification'] == 'NO_OBSERVED_DRIFT'
assert c('hints.out.json')['compact_hint_changes']
assert c('incomparable.out.json')['classification'] == 'INCOMPARABLE'
assert c('incomparable.out.json')['comparable'] is False
for name in root.glob('*.out.json'):
    assert json.loads(name.read_text())['claim_allowed'] is False
PY

python3 - <<'PY'
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import time

path = Path('tools/capture-runtime-stability-dump.py')
spec = importlib.util.spec_from_file_location('capture_dump', path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

assert mod.endpoint_is_loopback('127.0.0.1:27042')
assert mod.endpoint_is_loopback('localhost:27042')
assert mod.endpoint_is_loopback('[::1]:27042')
assert not mod.endpoint_is_loopback('192.0.2.1:27042')

dump = {
    'schema': mod.SCHEMA,
    'claim_allowed': False,
    'capture_seq': 1,
    'timing': {'wall_end_epoch_ms': 10},
    'stable_identity': {},
    'instrumentation_identity': {},
    'visibility': {},
    'runtime_state': {}
}
with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    p1, d1, prev1 = mod.write_append_only(root, dump, 1024 * 1024)
    assert prev1 == 'GENESIS'
    time.sleep(0.002)
    dump['capture_seq'] = 2
    p2, d2, prev2 = mod.write_append_only(root, dump, 1024 * 1024)
    assert p1 != p2
    assert prev2 == d1
    assert (Path(str(p1) + '.sha256')).exists()
    assert (root / 'ledger.jsonl').exists()
    assert (os.stat(p1).st_mode & 0o777) == 0o600
    lines = (root/'ledger.jsonl').read_text().splitlines()
    assert len(lines) == 2
    assert json.loads(lines[1])['previous_dump_sha256'] == d1

try:
    mod.encode_dump({'x': 'y' * 100}, 8)
except RuntimeError:
    pass
else:
    raise AssertionError('size ceiling did not fail closed')
PY

rafaelia_write_sha256_manifest "$EVIDENCE_DIR/SOURCE_SHA256SUMS.txt" \
  agents/android-runtime-stability-dump.js \
  profiles/android-runtime-stability-dump.v1.json \
  profiles/android-runtime-stability-dump.v2.json \
  profiles/runtime-stability-falsification-matrix.v1.json \
  tools/runtime-stability-diff.py \
  tools/capture-runtime-stability-dump.py \
  modules/runtime-learning-engine/runtime-stability-hypermemory-bridge.ts \
  modules/runtime-learning-engine/tests/runtime-stability-hypermemory-bridge.test.ts \
  docs/android-runtime-stability-dump.md

GITHUB_REPOSITORY="${GITHUB_REPOSITORY:-LOCAL}" GITHUB_RUN_ID="${GITHUB_RUN_ID:-0}" GITHUB_SHA="${GITHUB_SHA:-LOCAL}" python3 - <<'PY'
import json
import os
from pathlib import Path

receipt = {
    'schema': 'rafaelia.android.runtime-stability-dump.receipt/v2',
    'repository': os.environ['GITHUB_REPOSITORY'],
    'run_id': int(os.environ['GITHUB_RUN_ID']),
    'sha': os.environ['GITHUB_SHA'],
    'agent_syntax': 'PASS',
    'profile_v2_contract': 'PASS',
    'falsification_matrix': 'PASS',
    'privacy_guard': 'PASS',
    'range_exact_bucket_contract': 'PASS',
    'reason_allowlist_contract': 'PASS',
    'schema_fail_closed': 'PASS',
    'diff_visibility_drift': 'PASS',
    'diff_instrumentation_drift': 'PASS',
    'diff_identity_drift': 'PASS',
    'diff_module_surface_drift': 'PASS',
    'diff_runtime_drift': 'PASS',
    'diff_aslr_invariance': 'PASS',
    'diff_clock_invariance': 'PASS',
    'diff_pid_tid_exclusion': 'PASS',
    'diff_compact_hint_non_authority': 'PASS',
    'append_only_hash_chain': 'PASS',
    'remote_endpoint_default_fail_closed': 'PASS',
    'safe_system_property_allowlist': 'PASS',
    'process_pss_surface': 'PASS',
    'hypermemory_bridge_static_contract': 'PASS',
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

printf '%s\n' 'ANDROID_RUNTIME_STABILITY_DUMP_V2_GATE_PASS'

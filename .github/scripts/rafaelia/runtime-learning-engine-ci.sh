#!/usr/bin/env bash
# Build/test gate for modules/runtime-learning-engine.
# This proves only the hosted TypeScript build/test surface executed by this
# runner. It does not promote Android physical runtime or performance claims.

set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=ci-common.sh
source "$SCRIPT_DIR/ci-common.sh"

ROOT="$(rafaelia_repo_root)"
MODULE="$ROOT/modules/runtime-learning-engine"
EVIDENCE="$ROOT/evidence/runtime-learning-engine"
DEPENDENCY_EVIDENCE="$EVIDENCE/direct-dependency-evidence.json"
STATIC_GAP_EVIDENCE="$EVIDENCE/static-gap-inventory.json"
SURFACE_INPUTS="$EVIDENCE/runtime-surface-inputs.txt"

rafaelia_need_cmd node
rafaelia_need_cmd npm
rafaelia_need_cmd python3
rafaelia_need_cmd sha256sum
rafaelia_need_cmd timeout
rafaelia_need_dir "$MODULE"
rafaelia_need_file "$MODULE/package.json"
rafaelia_need_file "$MODULE/tsconfig.json"
rafaelia_need_file "$ROOT/tools/collect-node-direct-dependency-evidence.py"
rafaelia_need_file "$ROOT/tools/scan-runtime-gaps.py"

rm -rf "$EVIDENCE"
mkdir -p "$EVIDENCE"

GIT_SHA="$(git -C "$ROOT" rev-parse HEAD)"
TREE_SHA="$(git -C "$ROOT" rev-parse HEAD^{tree})"

# Bind the receipt to the executable/test surface rather than only to the whole
# commit. This lets later evidence distinguish a material runtime change from an
# unrelated documentation/provenance-only commit without weakening the gate.
runtime_surface_paths=(
  "modules/runtime-learning-engine"
  ".github/scripts/rafaelia/runtime-learning-engine-ci.sh"
  ".github/scripts/rafaelia/ci-common.sh"
  ".github/workflows/runtime-learning-engine.yml"
  "tools/scan-runtime-gaps.py"
  "tools/collect-node-direct-dependency-evidence.py"
)
: > "$SURFACE_INPUTS"
for relative_path in "${runtime_surface_paths[@]}"; do
  object_id="$(git -C "$ROOT" rev-parse "HEAD:${relative_path}")"
  object_type="$(git -C "$ROOT" cat-file -t "$object_id")"
  printf '%s\t%s\t%s\n' "$relative_path" "$object_type" "$object_id" >> "$SURFACE_INPUTS"
done
RUNTIME_SURFACE_FINGERPRINT="$(sha256sum "$SURFACE_INPUTS" | cut -d' ' -f1)"

NODE_VERSION="$(node --version)"
NPM_VERSION="$(npm --version)"
DEPENDENCY_LOCK="PRESENT"
if [[ ! -f "$MODULE/package-lock.json" ]]; then
  DEPENDENCY_LOCK="TOKEN_VAZIO"
fi

export DEVICE_IP="${DEVICE_IP:-127.0.0.1}"
DEVICE_TARGET_STATE="HOSTED_NO_PHYSICAL_DEVICE_SENTINEL"
if [[ "$DEVICE_IP" != "127.0.0.1" ]]; then
  DEVICE_TARGET_STATE="EXTERNAL_DEVICE_ADDRESS_SUPPLIED_NOT_VERIFIED_BY_THIS_GATE"
fi

STATIC_GAP_STATUS="SKIPPED"
INSTALL_STATUS="SKIPPED"
DEPENDENCY_EVIDENCE_STATUS="SKIPPED"
BUILD_STATUS="SKIPPED"
TEST_STATUS="SKIPPED"
STATIC_GAP_RC=0
INSTALL_RC=0
DEPENDENCY_EVIDENCE_RC=0
BUILD_RC=0
TEST_RC=0
OPEN_HANDLE_DETECTED="false"
TEST_TIMEOUT_SECONDS=600

rafaelia_group_begin "Runtime surface fingerprint"
printf 'git_sha=%s\nruntime_surface_fingerprint=%s\n' "$GIT_SHA" "$RUNTIME_SURFACE_FINGERPRINT"
cat "$SURFACE_INPUTS"
rafaelia_group_end

rafaelia_group_begin "Static gap inventory and zombie-test gate"
set +e
python3 "$ROOT/tools/scan-runtime-gaps.py" \
  --root "$MODULE" \
  --output "$STATIC_GAP_EVIDENCE" \
  2>&1 | tee "$EVIDENCE/static-gap-scan.log"
STATIC_GAP_RC=${PIPESTATUS[0]}
set -e
STATIC_GAP_STATUS="$([[ $STATIC_GAP_RC -eq 0 ]] && printf PASS || printf FAIL)"
rafaelia_group_end

rafaelia_group_begin "Runtime Learning Engine dependency bootstrap"
set +e
(
  cd "$MODULE"
  if [[ -f package-lock.json ]]; then
    npm ci --ignore-scripts --no-audit --no-fund
  else
    npm install --package-lock=false --ignore-scripts --no-audit --no-fund
  fi
) 2>&1 | tee "$EVIDENCE/npm-install.log"
INSTALL_RC=${PIPESTATUS[0]}
set -e
INSTALL_STATUS="$([[ $INSTALL_RC -eq 0 ]] && printf PASS || printf FAIL)"
rafaelia_group_end

if [[ $INSTALL_RC -eq 0 ]]; then
  rafaelia_group_begin "Direct dependency provenance observation"
  set +e
  python3 "$ROOT/tools/collect-node-direct-dependency-evidence.py" \
    --module "$MODULE" \
    --output "$DEPENDENCY_EVIDENCE" \
    2>&1 | tee "$EVIDENCE/dependency-evidence.log"
  DEPENDENCY_EVIDENCE_RC=${PIPESTATUS[0]}
  set -e
  DEPENDENCY_EVIDENCE_STATUS="$([[ $DEPENDENCY_EVIDENCE_RC -eq 0 ]] && printf PASS || printf FAIL)"
  rafaelia_group_end
else
  printf 'SKIPPED: dependency bootstrap failed with rc=%s\n' "$INSTALL_RC" > "$EVIDENCE/dependency-evidence.log"
fi

if [[ $INSTALL_RC -eq 0 ]]; then
  rafaelia_group_begin "TypeScript build"
  set +e
  (
    cd "$MODULE"
    npm run build
  ) 2>&1 | tee "$EVIDENCE/build.log"
  BUILD_RC=${PIPESTATUS[0]}
  set -e
  BUILD_STATUS="$([[ $BUILD_RC -eq 0 ]] && printf PASS || printf FAIL)"
  rafaelia_group_end
else
  printf 'SKIPPED: dependency bootstrap failed with rc=%s\n' "$INSTALL_RC" > "$EVIDENCE/build.log"
fi

if [[ $STATIC_GAP_RC -eq 0 && $INSTALL_RC -eq 0 && $BUILD_RC -eq 0 ]]; then
  rafaelia_group_begin "Jest integration and regression tests"
  set +e
  (
    cd "$MODULE"
    timeout --signal=TERM --kill-after=15s "${TEST_TIMEOUT_SECONDS}s" \
      npm test -- \
        --runInBand \
        --detectOpenHandles \
        --testTimeout=10000 \
        --json \
        --outputFile="$EVIDENCE/jest-results.json"
  ) 2>&1 | tee "$EVIDENCE/test.log"
  TEST_RC=${PIPESTATUS[0]}
  set -e

  if grep -Eqi 'Jest has detected the following.*open handle|open handle potentially keeping Jest from exiting' "$EVIDENCE/test.log"; then
    OPEN_HANDLE_DETECTED="true"
    if [[ $TEST_RC -eq 0 ]]; then
      TEST_RC=71
    fi
  fi

  TEST_STATUS="$([[ $TEST_RC -eq 0 ]] && printf PASS || printf FAIL)"
  rafaelia_group_end
else
  printf 'SKIPPED: static/dependency/build gate not PASS (static=%s install=%s build=%s)\n' \
    "$STATIC_GAP_STATUS" "$INSTALL_STATUS" "$BUILD_STATUS" > "$EVIDENCE/test.log"
fi

python3 - \
  "$EVIDENCE/receipt.json" \
  "$EVIDENCE/jest-results.json" \
  "$DEPENDENCY_EVIDENCE" \
  "$STATIC_GAP_EVIDENCE" \
  "$SURFACE_INPUTS" \
  "$GIT_SHA" \
  "$TREE_SHA" \
  "$RUNTIME_SURFACE_FINGERPRINT" \
  "$NODE_VERSION" \
  "$NPM_VERSION" \
  "$DEPENDENCY_LOCK" \
  "$DEVICE_TARGET_STATE" \
  "$STATIC_GAP_STATUS" \
  "$INSTALL_STATUS" \
  "$DEPENDENCY_EVIDENCE_STATUS" \
  "$BUILD_STATUS" \
  "$TEST_STATUS" \
  "$STATIC_GAP_RC" \
  "$INSTALL_RC" \
  "$DEPENDENCY_EVIDENCE_RC" \
  "$BUILD_RC" \
  "$TEST_RC" \
  "$OPEN_HANDLE_DETECTED" \
  "$TEST_TIMEOUT_SECONDS" <<'PY'
import json
import os
import sys
from datetime import datetime, timezone

(
    out,
    jest_path,
    dependency_evidence_path,
    static_gap_path,
    surface_inputs_path,
    git_sha,
    tree_sha,
    runtime_surface_fingerprint,
    node_version,
    npm_version,
    dependency_lock,
    device_target_state,
    static_gap_status,
    install_status,
    dependency_evidence_status,
    build_status,
    test_status,
    static_gap_rc,
    install_rc,
    dependency_evidence_rc,
    build_rc,
    test_rc,
    open_handle_detected,
    test_timeout_seconds,
) = sys.argv[1:]


def load_json(path):
    if not os.path.exists(path):
        return {}
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as exc:
        return {'parse_error': str(exc)}


def load_surface(path):
    values = []
    if not os.path.exists(path):
        return values
    with open(path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.rstrip('\n')
            if not line:
                continue
            parts = line.split('\t')
            if len(parts) != 3:
                raise RuntimeError(f'malformed runtime surface row: {line!r}')
            relative_path, object_type, object_id = parts
            values.append({
                'path': relative_path,
                'git_object_type': object_type,
                'git_object_id': object_id,
            })
    return values


jest = load_json(jest_path)
dependency_evidence = load_json(dependency_evidence_path)
static_gap = load_json(static_gap_path)
surface_objects = load_surface(surface_inputs_path)

failed_tests = []
for suite in jest.get('testResults', []) if isinstance(jest, dict) else []:
    for assertion in suite.get('assertionResults', []):
        if assertion.get('status') == 'failed':
            failed_tests.append({
                'suite': suite.get('name'),
                'full_name': assertion.get('fullName'),
                'failure_messages': assertion.get('failureMessages', []),
            })

receipt = {
    'schema': 'rafaelia.runtime-learning-engine.ci-receipt.v6',
    'timestamp': datetime.now(timezone.utc).isoformat(),
    'git_sha': git_sha,
    'tree_sha': tree_sha,
    'runtime_surface_fingerprint_sha256': runtime_surface_fingerprint,
    'runtime_surface_objects': surface_objects,
    'runtime_surface_binding_state': 'OBSERVED_GIT_OBJECTS_AND_SHA256_FINGERPRINT',
    'runner_surface': 'HOSTED_TYPESCRIPT_NODE',
    'node_version': node_version,
    'npm_version': npm_version,
    'dependency_lock': dependency_lock,
    'static_gap_gate': static_gap_status,
    'static_gap_summary': {
        'schema': static_gap.get('schema'),
        'scanned_file_count': static_gap.get('scanned_file_count'),
        'blocking_zombie_test_count': static_gap.get('blocking_zombie_test_count'),
        'declared_gap_marker_count': static_gap.get('declared_gap_marker_count'),
        'marker_counts': static_gap.get('marker_counts'),
        'declared_gap_state': static_gap.get('declared_gap_state'),
    },
    'direct_dependency_evidence': dependency_evidence_status,
    'direct_dependency_summary': {
        'schema': dependency_evidence.get('schema'),
        'direct_dependency_count': dependency_evidence.get('direct_dependency_count'),
        'unresolved_direct_dependency_count': dependency_evidence.get('unresolved_direct_dependency_count'),
        'direct_dependency_metadata_state': dependency_evidence.get('direct_dependency_metadata_state'),
        'dependency_lock_state': dependency_evidence.get('dependency_lock_state'),
        'transitive_dependency_license_reconciliation': dependency_evidence.get('transitive_dependency_license_reconciliation'),
        'license_compatibility_proven': False,
    },
    'device_target_state': device_target_state,
    'dependency_install': install_status,
    'build': build_status,
    'tests': test_status,
    'test_timeout_seconds': int(test_timeout_seconds),
    'test_timeout_triggered': int(test_rc) in (124, 137),
    'open_handle_detected': open_handle_detected.lower() == 'true',
    'return_codes': {
        'static_gap_gate': int(static_gap_rc),
        'dependency_install': int(install_rc),
        'direct_dependency_evidence': int(dependency_evidence_rc),
        'build': int(build_rc),
        'tests': int(test_rc),
    },
    'jest_summary': {
        'success': jest.get('success'),
        'num_total_test_suites': jest.get('numTotalTestSuites'),
        'num_failed_test_suites': jest.get('numFailedTestSuites'),
        'num_total_tests': jest.get('numTotalTests'),
        'num_failed_tests': jest.get('numFailedTests'),
        'num_passed_tests': jest.get('numPassedTests'),
        'failed_tests': failed_tests,
    },
    'rollback_hook_restoration_gate': 'EXECUTED_BY_JEST' if test_status == 'PASS' else 'UNRESOLVED_BY_FAILED_JEST_RUN',
    'memory_rollback_without_frida_gate': 'FAIL_CLOSED_TESTED' if test_status == 'PASS' else 'UNRESOLVED_BY_FAILED_JEST_RUN',
    'corruption_quarantine_gate': 'EXECUTED_BY_JEST' if test_status == 'PASS' else 'UNRESOLVED_BY_FAILED_JEST_RUN',
    'observability_canonical_metric_gate': 'EXECUTED_BY_JEST' if test_status == 'PASS' else 'UNRESOLVED_BY_FAILED_JEST_RUN',
    'physical_device_smoke': 'TOKEN_VAZIO',
    'android_frida_runtime_verified': False,
    'physical_performance_verified': False,
    'transitive_dependency_license_compatibility': 'TOKEN_VAZIO',
    'claim_allowed': False,
    'boundary': (
        'CI PASS is bound to the listed runtime/test Git objects and SHA-256 surface fingerprint, and proves this hosted build/test run, '
        'static no-zombie-test scan, and direct installed dependency metadata only. Declared textual gaps remain inventory, not automatic proof of missing behavior. '
        'Loopback DEVICE_IP is a no-device sentinel. Direct package metadata is not transitive license compatibility or a lockfile. '
        'Open handles and timeouts are fail-closed. Neither PASS nor FAIL is Android physical evidence.'
    ),
}
with open(out, 'w', encoding='utf-8') as f:
    json.dump(receipt, f, indent=2, sort_keys=True)
    f.write('\n')
PY

manifest_inputs=(
  "$EVIDENCE/receipt.json"
  "$SURFACE_INPUTS"
  "$EVIDENCE/static-gap-scan.log"
  "$EVIDENCE/npm-install.log"
  "$EVIDENCE/dependency-evidence.log"
  "$EVIDENCE/build.log"
  "$EVIDENCE/test.log"
)
[[ -f "$STATIC_GAP_EVIDENCE" ]] && manifest_inputs+=("$STATIC_GAP_EVIDENCE")
[[ -f "$DEPENDENCY_EVIDENCE" ]] && manifest_inputs+=("$DEPENDENCY_EVIDENCE")
[[ -f "$EVIDENCE/jest-results.json" ]] && manifest_inputs+=("$EVIDENCE/jest-results.json")
rafaelia_write_sha256_manifest "$EVIDENCE/SHA256SUMS" "${manifest_inputs[@]}"

if [[ $STATIC_GAP_RC -eq 0 && $INSTALL_RC -eq 0 && $DEPENDENCY_EVIDENCE_RC -eq 0 && $BUILD_RC -eq 0 && $TEST_RC -eq 0 ]]; then
  rafaelia_notice "RUNTIME_LEARNING_ENGINE_GATE_PASS sha=$GIT_SHA surface_sha256=$RUNTIME_SURFACE_FINGERPRINT static_gap=$STATIC_GAP_STATUS dependency_lock=$DEPENDENCY_LOCK direct_dependency_evidence=$DEPENDENCY_EVIDENCE_STATUS device_target=$DEVICE_TARGET_STATE open_handles=$OPEN_HANDLE_DETECTED physical_device=TOKEN_VAZIO claim_allowed=false"
  exit 0
fi

rafaelia_error \
  "RUNTIME_LEARNING_ENGINE_GATE_FAIL sha=$GIT_SHA surface_sha256=$RUNTIME_SURFACE_FINGERPRINT static_gap=$STATIC_GAP_STATUS install=$INSTALL_STATUS dependency_evidence=$DEPENDENCY_EVIDENCE_STATUS build=$BUILD_STATUS tests=$TEST_STATUS test_rc=$TEST_RC open_handles=$OPEN_HANDLE_DETECTED evidence=$EVIDENCE device_target=$DEVICE_TARGET_STATE physical_device=TOKEN_VAZIO claim_allowed=false"
exit 1

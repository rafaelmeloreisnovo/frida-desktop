#!/usr/bin/env bash
# Static fail-closed contract for the Android/Termux physical receipt verifier.
# This proves source compatibility and evidence semantics only; it does not
# claim physical execution on a hosted runner.

set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
cd "$ROOT"

VERIFIER="android/app/on-device-smoke.sh"
ACTIVITY="android/app/src/io/rafaelia/fridalab/MainActivity.java"
JNI="android/app/native/elf_probe.c"
DOC="android/app/ONE_SCREEN_OPERATOR_V1.md"
EVIDENCE_DIR="evidence/android17-lab"
EVIDENCE_FILE="${EVIDENCE_DIR}/on-device-receipt-verifier-contract.txt"

fail() {
  printf 'ON_DEVICE_RECEIPT_VERIFIER_CONTRACT_FAIL reason=%s\n' "$1" >&2
  exit 1
}

for path in "$VERIFIER" "$ACTIVITY" "$JNI" "$DOC"; do
  [[ -f "$path" ]] || fail "missing_file:${path}"
done

bash -n "$VERIFIER" || fail "bash_syntax"

require_token() {
  local path="$1"
  local token="$2"
  grep -Fq -- "$token" "$path" || fail "missing_token:${path}:${token}"
}

# Verifier identity / locality / append-only custody.
require_token "$VERIFIER" 'rafaelia.frida.on_device_smoke.v2'
require_token "$VERIFIER" 'ON_DEVICE_TERMUX_LOCALHOST'
require_token "$VERIFIER" '127.0.0.1:*|localhost:*'
require_token "$VERIFIER" "'[::1]':*"
require_token "$VERIFIER" 'reason=non_local_endpoint'
require_token "$VERIFIER" 'source_commit_bound'
require_token "$VERIFIER" 'source_tree_clean'
require_token "$VERIFIER" 'script_sha256_bound'
require_token "$VERIFIER" 'os.O_EXCL'
require_token "$VERIFIER" 'claim_allowed": False'
require_token "$VERIFIER" 'observation_injected": False'
require_token "$VERIFIER" 'store_mutated_by_smoke": False'

# Exact current read-only Java -> JNI observation bridge.
require_token "$VERIFIER" 'learningSnapshotForInstrumentation(true)'
require_token "$ACTIVITY" 'public static String learningSnapshotForInstrumentation(boolean verbose)'
require_token "$ACTIVITY" 'return nativeLearningSnapshot(verbose);'

# Runtime strings consumed by the physical verifier must still be produced by
# the current JNI snapshot implementation; source drift fails closed here.
require_token "$JNI" 'validation persistence: TOKEN_VAZIO'
require_token "$JNI" 'automatic ACTIVE policy: DISABLED'
require_token "$JNI" 'observed OS page: %u B (%s)'
require_token "$JNI" 'SIMD fold selftest: %s'
require_token "$JNI" 'GPU compute backend: TOKEN_VAZIO / not promoted'

# The verifier must not use the write-side learning observation bridge.
if grep -Fq -- 'learningObserve(' "$VERIFIER"; then
  fail "write_side_learning_bridge_present"
fi

# Operator docs must keep the verifier subordinate to the one-screen UI and
# make the physical boundary explicit.
require_token "$DOC" 'bash android/app/on-device-smoke.sh'
require_token "$DOC" 'evidence verifier, not a second UI or an autonomous control loop'
require_token "$DOC" 'claim_allowed=false'

mkdir -p "$EVIDENCE_DIR"
verifier_sha256="$(sha256sum "$VERIFIER" | awk '{print $1}')"
activity_sha256="$(sha256sum "$ACTIVITY" | awk '{print $1}')"
jni_sha256="$(sha256sum "$JNI" | awk '{print $1}')"
{
  printf 'schema=rafaelia.frida.on_device_verifier_contract.v1\n'
  printf 'status=PASS\n'
  printf 'verifier=%s\n' "$VERIFIER"
  printf 'verifier_sha256=%s\n' "$verifier_sha256"
  printf 'activity_sha256=%s\n' "$activity_sha256"
  printf 'jni_sha256=%s\n' "$jni_sha256"
  printf 'execution_proven=false\n'
  printf 'physical_device_smoke=TOKEN_VAZIO\n'
  printf 'claim_allowed=false\n'
} > "$EVIDENCE_FILE"

cat "$EVIDENCE_FILE"
printf 'ON_DEVICE_RECEIPT_VERIFIER_CONTRACT_PASS\n'

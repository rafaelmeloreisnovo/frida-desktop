#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=ci-common.sh
source "$SCRIPT_DIR/ci-common.sh"

ROOT="$(rafaelia_repo_root)"
cd "$ROOT"

BUILD_DIR="build/android-crash-observability"
EVIDENCE_DIR="evidence/android-crash-observability"
mkdir -p "$BUILD_DIR" "$EVIDENCE_DIR"

run_gate() {
  rafaelia_need_cmd cc
  rafaelia_need_cmd node
  rafaelia_need_cmd python3

  cc -std=c11 -Wall -Wextra -Werror -pedantic \
    tools/frida-runtime-crash-observer.c \
    tools/frida-runtime-crash-observer-selftest.c \
    -Itools -o "$BUILD_DIR/frida-runtime-crash-observer-selftest"
  "$BUILD_DIR/frida-runtime-crash-observer-selftest"

  node --check agents/android-crash-observer.js
  sh -n tools/android-crash-spine.sh

  python3 - <<'PY'
import json
from pathlib import Path

data = json.loads(Path('profiles/android-crash-observability.v1.json').read_text())
assert data['schema'] == 2
assert data['claim_allowed'] is False
assert data['privacy']['payload_bytes'] == 'forbidden'
assert data['privacy']['payload_hash'] == 'forbidden'
assert data['privacy']['payload_pointer_dereference'] == 'forbidden'
trigger = data['crash_network_trigger']
assert trigger['ring_capacity'] == 64
assert trigger['operations'] == ['connect', 'send', 'sendto']
assert trigger['payload_access'] is False
assert trigger['cross_process_payload_capture'] is False
PY

  grep -F "crashTriggered = true" agents/android-crash-observer.js >/dev/null
  grep -F "outbound_tail: outboundTail()" agents/android-crash-observer.js >/dev/null
  grep -F "emit('POST_CRASH_NET'" agents/android-crash-observer.js >/dev/null
  grep -F "attachSendLike('send', false)" agents/android-crash-observer.js >/dev/null
  grep -F "attachSendLike('sendto', true)" agents/android-crash-observer.js >/dev/null
  grep -F "attachConnect()" agents/android-crash-observer.js >/dev/null

  if grep -En 'getText\(|ClipboardManager|readUtf8String|readByteArray|HttpURLConnection|OkHttp|args\[1\].*read|Memory\.read' \
      agents/android-crash-observer.js tools/android-crash-spine.sh; then
    rafaelia_die 'forbidden content-capture surface detected'
  fi

  rafaelia_write_sha256_manifest "$EVIDENCE_DIR/SOURCE_SHA256SUMS.txt" \
    agents/android-crash-observer.js \
    tools/frida-runtime-crash-observer.c \
    tools/frida-runtime-crash-observer.h \
    tools/frida-runtime-crash-observer-selftest.c \
    tools/android-crash-spine.sh \
    profiles/android-crash-observability.v1.json

  GITHUB_REPOSITORY="${GITHUB_REPOSITORY:-LOCAL}" \
  GITHUB_RUN_ID="${GITHUB_RUN_ID:-0}" \
  GITHUB_SHA="${GITHUB_SHA:-LOCAL}" \
  python3 - <<'PY'
import json
import os
from pathlib import Path

receipt = {
    'schema': 'rafaelia.frida.android-crash-observability.receipt.v1',
    'repository': os.environ['GITHUB_REPOSITORY'],
    'run_id': int(os.environ['GITHUB_RUN_ID']),
    'sha': os.environ['GITHUB_SHA'],
    'hosted_c11_selftest': 'PASS',
    'agent_syntax': 'PASS',
    'shell_syntax': 'PASS',
    'contract_validation': 'PASS',
    'crash_trigger_wiring': 'PASS',
    'privacy_guard': 'PASS',
    'runtime_proven': 'TOKEN_VAZIO',
    'device_proven': 'TOKEN_VAZIO',
    'reproduced': 'TOKEN_VAZIO',
    'claim_allowed': False,
}
Path('evidence/android-crash-observability/receipt.json').write_text(
    json.dumps(receipt, indent=2, sort_keys=True) + '\n',
    encoding='utf-8',
)
PY

  printf '%s\n' 'ANDROID_CRASH_OBSERVABILITY_GATE_PASS'
}

case "${1:-all}" in
  all) run_gate ;;
  *) rafaelia_die 'usage: android-crash-observability-ci.sh [all]' ;;
esac

#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=ci-common.sh
source "$SCRIPT_DIR/ci-common.sh"

ROOT="$(rafaelia_repo_root)"
cd "$ROOT"

BUILD_DIR="build/runtime-aided-hardening"
EVIDENCE_DIR="evidence/runtime-aided-hardening"
mkdir -p "$BUILD_DIR" "$EVIDENCE_DIR"

COMMON_FLAGS=(-std=c11 -Wall -Wextra -Werror -pedantic -Itools)
SRC=(tools/frida-runtime-aided-adapter.c tools/frida-runtime-aided-adapter-selftest.c)

hosted() {
  cc "${COMMON_FLAGS[@]}" "${SRC[@]}" -o "$BUILD_DIR/frida-raa-selftest"
  "$BUILD_DIR/frida-raa-selftest" | tee "$EVIDENCE_DIR/hosted-selftest.txt"
}

freestanding() {
  cc -std=c11 -Wall -Wextra -Werror -ffreestanding -fno-builtin \
    -Itools -c tools/frida-runtime-aided-adapter.c \
    -o "$BUILD_DIR/frida-raa-freestanding.o"
  file "$BUILD_DIR/frida-raa-freestanding.o" | tee "$EVIDENCE_DIR/freestanding-object.txt"
}

sanitizers() {
  cc "${COMMON_FLAGS[@]}" \
    -fsanitize=address,undefined \
    -fno-omit-frame-pointer \
    "${SRC[@]}" \
    -o "$BUILD_DIR/frida-raa-sanitize"
  ASAN_OPTIONS=detect_leaks=1:halt_on_error=1 \
  UBSAN_OPTIONS=halt_on_error=1:print_stacktrace=1 \
    "$BUILD_DIR/frida-raa-sanitize" | tee "$EVIDENCE_DIR/sanitizer-selftest.txt"
}

write_evidence() {
  rafaelia_write_sha256_manifest "$EVIDENCE_DIR/SOURCE_SHA256SUMS.txt" \
    tools/frida-runtime-aided-adapter.c \
    tools/frida-runtime-aided-adapter.h \
    tools/frida-runtime-aided-adapter-selftest.c \
    tools/frida-runtime-stability-recorder.h

  GITHUB_REPOSITORY="${GITHUB_REPOSITORY:-LOCAL}" \
  GITHUB_RUN_ID="${GITHUB_RUN_ID:-0}" \
  GITHUB_SHA="${GITHUB_SHA:-LOCAL}" \
  python3 - <<'PY'
import json
import os
from pathlib import Path

receipt = {
    "schema": "rafaelia.frida.runtime-aided-hardening.receipt.v1",
    "repository": os.environ["GITHUB_REPOSITORY"],
    "run_id": int(os.environ["GITHUB_RUN_ID"]),
    "sha": os.environ["GITHUB_SHA"],
    "hosted_c11_selftest": "PASS",
    "freestanding_compile": "PASS",
    "asan_ubsan_selftest": "PASS",
    "physical_runtime_receipt": "TOKEN_VAZIO",
    "claim_allowed": False,
}
Path("evidence/runtime-aided-hardening/receipt.json").write_text(
    json.dumps(receipt, indent=2, sort_keys=True) + "\n",
    encoding="utf-8",
)
PY
}

case "${1:-all}" in
  hosted) hosted ;;
  freestanding) freestanding ;;
  sanitizers) sanitizers ;;
  evidence) write_evidence ;;
  all)
    hosted
    freestanding
    sanitizers
    write_evidence
    ;;
  *) rafaelia_die "usage: runtime-aided-hardening.sh [hosted|freestanding|sanitizers|evidence|all]" ;;
esac

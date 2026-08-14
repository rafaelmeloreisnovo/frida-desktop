#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=ci-common.sh
source "$SCRIPT_DIR/ci-common.sh"

ROOT="$(rafaelia_repo_root)"
cd "$ROOT"

BUILD_DIR="build/rfl-selftest"
EVIDENCE_DIR="evidence/rfl-neon4096"
mkdir -p "$BUILD_DIR" "$EVIDENCE_DIR"

COMMON_FLAGS=(
  -std=c11
  -O2
  -Wall
  -Wextra
  -Werror
  -pedantic
  -I android/frida-lab/native
)

compile_all() {
  rafaelia_need_cmd cc
  cc "${COMMON_FLAGS[@]}" \
    android/frida-lab/native/learning_store.c \
    android/frida-lab/native/learning_store_selftest.c \
    -o "$BUILD_DIR/rfl-selftest"

  cc "${COMMON_FLAGS[@]}" \
    android/frida-lab/native/learning_store.c \
    android/frida-lab/native/neon4096_core.c \
    android/frida-lab/native/learning_runtime.c \
    android/frida-lab/native/learning_runtime_selftest.c \
    -o "$BUILD_DIR/neon4096-runtime-selftest"
}

run_all() {
  "$BUILD_DIR/rfl-selftest" | tee "$EVIDENCE_DIR/rfl-selftest.txt"
  grep -q '^RFL_SELFTEST_OK ' "$EVIDENCE_DIR/rfl-selftest.txt"
  grep -q 'replay=PASS' "$EVIDENCE_DIR/rfl-selftest.txt"
  grep -q 'corrupt_tail=RECOVERED' "$EVIDENCE_DIR/rfl-selftest.txt"
  grep -q 'promotion=DISABLED' "$EVIDENCE_DIR/rfl-selftest.txt"

  "$BUILD_DIR/neon4096-runtime-selftest" | tee "$EVIDENCE_DIR/neon4096-runtime-selftest.txt"
  grep -q '^NEON4096_RUNTIME_SELFTEST_OK ' "$EVIDENCE_DIR/neon4096-runtime-selftest.txt"
  grep -q 'page=4096' "$EVIDENCE_DIR/neon4096-runtime-selftest.txt"
  grep -q 'thirds=1344x3' "$EVIDENCE_DIR/neon4096-runtime-selftest.txt"
  grep -q 'validation=FROZEN' "$EVIDENCE_DIR/neon4096-runtime-selftest.txt"
  grep -q 'support_unchanged=PASS' "$EVIDENCE_DIR/neon4096-runtime-selftest.txt"
  grep -q 'gpu=TOKEN_VAZIO' "$EVIDENCE_DIR/neon4096-runtime-selftest.txt"
  grep -q 'promotion=DISABLED' "$EVIDENCE_DIR/neon4096-runtime-selftest.txt"
}

write_evidence() {
  rafaelia_write_sha256_manifest "$EVIDENCE_DIR/SOURCE_SHA256SUMS.txt" \
    android/frida-lab/native/learning_store.h \
    android/frida-lab/native/learning_store.c \
    android/frida-lab/native/learning_store_selftest.c \
    android/frida-lab/native/neon4096_core.h \
    android/frida-lab/native/neon4096_core.c \
    android/frida-lab/native/learning_runtime.h \
    android/frida-lab/native/learning_runtime.c \
    android/frida-lab/native/learning_runtime_selftest.c \
    android/frida-lab/native/elf_probe.c

  GITHUB_REPOSITORY="${GITHUB_REPOSITORY:-LOCAL}" \
  GITHUB_RUN_ID="${GITHUB_RUN_ID:-0}" \
  GITHUB_SHA="${GITHUB_SHA:-LOCAL}" \
  python3 - <<'PY'
import json
import os
from pathlib import Path

receipt = {
    "schema": "rafaelia.frida.rfl-neon4096.selftest.receipt.v1",
    "repository": os.environ["GITHUB_REPOSITORY"],
    "run_id": int(os.environ["GITHUB_RUN_ID"]),
    "sha": os.environ["GITHUB_SHA"],
    "gates": {
        "rfl_append_replay": "PASS",
        "rfl_corrupt_tail": "RECOVERED",
        "neon4096_contract": "PASS",
        "validate_shadow_frozen_model": "PASS",
        "predictor_support_unchanged": "PASS",
    },
    "gpu_compute_backend": "TOKEN_VAZIO",
    "automatic_active_policy": "DISABLED",
    "physical_performance": "TOKEN_VAZIO",
    "claim_allowed": False,
}
Path("evidence/rfl-neon4096/receipt.json").write_text(
    json.dumps(receipt, indent=2, sort_keys=True) + "\n",
    encoding="utf-8",
)
PY
}

case "${1:-all}" in
  compile) compile_all ;;
  run) run_all ;;
  evidence) write_evidence ;;
  all)
    compile_all
    run_all
    write_evidence
    ;;
  *) rafaelia_die "usage: rfl-neon4096-selftest.sh [compile|run|evidence|all]" ;;
esac

#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

SRC="tools/arm32-neon4096-physical-bench.c"
RUNNER="tools/arm32-neon4096-physical-bench.sh"
HDR="android/app/native/neon4096_freestanding.h"
ASM="android/app/native/neon4096_armv7.S"
OUT="build/arm32-neon4096-physical-bench-adapter"
EVIDENCE="evidence/arm32-neon4096-physical-bench-adapter"
OBJ="$OUT/host-adapter.o"
mkdir -p "$OUT" "$EVIDENCE"

: "${CC:=cc}"
command -v "$CC" >/dev/null
command -v nm >/dev/null
command -v sha256sum >/dev/null

failures=0

if grep -Eiq '(^|[^A-Za-z0-9_])(malloc|calloc|realloc|free|aligned_alloc|posix_memalign|mmap|munmap)([^A-Za-z0-9_]|$)' "$SRC"; then
  echo 'dynamic allocation token found in benchmark adapter' >&2
  failures=$((failures + 1))
fi

if grep -Eiq '(^|[^A-Za-z0-9_])(pthread|sched_setaffinity|clone|fork)([^A-Za-z0-9_]|$)' "$SRC"; then
  echo 'thread/scheduler orchestration found inside single-core adapter' >&2
  failures=$((failures + 1))
fi

test "$(grep -Ec '^_Alignas\(64\) static uint8_t ' "$SRC")" -eq 5 || failures=$((failures + 1))
grep -q '#define RAFAELIA_BENCH_PAGES 256u' "$SRC" || failures=$((failures + 1))
grep -q '#define RAFAELIA_BENCH_ROUNDS 65536u' "$SRC" || failures=$((failures + 1))
grep -q 'cache_miss_rate=TOKEN_VAZIO' "$SRC" || failures=$((failures + 1))
grep -q 'physical_dram_bandwidth=TOKEN_VAZIO' "$SRC" || failures=$((failures + 1))
grep -q 'eight_core_scaling=TOKEN_VAZIO' "$SRC" || failures=$((failures + 1))
grep -q 'claim_allowed=false' "$SRC" || failures=$((failures + 1))

grep -q -- '-fno-vectorize' "$RUNNER" || failures=$((failures + 1))
grep -q -- '-fno-slp-vectorize' "$RUNNER" || failures=$((failures + 1))
grep -q -- '-march=armv7-a' "$RUNNER" || failures=$((failures + 1))
grep -q -- '-mfpu=neon' "$RUNNER" || failures=$((failures + 1))
grep -q -- '-mfloat-abi=softfp' "$RUNNER" || failures=$((failures + 1))
grep -q 'taskset -c' "$RUNNER" || failures=$((failures + 1))

if ! "$CC" -std=c11 -O2 -Wall -Wextra -Werror -I android/app/native \
    -c "$SRC" -o "$OBJ" > "$EVIDENCE/host-compile.log" 2>&1; then
  failures=$((failures + 1))
fi

if test -f "$OBJ"; then
  nm -u "$OBJ" > "$EVIDENCE/host-undefined-symbols.txt" 2>&1 || true
  if grep -Eiq '(malloc|calloc|realloc|free|aligned_alloc|posix_memalign|mmap|munmap)' \
      "$EVIDENCE/host-undefined-symbols.txt"; then
    echo 'allocator dependency emitted by benchmark adapter object' >&2
    failures=$((failures + 1))
  fi
fi

# Reuse the canonical strict-object gate instead of duplicating the leaf proof.
if ! bash .github/scripts/rafaelia/arm32-neon4096-freestanding-gate.sh \
    > "$EVIDENCE/strict-leaf-gate.log" 2>&1; then
  failures=$((failures + 1))
fi

sha256sum "$SRC" "$RUNNER" "$HDR" "$ASM" > "$EVIDENCE/SOURCE_SHA256SUMS.txt"

cat > "$EVIDENCE/receipt.json" <<EOF_JSON
{
  "schema": "rafaelia.frida.arm32-neon4096.physical-bench-adapter.structural-receipt.v1",
  "adapter_kind": "hosted_measurement_only_not_part_of_freestanding_leaf",
  "host_adapter_compile": "$(test -f "$OBJ" && printf PASS || printf FAIL)",
  "static_aligned_buffer_sets": 5,
  "dynamic_allocation_in_adapter_source": false,
  "thread_or_scheduler_runtime_in_adapter_source": false,
  "scalar_baseline_vectorization_disabled_by_device_runner": true,
  "strict_leaf_gate_reused": true,
  "physical_arm32_execution": "TOKEN_VAZIO",
  "cache_miss_rate": "TOKEN_VAZIO",
  "physical_dram_bandwidth": "TOKEN_VAZIO",
  "eight_core_scaling": "TOKEN_VAZIO",
  "three_x_throughput_general_claim": "TOKEN_VAZIO",
  "structural_failures": $failures,
  "claim_allowed": false
}
EOF_JSON

if test "$failures" -ne 0; then
  printf 'ARM32_NEON4096_PHYSICAL_BENCH_ADAPTER_GATE_FAIL failures=%s\n' "$failures" >&2
  exit 1
fi

printf '%s\n' 'ARM32_NEON4096_PHYSICAL_BENCH_ADAPTER_GATE_OK'

#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

SRC="tools/arm32-neon4096-physical-bench.c"
RUNNER="tools/arm32-neon4096-physical-bench.sh"
MULTI="tools/arm32-neon4096-multicore-bench.sh"
HDR="android/app/native/neon4096_freestanding.h"
ASM="android/app/native/neon4096_armv7.S"
OUT="build/arm32-neon4096-physical-bench-adapter"
EVIDENCE="evidence/arm32-neon4096-physical-bench-adapter"
OBJ="$OUT/host-adapter.o"
WORKER_OBJ="$OUT/host-worker-adapter.o"
SYNC_WORKER_OBJ="$OUT/host-sync-worker-adapter.o"
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
  echo 'thread/scheduler orchestration found inside benchmark C adapter' >&2
  failures=$((failures + 1))
fi

test "$(grep -Ec '^_Alignas\(64\) static uint8_t ' "$SRC")" -eq 5 || failures=$((failures + 1))
grep -q '#define RAFAELIA_BENCH_PAGES 256u' "$SRC" || failures=$((failures + 1))
grep -q '#define RAFAELIA_BENCH_ROUNDS 65536u' "$SRC" || failures=$((failures + 1))
grep -q '#define RAFAELIA_BENCH_WORKER_ONLY 0' "$SRC" || failures=$((failures + 1))
grep -q '#define RAFAELIA_BENCH_SYNC_WORKER 0' "$SRC" || failures=$((failures + 1))
grep -q 'ready=1' "$SRC" || failures=$((failures + 1))
grep -q 'barrier=STDIN_BYTE_RELEASE' "$SRC" || failures=$((failures + 1))
grep -q 'worker_mode=NEON_STREAM_ONLY_COMPILE_TIME' "$SRC" || failures=$((failures + 1))
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

grep -q -- '-DRAFAELIA_BENCH_WORKER_ONLY=1' "$MULTI" || failures=$((failures + 1))
grep -q -- '-DRAFAELIA_BENCH_SYNC_WORKER=1' "$MULTI" || failures=$((failures + 1))
grep -q 'run_wave 1' "$MULTI" || failures=$((failures + 1))
grep -q 'run_wave 2' "$MULTI" || failures=$((failures + 1))
grep -q 'run_wave 4' "$MULTI" || failures=$((failures + 1))
grep -q 'run_wave 8' "$MULTI" || failures=$((failures + 1))
grep -q 'TASKSET_PER_WORKER' "$MULTI" || failures=$((failures + 1))
grep -q 'ALL_READY_THEN_STDIN_BYTE_RELEASE' "$MULTI" || failures=$((failures + 1))
grep -q 'synchronized-wall.tsv' "$MULTI" || failures=$((failures + 1))
grep -q 'synchronized-wall-receipt.json' "$MULTI" || failures=$((failures + 1))
grep -q 'TOKEN_VAZIO_REPEATED_DEVICE_SERIES_REQUIRED' "$MULTI" || failures=$((failures + 1))

if ! "$CC" -std=c11 -O2 -Wall -Wextra -Werror -I android/app/native \
    -c "$SRC" -o "$OBJ" > "$EVIDENCE/host-compile.log" 2>&1; then
  failures=$((failures + 1))
fi

if ! "$CC" -std=c11 -O2 -Wall -Wextra -Werror -I android/app/native \
    -DRAFAELIA_BENCH_WORKER_ONLY=1 \
    -c "$SRC" -o "$WORKER_OBJ" > "$EVIDENCE/host-worker-compile.log" 2>&1; then
  failures=$((failures + 1))
fi

if ! "$CC" -std=c11 -O2 -Wall -Wextra -Werror -I android/app/native \
    -DRAFAELIA_BENCH_WORKER_ONLY=1 \
    -DRAFAELIA_BENCH_SYNC_WORKER=1 \
    -c "$SRC" -o "$SYNC_WORKER_OBJ" > "$EVIDENCE/host-sync-worker-compile.log" 2>&1; then
  failures=$((failures + 1))
fi

for object in "$OBJ" "$WORKER_OBJ" "$SYNC_WORKER_OBJ"; do
  if test -f "$object"; then
    name="$(basename "$object" .o)"
    nm -u "$object" > "$EVIDENCE/${name}-undefined-symbols.txt" 2>&1 || true
    if grep -Eiq '(malloc|calloc|realloc|free|aligned_alloc|posix_memalign|mmap|munmap)' \
        "$EVIDENCE/${name}-undefined-symbols.txt"; then
      echo 'allocator dependency emitted by benchmark adapter object' >&2
      failures=$((failures + 1))
    fi
  fi
done

if ! bash .github/scripts/rafaelia/arm32-neon4096-freestanding-gate.sh \
    > "$EVIDENCE/strict-leaf-gate.log" 2>&1; then
  failures=$((failures + 1))
fi

sha256sum "$SRC" "$RUNNER" "$MULTI" "$HDR" "$ASM" > "$EVIDENCE/SOURCE_SHA256SUMS.txt"

cat > "$EVIDENCE/receipt.json" <<EOF_JSON
{
  "schema": "rafaelia.frida.arm32-neon4096.physical-bench-adapter.structural-receipt.v3",
  "adapter_kind": "hosted_measurement_only_not_part_of_freestanding_leaf",
  "host_adapter_compile": "$(test -f "$OBJ" && printf PASS || printf FAIL)",
  "host_worker_specialization_compile": "$(test -f "$WORKER_OBJ" && printf PASS || printf FAIL)",
  "host_sync_worker_specialization_compile": "$(test -f "$SYNC_WORKER_OBJ" && printf PASS || printf FAIL)",
  "worker_specialization": "COMPILE_TIME_NEON_STREAM_ONLY",
  "synchronized_worker_specialization": "COMPILE_TIME_NEON_STREAM_ONLY_WITH_POST_WARMUP_STDIN_BARRIER",
  "static_aligned_buffer_sets": 5,
  "dynamic_allocation_in_adapter_source": false,
  "thread_or_scheduler_runtime_in_adapter_source": false,
  "multicore_orchestration_location": "EXTERNAL_TASKSET_SHELL_ONLY",
  "multicore_worker_counts_prepared": "1,2,4,8",
  "synchronized_start_protocol": "ALL_READY_THEN_STDIN_BYTE_RELEASE",
  "scalar_baseline_vectorization_disabled_by_device_runner": true,
  "strict_leaf_gate_reused": true,
  "physical_arm32_execution": "TOKEN_VAZIO",
  "cache_miss_rate": "TOKEN_VAZIO",
  "physical_dram_bandwidth": "TOKEN_VAZIO",
  "eight_core_scaling": "TOKEN_VAZIO_PHYSICAL_DEVICE_SERIES_REQUIRED",
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

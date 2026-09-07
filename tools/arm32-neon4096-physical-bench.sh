#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

: "${CC:=clang}"
: "${RAFAELIA_BENCH_CPU:=0}"

OUT="build/arm32-neon4096-physical-bench"
EVIDENCE="evidence/arm32-neon4096-physical-bench"
SRC="tools/arm32-neon4096-physical-bench.c"
ASM="android/app/native/neon4096_armv7.S"
HDR="android/app/native/neon4096_freestanding.h"
OBJ_C="$OUT/bench.o"
OBJ_ASM="$OUT/neon4096_armv7.o"
BIN="$OUT/arm32-neon4096-physical-bench"
mkdir -p "$OUT" "$EVIDENCE"

command -v "$CC" >/dev/null
command -v sha256sum >/dev/null
command -v uname >/dev/null

ARCH="$(uname -m)"
case "$ARCH" in
  armv7l|armv8l|arm)
    ;;
  *)
    printf 'ARM32_PHYSICAL_BENCH_NOT_RUN arch=%s\n' "$ARCH" >&2
    exit 3
    ;;
esac

COMMON_ARM=(
  -march=armv7-a
  -mfpu=neon
  -mfloat-abi=softfp
)

"$CC" "${COMMON_ARM[@]}" \
  -ffreestanding -fno-builtin -fno-stack-protector \
  -fno-unwind-tables -fno-asynchronous-unwind-tables \
  -c "$ASM" -o "$OBJ_ASM"

"$CC" "${COMMON_ARM[@]}" \
  -std=c11 -O3 -Wall -Wextra -Werror \
  -fno-vectorize -fno-slp-vectorize \
  -I android/app/native \
  -c "$SRC" -o "$OBJ_C"

"$CC" "${COMMON_ARM[@]}" "$OBJ_C" "$OBJ_ASM" -o "$BIN"

{
  printf 'arch=%s\n' "$ARCH"
  printf 'bench_cpu_requested=%s\n' "$RAFAELIA_BENCH_CPU"
  uname -a
  if command -v getconf >/dev/null 2>&1; then
    printf 'online_cpus='
    getconf _NPROCESSORS_ONLN || true
  else
    printf 'online_cpus=TOKEN_VAZIO\n'
  fi
  if command -v getprop >/dev/null 2>&1; then
    printf 'android_cpu_abi='
    getprop ro.product.cpu.abi || true
    printf 'android_hardware='
    getprop ro.hardware || true
  else
    printf 'android_cpu_abi=TOKEN_VAZIO\n'
    printf 'android_hardware=TOKEN_VAZIO\n'
  fi
} > "$EVIDENCE/device.txt"

AFFINITY="TOKEN_VAZIO"
if command -v taskset >/dev/null 2>&1; then
  AFFINITY="CPU_${RAFAELIA_BENCH_CPU}"
  taskset -c "$RAFAELIA_BENCH_CPU" "$BIN" | tee "$EVIDENCE/results.txt"
else
  "$BIN" | tee "$EVIDENCE/results.txt"
fi

grep -q '^correctness=PASS$' "$EVIDENCE/results.txt"
grep -q '^ratio_neon_vs_scalar_warm=' "$EVIDENCE/results.txt"
grep -q '^ratio_neon_vs_scalar_stream=' "$EVIDENCE/results.txt"
grep -q '^claim_allowed=false$' "$EVIDENCE/results.txt"

WARM_RATIO="$(grep '^ratio_neon_vs_scalar_warm=' "$EVIDENCE/results.txt" | tail -n 1 | cut -d= -f2)"
STREAM_RATIO="$(grep '^ratio_neon_vs_scalar_stream=' "$EVIDENCE/results.txt" | tail -n 1 | cut -d= -f2)"

sha256sum "$SRC" "$ASM" "$HDR" "$OBJ_C" "$OBJ_ASM" "$BIN" \
  > "$EVIDENCE/SHA256SUMS.txt"

ASM_OBJECT_SHA256="$(sha256sum "$OBJ_ASM" | cut -d' ' -f1)"
BIN_SHA256="$(sha256sum "$BIN" | cut -d' ' -f1)"

cat > "$EVIDENCE/receipt.json" <<EOF_JSON
{
  "schema": "rafaelia.frida.arm32-neon4096.physical-bench.receipt.v1",
  "execution_scope": "hosted_measurement_adapter_outside_freestanding_leaf",
  "arch": "$ARCH",
  "cpu_affinity": "$AFFINITY",
  "arm32_leaf_object_sha256": "$ASM_OBJECT_SHA256",
  "benchmark_binary_sha256": "$BIN_SHA256",
  "correctness": "PASS",
  "scalar_baseline_vectorization": "DISABLED_BY_COMPILE_FLAGS",
  "ratio_neon_vs_scalar_warm": "$WARM_RATIO",
  "ratio_neon_vs_scalar_stream": "$STREAM_RATIO",
  "cache_miss_rate": "TOKEN_VAZIO",
  "physical_dram_bandwidth": "TOKEN_VAZIO",
  "eight_core_scaling": "TOKEN_VAZIO",
  "three_x_throughput_general_claim": "NOT_PROMOTED_FROM_SINGLE_RUN",
  "physical_arm32_execution": "OBSERVED_THIS_RUN",
  "claim_allowed": false
}
EOF_JSON

printf 'ARM32_NEON4096_PHYSICAL_BENCH_OK warm_ratio=%s stream_ratio=%s affinity=%s\n' \
  "$WARM_RATIO" "$STREAM_RATIO" "$AFFINITY"

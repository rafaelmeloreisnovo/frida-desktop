#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

: "${CC:=clang}"
: "${RAFAELIA_BENCH_CORE_LIST:=0,1,2,3,4,5,6,7}"
: "${RAFAELIA_MULTICORE_ROUNDS:=65536}"

OUT="build/arm32-neon4096-multicore-bench"
EVIDENCE="evidence/arm32-neon4096-multicore-bench"
SRC="tools/arm32-neon4096-physical-bench.c"
ASM="android/app/native/neon4096_armv7.S"
HDR="android/app/native/neon4096_freestanding.h"
OBJ_C="$OUT/worker.o"
OBJ_ASM="$OUT/neon4096_armv7.o"
BIN="$OUT/arm32-neon4096-worker"
SUMMARY="$EVIDENCE/process-sum.tsv"
mkdir -p "$OUT" "$EVIDENCE"

command -v "$CC" >/dev/null
command -v taskset >/dev/null
command -v awk >/dev/null
command -v grep >/dev/null
command -v sha256sum >/dev/null

ARCH="$(uname -m)"
case "$ARCH" in
  armv7l|armv8l|arm)
    ;;
  *)
    printf 'ARM32_MULTICORE_BENCH_NOT_RUN arch=%s\n' "$ARCH" >&2
    exit 3
    ;;
esac

OLD_IFS="$IFS"
IFS=',' read -r -a CPUS <<< "$RAFAELIA_BENCH_CORE_LIST"
IFS="$OLD_IFS"
if test "${#CPUS[@]}" -lt 8; then
  printf 'ARM32_MULTICORE_BENCH_NEEDS_8_CPU_IDS got=%s\n' "${#CPUS[@]}" >&2
  exit 4
fi

ONLINE="TOKEN_VAZIO"
if command -v getconf >/dev/null 2>&1; then
  ONLINE="$(getconf _NPROCESSORS_ONLN 2>/dev/null || printf TOKEN_VAZIO)"
fi
if [[ "$ONLINE" =~ ^[0-9]+$ ]] && test "$ONLINE" -lt 8; then
  printf 'ARM32_MULTICORE_BENCH_NEEDS_8_ONLINE_CPUS got=%s\n' "$ONLINE" >&2
  exit 5
fi

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
  -DRAFAELIA_BENCH_WORKER_ONLY=1 \
  -DRAFAELIA_BENCH_ROUNDS="$RAFAELIA_MULTICORE_ROUNDS" \
  -I android/app/native \
  -c "$SRC" -o "$OBJ_C"

"$CC" "${COMMON_ARM[@]}" "$OBJ_C" "$OBJ_ASM" -o "$BIN"

printf 'workers\taggregate_process_sum_logical_GBps\taggregate_process_sum_declared_io_GBps\n' > "$SUMMARY"

run_wave() {
  local count="$1"
  local dir="$EVIDENCE/workers-$count"
  local -a pids=()
  local i
  local status=0
  local logical
  local declared

  rm -rf "$dir"
  mkdir -p "$dir"

  i=0
  while test "$i" -lt "$count"; do
    taskset -c "${CPUS[$i]}" "$BIN" > "$dir/cpu-${CPUS[$i]}.txt" 2>&1 &
    pids[$i]=$!
    i=$((i + 1))
  done

  i=0
  while test "$i" -lt "$count"; do
    if ! wait "${pids[$i]}"; then
      status=1
    fi
    i=$((i + 1))
  done
  test "$status" -eq 0

  for file in "$dir"/*.txt; do
    grep -q '^correctness=PASS$' "$file"
    grep -q '^worker_mode=NEON_STREAM_ONLY_COMPILE_TIME$' "$file"
    grep -q '^neon,stream,' "$file"
    grep -q '^claim_allowed=false$' "$file"
  done

  logical="$(awk -F, '$1=="neon" && $2=="stream" { s += $6 } END { printf "%.6f", s + 0.0 }' "$dir"/*.txt)"
  declared="$(awk -F, '$1=="neon" && $2=="stream" { s += $7 } END { printf "%.6f", s + 0.0 }' "$dir"/*.txt)"
  printf '%s\t%s\t%s\n' "$count" "$logical" "$declared" >> "$SUMMARY"
}

run_wave 1
run_wave 2
run_wave 4
run_wave 8

ONE="$(awk -F'\t' '$1==1 {print $2}' "$SUMMARY")"
TWO="$(awk -F'\t' '$1==2 {print $2}' "$SUMMARY")"
FOUR="$(awk -F'\t' '$1==4 {print $2}' "$SUMMARY")"
EIGHT="$(awk -F'\t' '$1==8 {print $2}' "$SUMMARY")"
S2="$(awk -v a="$TWO" -v b="$ONE" 'BEGIN { if (b == 0) print "0.000000"; else printf "%.6f", a / b }')"
S4="$(awk -v a="$FOUR" -v b="$ONE" 'BEGIN { if (b == 0) print "0.000000"; else printf "%.6f", a / b }')"
S8="$(awk -v a="$EIGHT" -v b="$ONE" 'BEGIN { if (b == 0) print "0.000000"; else printf "%.6f", a / b }')"

{
  printf 'arch=%s\n' "$ARCH"
  printf 'online_cpus=%s\n' "$ONLINE"
  printf 'core_list=%s\n' "$RAFAELIA_BENCH_CORE_LIST"
  printf 'rounds_per_worker=%s\n' "$RAFAELIA_MULTICORE_ROUNDS"
  uname -a
  if command -v getprop >/dev/null 2>&1; then
    printf 'android_cpu_abi='
    getprop ro.product.cpu.abi || true
    printf 'android_hardware='
    getprop ro.hardware || true
  fi
} > "$EVIDENCE/device.txt"

sha256sum "$SRC" "$ASM" "$HDR" "$OBJ_C" "$OBJ_ASM" "$BIN" \
  > "$EVIDENCE/SHA256SUMS.txt"

OBJ_SHA="$(sha256sum "$OBJ_ASM" | cut -d' ' -f1)"
BIN_SHA="$(sha256sum "$BIN" | cut -d' ' -f1)"

cat > "$EVIDENCE/receipt.json" <<EOF_JSON
{
  "schema": "rafaelia.frida.arm32-neon4096.multicore-process-sum.receipt.v1",
  "execution_scope": "external_taskset_process_orchestration_outside_freestanding_leaf",
  "arch": "$ARCH",
  "online_cpus": "$ONLINE",
  "core_list": "$RAFAELIA_BENCH_CORE_LIST",
  "rounds_per_worker": $RAFAELIA_MULTICORE_ROUNDS,
  "arm32_leaf_object_sha256": "$OBJ_SHA",
  "worker_binary_sha256": "$BIN_SHA",
  "one_worker_logical_GBps": "$ONE",
  "two_worker_logical_GBps": "$TWO",
  "four_worker_logical_GBps": "$FOUR",
  "eight_worker_logical_GBps": "$EIGHT",
  "process_sum_scaling_2_vs_1": "$S2",
  "process_sum_scaling_4_vs_1": "$S4",
  "process_sum_scaling_8_vs_1": "$S8",
  "affinity": "TASKSET_PER_WORKER",
  "start_barrier": "UNCONTROLLED_NEAR_SIMULTANEOUS_BACKGROUND_LAUNCH",
  "cache_miss_rate": "TOKEN_VAZIO",
  "physical_dram_bandwidth": "TOKEN_VAZIO",
  "eight_core_scaling_claim": "TOKEN_VAZIO_SYNCHRONIZED_WALL_MEASUREMENT_REQUIRED",
  "process_sum_scaling": "OBSERVED_CANDIDATE_ONLY",
  "three_x_throughput_general_claim": "NOT_PROMOTED",
  "claim_allowed": false
}
EOF_JSON

printf 'ARM32_NEON4096_MULTICORE_PROCESS_SUM_OK scale2=%s scale4=%s scale8=%s claim_allowed=false\n' \
  "$S2" "$S4" "$S8"

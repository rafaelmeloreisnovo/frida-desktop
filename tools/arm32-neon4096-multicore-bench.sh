#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

: "${CC:=clang}"
: "${RAFAELIA_BENCH_CORE_LIST:=0,1,2,3,4,5,6,7}"
: "${RAFAELIA_MULTICORE_ROUNDS:=65536}"
: "${RAFAELIA_READY_TIMEOUT_SECONDS:=30}"

OUT="build/arm32-neon4096-multicore-bench"
EVIDENCE="evidence/arm32-neon4096-multicore-bench"
SRC="tools/arm32-neon4096-physical-bench.c"
ASM="android/app/native/neon4096_armv7.S"
HDR="android/app/native/neon4096_freestanding.h"
OBJ_C="$OUT/worker.o"
OBJ_ASM="$OUT/neon4096_armv7.o"
BIN="$OUT/arm32-neon4096-worker"
SUMMARY="$EVIDENCE/process-sum.tsv"
WALL_SUMMARY="$EVIDENCE/synchronized-wall.tsv"
mkdir -p "$OUT" "$EVIDENCE"

command -v "$CC" >/dev/null
command -v taskset >/dev/null
command -v awk >/dev/null
command -v grep >/dev/null
command -v sha256sum >/dev/null
command -v mkfifo >/dev/null

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
  -DRAFAELIA_BENCH_SYNC_WORKER=1 \
  -DRAFAELIA_BENCH_ROUNDS="$RAFAELIA_MULTICORE_ROUNDS" \
  -I android/app/native \
  -c "$SRC" -o "$OBJ_C"

"$CC" "${COMMON_ARM[@]}" "$OBJ_C" "$OBJ_ASM" -o "$BIN"

printf 'workers\taggregate_process_sum_logical_GBps\taggregate_process_sum_declared_io_GBps\n' > "$SUMMARY"
printf 'workers\twall_ns\taggregate_wall_logical_GBps\taggregate_wall_declared_io_GBps\tstart_skew_ns\n' > "$WALL_SUMMARY"

ACTIVE_PIDS=()
ACTIVE_FIFOS=()
cleanup_active() {
  local pid fifo
  for pid in "${ACTIVE_PIDS[@]:-}"; do
    kill "$pid" >/dev/null 2>&1 || true
  done
  for pid in "${ACTIVE_PIDS[@]:-}"; do
    wait "$pid" >/dev/null 2>&1 || true
  done
  for fifo in "${ACTIVE_FIFOS[@]:-}"; do
    rm -f "$fifo"
  done
}
trap cleanup_active EXIT INT TERM

wait_ready() {
  local file="$1"
  local pid="$2"
  local deadline=$((SECONDS + RAFAELIA_READY_TIMEOUT_SECONDS))
  while ! grep -q '^ready=1$' "$file" 2>/dev/null; do
    if ! kill -0 "$pid" 2>/dev/null; then
      printf 'ARM32_MULTICORE_WORKER_EXITED_BEFORE_READY pid=%s file=%s\n' "$pid" "$file" >&2
      return 1
    fi
    if test "$SECONDS" -ge "$deadline"; then
      printf 'ARM32_MULTICORE_READY_TIMEOUT pid=%s file=%s timeout_s=%s\n' \
        "$pid" "$file" "$RAFAELIA_READY_TIMEOUT_SECONDS" >&2
      return 1
    fi
    sleep 0.02
  done
}

run_wave() {
  local count="$1"
  local dir="$EVIDENCE/workers-$count"
  local -a pids=()
  local -a release_fds=()
  local -a fifos=()
  local i cpu fifo file fd
  local status=0
  local logical declared
  local start end start_min="" start_max="" end_max=""
  local wall_ns start_skew_ns total_logical_bytes wall_logical wall_declared

  rm -rf "$dir"
  mkdir -p "$dir"
  ACTIVE_PIDS=()
  ACTIVE_FIFOS=()

  i=0
  while test "$i" -lt "$count"; do
    cpu="${CPUS[$i]}"
    fifo="$dir/cpu-${cpu}.release"
    file="$dir/cpu-${cpu}.txt"
    mkfifo "$fifo"
    exec {fd}<>"$fifo"
    release_fds[$i]="$fd"
    fifos[$i]="$fifo"
    taskset -c "$cpu" "$BIN" < "$fifo" > "$file" 2>&1 &
    pids[$i]=$!
    ACTIVE_PIDS+=("${pids[$i]}")
    ACTIVE_FIFOS+=("$fifo")
    i=$((i + 1))
  done

  i=0
  while test "$i" -lt "$count"; do
    cpu="${CPUS[$i]}"
    wait_ready "$dir/cpu-${cpu}.txt" "${pids[$i]}"
    i=$((i + 1))
  done

  i=0
  while test "$i" -lt "$count"; do
    fd="${release_fds[$i]}"
    printf 'x' >&$fd
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
    grep -q '^ready=1$' "$file"
    grep -q '^barrier=STDIN_BYTE_RELEASE$' "$file"
    grep -q '^correctness=PASS$' "$file"
    grep -q '^worker_mode=NEON_STREAM_ONLY_COMPILE_TIME$' "$file"
    grep -q '^start_ns=[0-9][0-9]*$' "$file"
    grep -q '^end_ns=[0-9][0-9]*$' "$file"
    grep -q '^neon,stream,' "$file"
    grep -q '^claim_allowed=false$' "$file"

    start="$(awk -F= '$1=="start_ns" { print $2; exit }' "$file")"
    end="$(awk -F= '$1=="end_ns" { print $2; exit }' "$file")"
    [[ "$start" =~ ^[0-9]+$ ]]
    [[ "$end" =~ ^[0-9]+$ ]]
    test "$end" -gt "$start"

    if test -z "$start_min" || test "$start" -lt "$start_min"; then
      start_min="$start"
    fi
    if test -z "$start_max" || test "$start" -gt "$start_max"; then
      start_max="$start"
    fi
    if test -z "$end_max" || test "$end" -gt "$end_max"; then
      end_max="$end"
    fi
  done

  logical="$(awk -F, '$1=="neon" && $2=="stream" { s += $6 } END { printf "%.6f", s + 0.0 }' "$dir"/*.txt)"
  declared="$(awk -F, '$1=="neon" && $2=="stream" { s += $7 } END { printf "%.6f", s + 0.0 }' "$dir"/*.txt)"
  printf '%s\t%s\t%s\n' "$count" "$logical" "$declared" >> "$SUMMARY"

  wall_ns=$((end_max - start_min))
  start_skew_ns=$((start_max - start_min))
  test "$wall_ns" -gt 0
  total_logical_bytes=$((count * RAFAELIA_MULTICORE_ROUNDS * 4096))
  wall_logical="$(awk -v bytes="$total_logical_bytes" -v ns="$wall_ns" 'BEGIN { if (ns <= 0) print "0.000000"; else printf "%.6f", bytes / ns }')"
  wall_declared="$(awk -v logical="$wall_logical" 'BEGIN { printf "%.6f", logical * 4.0 }')"
  printf '%s\t%s\t%s\t%s\t%s\n' \
    "$count" "$wall_ns" "$wall_logical" "$wall_declared" "$start_skew_ns" >> "$WALL_SUMMARY"

  i=0
  while test "$i" -lt "$count"; do
    fd="${release_fds[$i]}"
    exec {fd}>&-
    rm -f "${fifos[$i]}"
    i=$((i + 1))
  done
  ACTIVE_PIDS=()
  ACTIVE_FIFOS=()
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

WALL_ONE="$(awk -F'\t' '$1==1 {print $3}' "$WALL_SUMMARY")"
WALL_TWO="$(awk -F'\t' '$1==2 {print $3}' "$WALL_SUMMARY")"
WALL_FOUR="$(awk -F'\t' '$1==4 {print $3}' "$WALL_SUMMARY")"
WALL_EIGHT="$(awk -F'\t' '$1==8 {print $3}' "$WALL_SUMMARY")"
WS2="$(awk -v a="$WALL_TWO" -v b="$WALL_ONE" 'BEGIN { if (b == 0) print "0.000000"; else printf "%.6f", a / b }')"
WS4="$(awk -v a="$WALL_FOUR" -v b="$WALL_ONE" 'BEGIN { if (b == 0) print "0.000000"; else printf "%.6f", a / b }')"
WS8="$(awk -v a="$WALL_EIGHT" -v b="$WALL_ONE" 'BEGIN { if (b == 0) print "0.000000"; else printf "%.6f", a / b }')"

{
  printf 'arch=%s\n' "$ARCH"
  printf 'online_cpus=%s\n' "$ONLINE"
  printf 'core_list=%s\n' "$RAFAELIA_BENCH_CORE_LIST"
  printf 'rounds_per_worker=%s\n' "$RAFAELIA_MULTICORE_ROUNDS"
  printf 'barrier=ALL_READY_THEN_STDIN_BYTE_RELEASE\n'
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
  "start_barrier": "ALL_READY_THEN_STDIN_BYTE_RELEASE",
  "cache_miss_rate": "TOKEN_VAZIO",
  "physical_dram_bandwidth": "TOKEN_VAZIO",
  "eight_core_scaling_claim": "TOKEN_VAZIO_REPEATED_DEVICE_SERIES_REQUIRED",
  "process_sum_scaling": "OBSERVED_CANDIDATE_ONLY",
  "three_x_throughput_general_claim": "NOT_PROMOTED",
  "claim_allowed": false
}
EOF_JSON

cat > "$EVIDENCE/synchronized-wall-receipt.json" <<EOF_JSON
{
  "schema": "rafaelia.frida.arm32-neon4096.synchronized-wall.receipt.v1",
  "execution_scope": "hosted_all_ready_barrier_outside_freestanding_leaf",
  "arch": "$ARCH",
  "online_cpus": "$ONLINE",
  "core_list": "$RAFAELIA_BENCH_CORE_LIST",
  "rounds_per_worker": $RAFAELIA_MULTICORE_ROUNDS,
  "arm32_leaf_object_sha256": "$OBJ_SHA",
  "worker_binary_sha256": "$BIN_SHA",
  "barrier": "ALL_READY_THEN_STDIN_BYTE_RELEASE",
  "one_worker_wall_logical_GBps": "$WALL_ONE",
  "two_worker_wall_logical_GBps": "$WALL_TWO",
  "four_worker_wall_logical_GBps": "$WALL_FOUR",
  "eight_worker_wall_logical_GBps": "$WALL_EIGHT",
  "synchronized_wall_scaling_2_vs_1": "$WS2",
  "synchronized_wall_scaling_4_vs_1": "$WS4",
  "synchronized_wall_scaling_8_vs_1": "$WS8",
  "cache_miss_rate": "TOKEN_VAZIO",
  "physical_dram_bandwidth": "TOKEN_VAZIO",
  "generalized_eight_core_scaling_claim": "TOKEN_VAZIO_REPEATED_DEVICE_SERIES_REQUIRED",
  "three_x_throughput_general_claim": "NOT_PROMOTED",
  "claim_allowed": false
}
EOF_JSON

printf 'ARM32_NEON4096_MULTICORE_SYNC_OK process_sum_scale8=%s wall_scale8=%s claim_allowed=false\n' \
  "$S8" "$WS8"

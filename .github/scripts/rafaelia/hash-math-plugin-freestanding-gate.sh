#!/usr/bin/env bash
set -Euo pipefail
IFS=$'\n\t'

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

SRC="android/app/native/hash_math_plugin_scalar.c"
HDR="android/app/native/hash_math_plugin.h"
ARM32="android/app/native/hash_math_plugin_armv7.S"
ARM64="android/app/native/hash_math_plugin_aarch64.S"
OUT="build/hash-math-plugin-freestanding"
EVIDENCE="evidence/hash-math-plugin-freestanding"
mkdir -p "$OUT" "$EVIDENCE"

: "${CLANG:=clang}"
command -v "$CLANG" >/dev/null || exit 2
command -v readelf >/dev/null || exit 2
command -v nm >/dev/null || exit 2
command -v sha256sum >/dev/null || exit 2

failures=0

forbidden='(^|[^A-Za-z0-9_])(malloc|calloc|realloc|free|memcpy|memset|memcmp|open|read|close|sysconf|pthread|stdatomic|thread_local|__thread)([^A-Za-z0-9_]|$)'
if grep -Eiq "$forbidden" "$SRC" "$HDR" "$ARM32" "$ARM64"; then
  echo 'forbidden hosted dependency token found' >&2
  failures=$((failures + 1))
fi

if grep -Eiq '^[[:space:]]*(bl|blx|blr|call|push|pop)[[:space:]]' "$ARM32" "$ARM64"; then
  echo 'forbidden call or explicit stack instruction found' >&2
  failures=$((failures + 1))
fi

# ARMv7 sidecar geometry is intentionally identical to the strict NEON4096 page cadence:
# 16 fixed iterations x 256 bytes = 4096 bytes, with prefetch points every 128 bytes.
test "$(grep -Ec '^[[:space:]]*mov[[:space:]]+r12,[[:space:]]*#16[[:space:]]*$' "$ARM32")" -eq 1 || failures=$((failures + 1))
test "$(grep -Ec '^[[:space:]]*bne[[:space:]]+1b[[:space:]]*$' "$ARM32")" -eq 1 || failures=$((failures + 1))
test "$(grep -Ec '^[[:space:]]*\.rept[[:space:]]+4[[:space:]]*$' "$ARM32")" -eq 2 || failures=$((failures + 1))
if grep -Eq '^[[:space:]]*mov[[:space:]]+r12,[[:space:]]*#32[[:space:]]*$' "$ARM32"; then
  echo 'legacy ARMv7 32-iteration sidecar geometry found' >&2
  failures=$((failures + 1))
fi

TARGETS=(
  armv7a-none-eabi
  aarch64-none-elf
  x86_64-none-elf
  i386-none-elf
  riscv64-none-elf
  riscv32-none-elf
  powerpc64le-none-elf
  s390x-none-elf
  mipsel-none-elf
  mips64el-none-elf
)

: > "$EVIDENCE/target-matrix.tsv"
printf 'target\tenabled_object\tdisabled_object\tundefined_symbols\tdisabled_globals\n' >> "$EVIDENCE/target-matrix.tsv"

passed=0
for target in "${TARGETS[@]}"; do
  safe="${target//[^A-Za-z0-9_.-]/_}"
  enabled="$OUT/${safe}.enabled.o"
  disabled="$OUT/${safe}.disabled.o"
  enabled_status=PASS
  disabled_status=PASS
  undefined_status=0
  disabled_globals=0

  if ! "$CLANG" --target="$target" -O3 -ffreestanding -fno-builtin \
      -fno-stack-protector -fno-unwind-tables -fno-asynchronous-unwind-tables \
      -fvisibility=hidden -fno-pic -fno-pie -c "$SRC" -o "$enabled" \
      > "$EVIDENCE/${safe}.enabled-build.log" 2>&1; then
    enabled_status=FAIL
    undefined_status=TOKEN_VAZIO
    failures=$((failures + 1))
  else
    nm -u "$enabled" > "$EVIDENCE/${safe}.undefined.txt" 2>&1 || true
    if test -s "$EVIDENCE/${safe}.undefined.txt"; then
      undefined_status=FAIL
      failures=$((failures + 1))
    fi
  fi

  if ! "$CLANG" --target="$target" -O3 -ffreestanding -fno-builtin \
      -fno-stack-protector -fno-unwind-tables -fno-asynchronous-unwind-tables \
      -fvisibility=hidden -fno-pic -fno-pie \
      -DRAFAELIA_HASH_MATH_PLUGIN_STATE=0 -c "$SRC" -o "$disabled" \
      > "$EVIDENCE/${safe}.disabled-build.log" 2>&1; then
    disabled_status=FAIL
    disabled_globals=TOKEN_VAZIO
    failures=$((failures + 1))
  else
    nm -g --defined-only "$disabled" > "$EVIDENCE/${safe}.disabled-globals.txt" 2>&1 || true
    if test -s "$EVIDENCE/${safe}.disabled-globals.txt"; then
      disabled_globals=FAIL
      failures=$((failures + 1))
    fi
  fi

  if test "$enabled_status" = PASS && test "$disabled_status" = PASS && \
     test "$undefined_status" = 0 && test "$disabled_globals" = 0; then
    passed=$((passed + 1))
  fi

  printf '%s\t%s\t%s\t%s\t%s\n' \
    "$target" "$enabled_status" "$disabled_status" "$undefined_status" "$disabled_globals" \
    >> "$EVIDENCE/target-matrix.tsv"
done

arm32_status=PASS
if ! "$CLANG" --target=armv7a-none-eabi -march=armv7-a -mfpu=neon -mfloat-abi=softfp \
    -ffreestanding -fno-builtin -c "$ARM32" -o "$OUT/hash_math_plugin_armv7.o" \
    > "$EVIDENCE/armv7-build.log" 2>&1; then
  arm32_status=FAIL
  failures=$((failures + 1))
fi

arm64_status=PASS
if ! "$CLANG" --target=aarch64-none-elf -march=armv8-a+simd \
    -ffreestanding -fno-builtin -c "$ARM64" -o "$OUT/hash_math_plugin_aarch64.o" \
    > "$EVIDENCE/aarch64-build.log" 2>&1; then
  arm64_status=FAIL
  failures=$((failures + 1))
fi

if test "$arm32_status" = PASS; then
  readelf -h "$OUT/hash_math_plugin_armv7.o" > "$EVIDENCE/armv7-elf-header.txt"
  readelf -Ws "$OUT/hash_math_plugin_armv7.o" > "$EVIDENCE/armv7-symbols.txt"
  nm -u "$OUT/hash_math_plugin_armv7.o" > "$EVIDENCE/armv7-undefined.txt" 2>&1 || true
  grep -Eq 'Class:[[:space:]]+ELF32' "$EVIDENCE/armv7-elf-header.txt" || failures=$((failures + 1))
  grep -Eq 'Machine:[[:space:]]+ARM' "$EVIDENCE/armv7-elf-header.txt" || failures=$((failures + 1))
  test ! -s "$EVIDENCE/armv7-undefined.txt" || failures=$((failures + 1))
  grep -Eq 'FUNC[[:space:]]+GLOBAL[[:space:]]+HIDDEN.*rafaelia_hash_math_plugin_4096_armv7$' "$EVIDENCE/armv7-symbols.txt" || failures=$((failures + 1))
fi

if test "$arm64_status" = PASS; then
  readelf -h "$OUT/hash_math_plugin_aarch64.o" > "$EVIDENCE/aarch64-elf-header.txt"
  readelf -Ws "$OUT/hash_math_plugin_aarch64.o" > "$EVIDENCE/aarch64-symbols.txt"
  nm -u "$OUT/hash_math_plugin_aarch64.o" > "$EVIDENCE/aarch64-undefined.txt" 2>&1 || true
  grep -Eq 'Class:[[:space:]]+ELF64' "$EVIDENCE/aarch64-elf-header.txt" || failures=$((failures + 1))
  grep -Eq 'Machine:[[:space:]]+AArch64' "$EVIDENCE/aarch64-elf-header.txt" || failures=$((failures + 1))
  test ! -s "$EVIDENCE/aarch64-undefined.txt" || failures=$((failures + 1))
  grep -Eq 'FUNC[[:space:]]+GLOBAL[[:space:]]+HIDDEN.*rafaelia_hash_math_plugin_4096_aarch64$' "$EVIDENCE/aarch64-symbols.txt" || failures=$((failures + 1))
fi

grep -q 'RAFAELIA_HASH_PLUGIN_PAGE_BYTES 4096u' "$HDR" || failures=$((failures + 1))
grep -q 'RAFAELIA_HASH_PLUGIN_ARM32_LANES_U8_PER_NEON 16u' "$HDR" || failures=$((failures + 1))
grep -q 'RAFAELIA_HASH_PLUGIN_ARM64_LANES_U8_PER_NEON 16u' "$HDR" || failures=$((failures + 1))
grep -q 'RAFAELIA_HASH_PLUGIN_ARM64_SOFTWARE_STAGE_U8 32u' "$HDR" || failures=$((failures + 1))

if test -f "$OUT/hash_math_plugin_armv7.o" && test -f "$OUT/hash_math_plugin_aarch64.o"; then
  sha256sum "$SRC" "$HDR" "$ARM32" "$ARM64" \
    "$OUT/hash_math_plugin_armv7.o" "$OUT/hash_math_plugin_aarch64.o" \
    > "$EVIDENCE/SHA256SUMS.txt"
else
  sha256sum "$SRC" "$HDR" "$ARM32" "$ARM64" > "$EVIDENCE/SHA256SUMS.txt"
fi

cat > "$EVIDENCE/receipt.json" <<EOF_JSON
{
  "schema": "rafaelia.frida.hash-math-plugin.freestanding.receipt.v2",
  "plugin_kind": "sidecar_transform_not_a_hash_redefinition",
  "portable_targets_requested": 10,
  "portable_targets_structurally_passed": $passed,
  "compile_time_disable_target": "zero_global_plugin_symbols",
  "strict_armv7_neon": "$arm32_status",
  "strict_aarch64_asimd": "$arm64_status",
  "page_bytes": 4096,
  "source_streams": 3,
  "arm32_physical_vector_bits": 128,
  "arm32_u8_lanes_per_vector": 16,
  "arm32_bytes_per_fixed_loop_iteration": 256,
  "arm32_fixed_loop_iterations_per_page": 16,
  "arm32_prefetch_cadence_bytes": 128,
  "arm32_loop_control_iteration_reduction_vs_v1": "32_to_16",
  "aarch64_physical_vector_bits": 128,
  "aarch64_u8_lanes_per_vector": 16,
  "aarch64_software_stage_bytes": 32,
  "host_hash_math_modified": false,
  "md5_security_use_recommended": false,
  "malloc_heap_gc_libc_syscall_dependency": false,
  "physical_device_execution": "TOKEN_VAZIO",
  "cache_miss_rate": "TOKEN_VAZIO",
  "throughput_ratio_vs_baseline": "TOKEN_VAZIO",
  "bandwidth_ratio_vs_baseline": "TOKEN_VAZIO",
  "three_x_throughput_claim": "TOKEN_VAZIO",
  "eight_core_scaling": "TOKEN_VAZIO",
  "structural_failures": $failures,
  "claim_allowed": false
}
EOF_JSON

if test "$failures" -ne 0; then
  printf 'HASH_MATH_PLUGIN_FREESTANDING_GATE_FAIL failures=%s targets_passed=%s/10\n' "$failures" "$passed" >&2
  exit 1
fi

printf 'HASH_MATH_PLUGIN_FREESTANDING_GATE_OK targets_passed=%s/10\n' "$passed"

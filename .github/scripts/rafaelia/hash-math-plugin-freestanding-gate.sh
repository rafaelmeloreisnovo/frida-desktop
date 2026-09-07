#!/usr/bin/env bash
set -Eeuo pipefail
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
command -v "$CLANG" >/dev/null
command -v readelf >/dev/null
command -v nm >/dev/null
command -v sha256sum >/dev/null

forbidden='malloc|calloc|realloc|free|memcpy|memset|memcmp|open|read|close|sysconf|pthread|stdatomic|thread_local|__thread'
if grep -Eiq "$forbidden" "$SRC" "$HDR" "$ARM32" "$ARM64"; then
  echo 'forbidden hosted dependency token found' >&2
  exit 1
fi

if grep -Eiq '(^|[[:space:]])(bl|blx|blr|call|push|pop)[[:space:]]' "$ARM32" "$ARM64"; then
  echo 'forbidden call or explicit stack instruction found' >&2
  exit 1
fi

if grep -Eiq 'shadow|tail.?call' "$ARM32" "$ARM64"; then
  echo 'forbidden shadow/tail route token found in strict kernels' >&2
  exit 1
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

for target in "${TARGETS[@]}"; do
  safe="${target//[^A-Za-z0-9_.-]/_}"
  enabled="$OUT/${safe}.enabled.o"
  disabled="$OUT/${safe}.disabled.o"

  "$CLANG" --target="$target" -O3 -ffreestanding -fno-builtin \
    -fno-stack-protector -fno-unwind-tables -fno-asynchronous-unwind-tables \
    -fvisibility=hidden -fno-pic -fno-pie -c "$SRC" -o "$enabled"

  "$CLANG" --target="$target" -O3 -ffreestanding -fno-builtin \
    -fno-stack-protector -fno-unwind-tables -fno-asynchronous-unwind-tables \
    -fvisibility=hidden -fno-pic -fno-pie \
    -DRAFAELIA_HASH_MATH_PLUGIN_STATE=0 -c "$SRC" -o "$disabled"

  nm -u "$enabled" > "$EVIDENCE/${safe}.undefined.txt"
  nm -g --defined-only "$disabled" > "$EVIDENCE/${safe}.disabled-globals.txt"
  test ! -s "$EVIDENCE/${safe}.undefined.txt"
  test ! -s "$EVIDENCE/${safe}.disabled-globals.txt"

  printf '%s\tPASS\tPASS\t0\t0\n' "$target" >> "$EVIDENCE/target-matrix.tsv"
done

"$CLANG" --target=armv7a-none-eabi -march=armv7-a -mfpu=neon -mfloat-abi=softfp \
  -ffreestanding -fno-builtin -c "$ARM32" -o "$OUT/hash_math_plugin_armv7.o"
"$CLANG" --target=aarch64-none-elf -march=armv8-a+simd \
  -ffreestanding -fno-builtin -c "$ARM64" -o "$OUT/hash_math_plugin_aarch64.o"

readelf -h "$OUT/hash_math_plugin_armv7.o" > "$EVIDENCE/armv7-elf-header.txt"
readelf -Ws "$OUT/hash_math_plugin_armv7.o" > "$EVIDENCE/armv7-symbols.txt"
nm -u "$OUT/hash_math_plugin_armv7.o" > "$EVIDENCE/armv7-undefined.txt"

readelf -h "$OUT/hash_math_plugin_aarch64.o" > "$EVIDENCE/aarch64-elf-header.txt"
readelf -Ws "$OUT/hash_math_plugin_aarch64.o" > "$EVIDENCE/aarch64-symbols.txt"
nm -u "$OUT/hash_math_plugin_aarch64.o" > "$EVIDENCE/aarch64-undefined.txt"

grep -Eq 'Class:[[:space:]]+ELF32' "$EVIDENCE/armv7-elf-header.txt"
grep -Eq 'Machine:[[:space:]]+ARM' "$EVIDENCE/armv7-elf-header.txt"
grep -Eq 'Class:[[:space:]]+ELF64' "$EVIDENCE/aarch64-elf-header.txt"
grep -Eq 'Machine:[[:space:]]+AArch64' "$EVIDENCE/aarch64-elf-header.txt"
test ! -s "$EVIDENCE/armv7-undefined.txt"
test ! -s "$EVIDENCE/aarch64-undefined.txt"

grep -Eq 'FUNC[[:space:]]+GLOBAL[[:space:]]+HIDDEN.*rafaelia_hash_math_plugin_4096_armv7$' "$EVIDENCE/armv7-symbols.txt"
grep -Eq 'FUNC[[:space:]]+GLOBAL[[:space:]]+HIDDEN.*rafaelia_hash_math_plugin_4096_aarch64$' "$EVIDENCE/aarch64-symbols.txt"

grep -q 'RAFAELIA_HASH_PLUGIN_PAGE_BYTES 4096u' "$HDR"
grep -q 'RAFAELIA_HASH_PLUGIN_ARM32_LANES_U8_PER_NEON 16u' "$HDR"
grep -q 'RAFAELIA_HASH_PLUGIN_ARM64_LANES_U8_PER_NEON 16u' "$HDR"
grep -q 'RAFAELIA_HASH_PLUGIN_ARM64_SOFTWARE_STAGE_U8 32u' "$HDR"

sha256sum "$SRC" "$HDR" "$ARM32" "$ARM64" \
  "$OUT/hash_math_plugin_armv7.o" "$OUT/hash_math_plugin_aarch64.o" \
  > "$EVIDENCE/SHA256SUMS.txt"

cat > "$EVIDENCE/receipt.json" <<'EOF_JSON'
{
  "schema": "rafaelia.frida.hash-math-plugin.freestanding.receipt.v1",
  "plugin_kind": "sidecar_transform_not_a_hash_redefinition",
  "portable_targets_structurally_compiled": 10,
  "compile_time_disable_removes_global_plugin_symbol": true,
  "strict_armv7_neon": "PASS",
  "strict_aarch64_asimd": "PASS",
  "page_bytes": 4096,
  "source_streams": 3,
  "arm32_physical_vector_bits": 128,
  "arm32_u8_lanes_per_vector": 16,
  "aarch64_physical_vector_bits": 128,
  "aarch64_u8_lanes_per_vector": 16,
  "aarch64_software_stage_bytes": 32,
  "host_hash_math_modified": false,
  "md5_security_use_recommended": false,
  "malloc_heap_gc_libc_syscall_dependency": false,
  "external_undefined_symbols_strict_arm": 0,
  "physical_device_execution": "TOKEN_VAZIO",
  "cache_miss_rate": "TOKEN_VAZIO",
  "throughput_ratio_vs_baseline": "TOKEN_VAZIO",
  "bandwidth_ratio_vs_baseline": "TOKEN_VAZIO",
  "three_x_throughput_claim": "TOKEN_VAZIO",
  "claim_allowed": false
}
EOF_JSON

printf '%s\n' 'HASH_MATH_PLUGIN_FREESTANDING_GATE_OK'

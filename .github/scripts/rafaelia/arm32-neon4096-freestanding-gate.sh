#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

SRC="android/app/native/neon4096_armv7.S"
HDR="android/app/native/neon4096_freestanding.h"
OUT="build/arm32-neon4096-freestanding"
EVIDENCE="evidence/arm32-neon4096-freestanding"
OBJ="$OUT/neon4096_armv7.o"
UNROLLED_OBJ="$OUT/neon4096_armv7_full_unroll.o"
mkdir -p "$OUT" "$EVIDENCE"

: "${CLANG:=clang}"
command -v "$CLANG" >/dev/null
command -v readelf >/dev/null
command -v nm >/dev/null
command -v sha256sum >/dev/null

COMMON_FLAGS=(
  --target=armv7a-none-eabi
  -march=armv7-a
  -mfpu=neon
  -mfloat-abi=softfp
  -ffreestanding
  -fno-builtin
  -fno-stack-protector
  -fno-unwind-tables
  -fno-asynchronous-unwind-tables
)

"$CLANG" "${COMMON_FLAGS[@]}" -c "$SRC" -o "$OBJ"
"$CLANG" "${COMMON_FLAGS[@]}" -DRAFAELIA_NEON4096_FULL_UNROLL=1 -c "$SRC" -o "$UNROLLED_OBJ"

for object in "$OBJ" "$UNROLLED_OBJ"; do
  name="$(basename "$object" .o)"
  readelf -h "$object" > "$EVIDENCE/${name}-elf-header.txt"
  readelf -Ws "$object" > "$EVIDENCE/${name}-symbols.txt"
  readelf -SW "$object" > "$EVIDENCE/${name}-sections.txt"
  nm -u "$object" > "$EVIDENCE/${name}-undefined-symbols.txt"

  grep -Eq 'Class:[[:space:]]+ELF32' "$EVIDENCE/${name}-elf-header.txt"
  grep -Eq 'Machine:[[:space:]]+ARM' "$EVIDENCE/${name}-elf-header.txt"
  test ! -s "$EVIDENCE/${name}-undefined-symbols.txt"

  GLOBAL_COUNT="$(awk '$5 == "GLOBAL" { n += 1 } END { print n + 0 }' "$EVIDENCE/${name}-symbols.txt")"
  test "$GLOBAL_COUNT" -eq 2
  grep -Eq 'FUNC[[:space:]]+GLOBAL[[:space:]]+HIDDEN.*rafaelia_neon4096_stage4096_armv7$' "$EVIDENCE/${name}-symbols.txt"
  grep -Eq 'FUNC[[:space:]]+GLOBAL[[:space:]]+HIDDEN.*rafaelia_neon4096_xor3_4096_armv7$' "$EVIDENCE/${name}-symbols.txt"
done

sha256sum "$SRC" "$HDR" "$OBJ" "$UNROLLED_OBJ" > "$EVIDENCE/SHA256SUMS.txt"

if grep -Eiq '^[[:space:]]*(bl|blx|push|pop)[[:space:]]' "$SRC"; then
  echo 'forbidden call/stack instruction found' >&2
  exit 1
fi

# Baseline geometry remains available and unchanged under the compile-time switch.
test "$(grep -Ec '^[[:space:]]*mov[[:space:]]+r12,[[:space:]]*#16[[:space:]]*$' "$SRC")" -eq 2
test "$(grep -Ec '^[[:space:]]*bne[[:space:]]+[12]b[[:space:]]*$' "$SRC")" -eq 2

# Full-unroll candidate expands the fixed 16 iterations at assembly time.
test "$(grep -Ec '^[[:space:]]*\.rept[[:space:]]+16[[:space:]]*$' "$SRC")" -eq 2
grep -q '#define RAFAELIA_NEON4096_FULL_UNROLL 0' "$SRC"
grep -q '#if RAFAELIA_NEON4096_FULL_UNROLL' "$SRC"

grep -q 'RAFAELIA_NEON4096_FS_PAGE_BYTES 4096u' "$HDR"
grep -q 'RAFAELIA_NEON4096_FS_VECTOR_BITS 128u' "$HDR"
grep -q 'RAFAELIA_NEON4096_FS_U8_LANES 16u' "$HDR"
grep -q 'RAFAELIA_NEON4096_FS_VECTORS_PER_PAGE 256u' "$HDR"
grep -q 'RAFAELIA_NEON4096_FS_STREAMS 3u' "$HDR"

cat > "$EVIDENCE/receipt.json" <<EOF_JSON
{
  "schema": "rafaelia.frida.arm32-neon4096-freestanding.receipt.v3",
  "source_contract": "PASS",
  "baseline_compile": "PASS",
  "full_unroll_compile": "PASS",
  "elf32_arm": "PASS",
  "undefined_symbols_baseline": 0,
  "undefined_symbols_full_unroll": 0,
  "global_hidden_abi_symbols": 2,
  "abi_preserved_across_specializations": true,
  "heap_allocator_dependency": false,
  "libc_dependency": false,
  "syscall_dependency": false,
  "external_call_dependency": false,
  "stack_instruction_dependency": false,
  "page_bytes": 4096,
  "vector_bits": 128,
  "u8_lanes_per_vector": 16,
  "vectors_per_page": 256,
  "independent_source_streams": 3,
  "baseline_fixed_loop_iterations_per_page": 16,
  "full_unroll_runtime_loop_control_branch": false,
  "full_unroll_status": "STRUCTURALLY_COMPILED_CANDIDATE",
  "full_unroll_icache_tradeoff": "TOKEN_VAZIO_PHYSICAL_MEASUREMENT_REQUIRED",
  "physical_arm32_execution": "TOKEN_VAZIO",
  "cache_miss_rate": "TOKEN_VAZIO",
  "throughput_ratio_full_unroll_vs_baseline": "TOKEN_VAZIO",
  "bandwidth_ratio_full_unroll_vs_baseline": "TOKEN_VAZIO",
  "three_x_throughput_claim": "TOKEN_VAZIO",
  "eight_core_scaling": "TOKEN_VAZIO",
  "claim_allowed": false
}
EOF_JSON

printf '%s\n' 'ARM32_NEON4096_FREESTANDING_GATE_OK'

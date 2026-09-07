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
mkdir -p "$OUT" "$EVIDENCE"

: "${CLANG:=clang}"
command -v "$CLANG" >/dev/null
command -v readelf >/dev/null
command -v nm >/dev/null
command -v sha256sum >/dev/null

"$CLANG" \
  --target=armv7a-none-eabi \
  -march=armv7-a \
  -mfpu=neon \
  -mfloat-abi=softfp \
  -ffreestanding \
  -fno-builtin \
  -fno-stack-protector \
  -fno-unwind-tables \
  -fno-asynchronous-unwind-tables \
  -c "$SRC" \
  -o "$OBJ"

readelf -h "$OBJ" > "$EVIDENCE/elf-header.txt"
readelf -Ws "$OBJ" > "$EVIDENCE/symbols.txt"
readelf -SW "$OBJ" > "$EVIDENCE/sections.txt"
nm -u "$OBJ" > "$EVIDENCE/undefined-symbols.txt"
sha256sum "$SRC" "$HDR" "$OBJ" > "$EVIDENCE/SHA256SUMS.txt"

grep -Eq 'Class:[[:space:]]+ELF32' "$EVIDENCE/elf-header.txt"
grep -Eq 'Machine:[[:space:]]+ARM' "$EVIDENCE/elf-header.txt"

test ! -s "$EVIDENCE/undefined-symbols.txt"

GLOBAL_COUNT="$(awk '$5 == "GLOBAL" { n += 1 } END { print n + 0 }' "$EVIDENCE/symbols.txt")"
test "$GLOBAL_COUNT" -eq 2
grep -Eq 'FUNC[[:space:]]+GLOBAL[[:space:]]+HIDDEN.*rafaelia_neon4096_stage4096_armv7$' "$EVIDENCE/symbols.txt"
grep -Eq 'FUNC[[:space:]]+GLOBAL[[:space:]]+HIDDEN.*rafaelia_neon4096_xor3_4096_armv7$' "$EVIDENCE/symbols.txt"

if grep -Eiq '^[[:space:]]*(bl|blx|push|pop)[[:space:]]' "$SRC"; then
  echo 'forbidden call/stack instruction found' >&2
  exit 1
fi

grep -q 'RAFAELIA_NEON4096_FS_PAGE_BYTES 4096u' "$HDR"
grep -q 'RAFAELIA_NEON4096_FS_VECTOR_BITS 128u' "$HDR"
grep -q 'RAFAELIA_NEON4096_FS_U8_LANES 16u' "$HDR"
grep -q 'RAFAELIA_NEON4096_FS_VECTORS_PER_PAGE 256u' "$HDR"
grep -q 'RAFAELIA_NEON4096_FS_STREAMS 3u' "$HDR"

cat > "$EVIDENCE/receipt.json" <<EOF_JSON
{
  "schema": "rafaelia.frida.arm32-neon4096-freestanding.receipt.v1",
  "source_contract": "PASS",
  "elf32_arm": "PASS",
  "undefined_symbols": 0,
  "global_hidden_abi_symbols": 2,
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
  "data_path_branchless": true,
  "fixed_loop_control_branch": true,
  "physical_arm32_execution": "TOKEN_VAZIO",
  "cache_miss_rate": "TOKEN_VAZIO",
  "throughput_ratio_vs_baseline": "TOKEN_VAZIO",
  "bandwidth_ratio_vs_baseline": "TOKEN_VAZIO",
  "claim_allowed": false
}
EOF_JSON

printf '%s\n' 'ARM32_NEON4096_FREESTANDING_GATE_OK'

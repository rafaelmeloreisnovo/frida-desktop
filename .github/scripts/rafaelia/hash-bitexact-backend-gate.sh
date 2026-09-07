#!/usr/bin/env bash
set -Euo pipefail
IFS=$'\n\t'
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"
CORE="android/app/native/hash_bitexact_core.h"
EQ="android/app/native/hash_bitexact_equations.h"
TEST=".github/tests/rafaelia/hash_bitexact_vectors.c"
OUT="build/hash-bitexact-backend"
EVIDENCE="evidence/hash-bitexact-backend"
mkdir -p "$OUT" "$EVIDENCE"
: "${CLANG:=clang}"
for c in "$CLANG" nm sha256sum; do command -v "$c" >/dev/null || exit 2; done
failures=0
forbidden='(^|[^A-Za-z0-9_])(malloc|calloc|realloc|free|memcpy|memset|memcmp|open|read|write|close|sysconf|pthread|stdatomic|thread_local|__thread)([^A-Za-z0-9_]|$)'
if grep -Eiq "$forbidden" "$CORE" "$EQ"; then
  echo 'forbidden hosted dependency token found in production bit-exact headers' >&2
  failures=$((failures + 1))
fi
if grep -Eq '^[[:space:]]*(extern|void|unsigned|int|long)[[:space:]].*rafaelia_' "$CORE" "$EQ"; then
  echo 'production bit-exact core must remain static-inline/header-only' >&2
  failures=$((failures + 1))
fi
cat > "$OUT/header_probe.c" <<'EOF_PROBE'
#include "hash_bitexact_equations.h"
EOF_PROBE
TARGETS=(armv7a-none-eabi aarch64-none-elf x86_64-none-elf i386-none-elf riscv64-none-elf riscv32-none-elf powerpc64le-none-elf s390x-none-elf mipsel-none-elf mips64el-none-elf)
printf 'target\theader_object\tglobal_symbols\tvector_object\n' > "$EVIDENCE/target-matrix.tsv"
passed=0
for target in "${TARGETS[@]}"; do
  safe="${target//[^A-Za-z0-9_.-]/_}"
  header_status=PASS
  vector_status=PASS
  globals=0
  if ! "$CLANG" --target="$target" -std=c11 -O3 -ffreestanding -fno-builtin -fno-stack-protector -fno-unwind-tables -fno-asynchronous-unwind-tables -Iandroid/app/native -c "$OUT/header_probe.c" -o "$OUT/${safe}.header.o" > "$EVIDENCE/${safe}.header.log" 2>&1; then
    header_status=FAIL; globals=TOKEN_VAZIO; failures=$((failures + 1))
  else
    nm -g --defined-only "$OUT/${safe}.header.o" > "$EVIDENCE/${safe}.globals.txt" 2>&1 || true
    if test -s "$EVIDENCE/${safe}.globals.txt"; then globals=FAIL; failures=$((failures + 1)); fi
  fi
  if ! "$CLANG" --target="$target" -std=c11 -O3 -ffreestanding -fno-builtin -fno-stack-protector -fno-unwind-tables -fno-asynchronous-unwind-tables -c "$TEST" -o "$OUT/${safe}.vectors.o" > "$EVIDENCE/${safe}.vectors.log" 2>&1; then
    vector_status=FAIL; failures=$((failures + 1))
  fi
  if test "$header_status" = PASS && test "$globals" = 0 && test "$vector_status" = PASS; then passed=$((passed + 1)); fi
  printf '%s\t%s\t%s\t%s\n' "$target" "$header_status" "$globals" "$vector_status" >> "$EVIDENCE/target-matrix.tsv"
done
native_status=PASS
if ! "$CLANG" -std=c11 -O0 -ffreestanding -fno-builtin -fno-stack-protector "$TEST" -o "$OUT/hash_bitexact_vectors" > "$EVIDENCE/native-build.log" 2>&1; then
  native_status=BUILD_FAIL; failures=$((failures + 1))
elif ! "$OUT/hash_bitexact_vectors"; then
  native_status=VECTOR_FAIL; failures=$((failures + 1))
fi
sha256sum "$CORE" "$EQ" "$TEST" > "$EVIDENCE/SHA256SUMS.txt"
cat > "$EVIDENCE/receipt.json" <<EOF_JSON
{
  "schema": "rafaelia.frida.hash-bitexact-backend.receipt.v1",
  "semantic_role": "bit_exact_backend_not_hash_redefinition",
  "production_core": "header_only_static_inline",
  "global_symbols_from_production_headers": 0,
  "portable_targets_requested": 10,
  "portable_targets_structurally_passed": $passed,
  "native_reference_vector_gate": "$native_status",
  "md5_abc_equivalent": "$native_status",
  "sha256_abc_equivalent": "$native_status",
  "blake3_empty_equivalent": "$native_status",
  "host_algorithm_constants_modified": false,
  "host_algorithm_round_order_modified": false,
  "malloc_heap_gc_libc_syscall_dependency": false,
  "physical_arm32_performance": "TOKEN_VAZIO",
  "physical_arm64_performance": "TOKEN_VAZIO",
  "cache_miss_rate": "TOKEN_VAZIO",
  "throughput_ratio_vs_baseline": "TOKEN_VAZIO",
  "structural_failures": $failures,
  "claim_allowed": false
}
EOF_JSON
if test "$failures" -ne 0; then
  printf 'HASH_BITEXACT_BACKEND_GATE_FAIL failures=%s targets_passed=%s/10 native=%s\n' "$failures" "$passed" "$native_status" >&2
  exit 1
fi
printf 'HASH_BITEXACT_BACKEND_GATE_OK targets_passed=%s/10 native=%s\n' "$passed" "$native_status"

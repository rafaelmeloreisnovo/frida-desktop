#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"; cd "$ROOT"
CORE="android/app/native/hash_bitexact_core.h"
EQ="android/app/native/hash_bitexact_equations.h"
DIG="android/app/native/hash_bitexact_digest.h"
SIMD="android/app/native/hash_bitexact_neon4.h"
PAGE="android/app/native/neon4096_freestanding.h"
TEST=".github/tests/rafaelia/hash_bitexact_streaming_vectors.c"
DIFF=".github/tests/rafaelia/hash_bitexact_differential.py"
OUT="build/hash-bitexact-streaming-neon"
EVIDENCE="evidence/hash-bitexact-streaming-neon"
mkdir -p "$OUT" "$EVIDENCE"
: "${CLANG:=clang}"
for c in "$CLANG" llvm-objdump nm python3 sha256sum; do command -v "$c" >/dev/null || { echo "missing $c" >&2; exit 2; }; done
for f in "$CORE" "$EQ" "$DIG" "$SIMD" "$PAGE" "$TEST" "$DIFF"; do test -f "$f" || { echo "missing $f" >&2; exit 2; }; done
forbidden='(^|[^A-Za-z0-9_])(malloc|calloc|realloc|free|memcpy|memset|memcmp|mmap|open|read|write|close|sysconf|pthread|stdatomic|thread_local|__thread)([^A-Za-z0-9_]|$)'
if grep -Eiq "$forbidden" "$CORE" "$EQ" "$DIG" "$SIMD"; then echo 'hosted dependency token found in production hash core' >&2; exit 1; fi
cat > "$OUT/header_probe.c" <<'C'
#include "hash_bitexact_neon4.h"
C
"$CLANG" -std=c11 -O3 -ffreestanding -fno-builtin -fno-stack-protector -Iandroid/app/native -c "$OUT/header_probe.c" -o "$OUT/header_probe.o"
nm -g --defined-only "$OUT/header_probe.o" > "$EVIDENCE/header-global-symbols.txt"
test ! -s "$EVIDENCE/header-global-symbols.txt"
"$CLANG" -std=c11 -O2 -Iandroid/app/native "$TEST" -o "$OUT/vectors"
"$OUT/vectors"
"$CLANG" -std=c11 -O2 -DRAFAELIA_HASH_NEON4_FULL_UNROLL=1 -Iandroid/app/native "$TEST" -o "$OUT/vectors-full-unroll"
"$OUT/vectors-full-unroll"
python3 "$DIFF" > "$EVIDENCE/differential.txt"
grep -q 'DIFFERENTIAL_PASS algorithms=3 lengths=25 cases=75' "$EVIDENCE/differential.txt"
cat > "$OUT/neon_probe.c" <<'C'
#include "hash_bitexact_neon4.h"
void probe(rafaelia_sha256x4_state*q,const rafaelia_u8*a,const rafaelia_u8*b,const rafaelia_u8*c,const rafaelia_u8*d){rafaelia_sha256x4_compress(q,a,b,c,d);}
C
cat > "$OUT/digest_probe.c" <<'C'
#include "hash_bitexact_digest.h"
void d0(const void*p,rafaelia_u64 n,rafaelia_u8*out){rafaelia_md5_digest(p,n,out);}
void d1(const void*p,rafaelia_u64 n,rafaelia_u8*out){rafaelia_sha256_digest(p,n,out);}
void d2(const void*p,rafaelia_u64 n,rafaelia_u8*out){rafaelia_sha512_digest(p,n,out);}
C
ARM=(--target=armv7a-none-eabi -march=armv7-a -mfpu=neon -mfloat-abi=softfp -std=c11 -O3 -ffreestanding -fno-builtin -fno-stack-protector -fno-unwind-tables -fno-asynchronous-unwind-tables -Iandroid/app/native)
"$CLANG" "${ARM[@]}" -c "$OUT/neon_probe.c" -o "$OUT/neon-baseline.o"
"$CLANG" "${ARM[@]}" -DRAFAELIA_HASH_NEON4_FULL_UNROLL=1 -c "$OUT/neon_probe.c" -o "$OUT/neon-full-unroll.o"
"$CLANG" "${ARM[@]}" -c "$OUT/digest_probe.c" -o "$OUT/digest-armv7.o"
for o in "$OUT/neon-baseline.o" "$OUT/neon-full-unroll.o" "$OUT/digest-armv7.o"; do n="$(basename "$o" .o)"; nm -u "$o" > "$EVIDENCE/$n.undefined.txt"; test ! -s "$EVIDENCE/$n.undefined.txt"; done
llvm-objdump -d "$OUT/neon-baseline.o" > "$EVIDENCE/neon-baseline.disasm.txt"
llvm-objdump -d "$OUT/neon-full-unroll.o" > "$EVIDENCE/neon-full-unroll.disasm.txt"
for op in 'vadd\.i32' 'veor' 'vshr\.u32' 'vshl\.i32' 'vorr'; do grep -Eq "$op" "$EVIDENCE/neon-full-unroll.disasm.txt" || { echo "missing NEON op $op" >&2; exit 1; }; done
BR='\b(bne|beq|bhi|blo|bhs|bls|bgt|blt|bge|ble)\b'
BASE_BRANCHES="$(grep -Eic "$BR" "$EVIDENCE/neon-baseline.disasm.txt" || true)"
FULL_BRANCHES="$(grep -Eic "$BR" "$EVIDENCE/neon-full-unroll.disasm.txt" || true)"
test "$BASE_BRANCHES" -ge 1
test "$FULL_BRANCHES" -eq 0
grep -q 'RAFAELIA_NEON4096_FS_PAGE_BYTES 4096u' "$PAGE"
grep -q 'RAFAELIA_NEON4096_FS_VECTOR_BITS 128u' "$PAGE"
grep -q 'RAFAELIA_NEON4096_FS_U8_LANES 16u' "$PAGE"
grep -q 'RAFAELIA_NEON4096_FS_STREAMS 3u' "$PAGE"
sha256sum "$CORE" "$EQ" "$DIG" "$SIMD" "$TEST" "$DIFF" "$OUT/neon-baseline.o" "$OUT/neon-full-unroll.o" "$OUT/digest-armv7.o" > "$EVIDENCE/SHA256SUMS.txt"
cat > "$EVIDENCE/receipt.json" <<JSON
{
  "schema":"rafaelia.frida.hash-bitexact-streaming-neon.receipt.v1",
  "semantic_role":"same_hash_math_lowered_to_words_and_simd",
  "md5_streaming_equivalence":"PASS",
  "sha256_streaming_equivalence":"PASS",
  "sha512_streaming_equivalence":"PASS",
  "differential_cases":75,
  "production_headers_global_symbols":0,
  "arm32_external_undefined_symbols":0,
  "arm32_neon_sha256_parallel_u32_lanes":4,
  "arm32_neon_transport_parallel_u8_lanes":16,
  "neon_vector_bits":128,
  "page_bytes":4096,
  "vectors_per_page":256,
  "independent_transport_source_streams":3,
  "baseline_conditional_loop_branches":$BASE_BRANCHES,
  "full_unroll_conditional_loop_branches":$FULL_BRANCHES,
  "full_unroll_semantic_equivalence":"PASS",
  "malloc":false,
  "heap":false,
  "gc":false,
  "libc_dependency_in_production_headers":false,
  "syscall_dependency_in_production_headers":false,
  "tail_call_dependency":false,
  "shadow_route_dependency":false,
  "physical_arm32_execution":"TOKEN_VAZIO",
  "cache_miss_rate":"TOKEN_VAZIO",
  "throughput_ratio":"TOKEN_VAZIO",
  "bandwidth_ratio":"TOKEN_VAZIO",
  "three_x_throughput_claim":"TOKEN_VAZIO",
  "eight_core_wall_scaling":"TOKEN_VAZIO",
  "claim_allowed":false
}
JSON
printf 'HASH_BITEXACT_STREAMING_NEON_GATE_OK differential=75 baseline_branches=%s full_unroll_branches=%s\n' "$BASE_BRANCHES" "$FULL_BRANCHES"

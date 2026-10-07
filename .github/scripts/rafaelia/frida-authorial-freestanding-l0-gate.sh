#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BUILD_DIR="build/frida-authorial-freestanding-l0"
EVIDENCE_DIR="evidence/frida-authorial-freestanding-l0"
SRC_H="android/app/native/rafaelia_freestanding_l0.h"
SRC_C="android/app/native/rafaelia_freestanding_l0.c"
TEST_C="android/app/native/rafaelia_freestanding_l0_selftest.c"
rm -rf "$BUILD_DIR" "$EVIDENCE_DIR"
mkdir -p "$BUILD_DIR" "$EVIDENCE_DIR"

for cmd in cc readelf nm grep sha256sum; do
  command -v "$cmd" >/dev/null 2>&1 || exit 2
done

grep -En '#[[:space:]]*include[[:space:]]*<' "$SRC_H" "$SRC_C" && exit 3 || true
FORBIDDEN='(^|[^[:alnum:]_])(malloc|calloc|realloc|free|memcpy|memmove|memset|memcmp|printf|fprintf|puts|pthread_create|pthread_mutex_lock|syscall|dlopen|dlsym|fopen|open|read|write|close|mmap|munmap)[[:space:]]*\('
grep -En "$FORBIDDEN" "$SRC_C" && exit 4 || true

COMMON=(-std=c11 -O2 -Wall -Wextra -Werror -pedantic -ffreestanding -fno-builtin -fno-stack-protector -fno-pic -fno-pie -I android/app/native)
cc "${COMMON[@]}" -c "$SRC_C" -o "$BUILD_DIR/l0.o"
if nm -u "$BUILD_DIR/l0.o" | grep -q .; then nm -u "$BUILD_DIR/l0.o"; exit 5; fi

cc "${COMMON[@]}" -nostdlib -nodefaultlibs -nostartfiles -no-pie -Wl,-e,rafaelia_l0_entry -Wl,--build-id=none -Wl,--no-dynamic-linker "$BUILD_DIR/l0.o" -o "$BUILD_DIR/l0.elf"
readelf -h "$BUILD_DIR/l0.elf" | grep -Eq 'Type:[[:space:]]+EXEC'
if readelf -l "$BUILD_DIR/l0.elf" | grep -q INTERP; then exit 6; fi
if readelf -d "$BUILD_DIR/l0.elf" 2>/dev/null | grep -q NEEDED; then exit 7; fi
if nm -u "$BUILD_DIR/l0.elf" | grep -q .; then nm -u "$BUILD_DIR/l0.elf"; exit 8; fi

cc -std=c11 -O2 -Wall -Wextra -Werror -pedantic -fno-builtin -I android/app/native "$SRC_C" "$TEST_C" -o "$BUILD_DIR/l0-selftest"
"$BUILD_DIR/l0-selftest"

sha256sum "$SRC_H" "$SRC_C" "$TEST_C" "$BUILD_DIR/l0.o" "$BUILD_DIR/l0.elf" "$BUILD_DIR/l0-selftest" > "$EVIDENCE_DIR/SHA256SUMS.txt"
printf '{"schema":"rafaelia.frida.authorial-freestanding-l0.receipt.v1","source_sha":"%s","elf_interpreter":"NONE","elf_needed":"NONE","undefined_symbols":"NONE","semantic_selftest":"PASS","whole_frida_repository_freestanding":"TOKEN_VAZIO","claim_allowed":false}\n' "${RAFAELIA_SOURCE_SHA:-${GITHUB_SHA:-LOCAL}}" | tee "$EVIDENCE_DIR/receipt.json"
echo 'FRIDA_AUTHORIAL_FREESTANDING_L0_OK object=PASS elf=PASS selftest=PASS whole_repo=TOKEN_VAZIO'

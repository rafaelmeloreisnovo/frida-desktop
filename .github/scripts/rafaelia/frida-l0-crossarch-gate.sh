#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

: "${CLANG:=clang}"
for cmd in "$CLANG" readelf nm sha256sum file; do
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "FRIDA_L0_CROSSARCH_FAIL missing_tool=$cmd" >&2
    exit 2
  }
done

resolve_lld() {
  local candidate
  candidate="$("$CLANG" -print-prog-name=ld.lld 2>/dev/null || true)"
  if [ -n "$candidate" ] && [ "$candidate" != "ld.lld" ] && [ -x "$candidate" ]; then
    printf '%s\n' "$candidate"
    return 0
  fi

  if command -v ld.lld >/dev/null 2>&1; then
    command -v ld.lld
    return 0
  fi

  for candidate in /usr/bin/ld.lld-* /usr/local/bin/ld.lld-*; do
    if [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  if command -v rustc >/dev/null 2>&1; then
    local rust_sysroot rust_host
    rust_sysroot="$(rustc --print sysroot)"
    rust_host="$(rustc -vV | sed -n 's/^host: //p')"
    candidate="$rust_sysroot/lib/rustlib/$rust_host/bin/rust-lld"
    if [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  fi

  return 1
}

LLD_BIN="$(resolve_lld || true)"
if [ -z "$LLD_BIN" ]; then
  echo "FRIDA_L0_CROSSARCH_FAIL missing_tool=lld-compatible-linker" >&2
  exit 3
fi

LLD_ARGS=()
case "$(basename "$LLD_BIN")" in
  rust-lld) LLD_ARGS=(-flavor gnu) ;;
esac

SRC_H="android/app/native/rafaelia_freestanding_l0.h"
SRC_C="android/app/native/rafaelia_freestanding_l0.c"
ARMV7_ADAPTER="android/app/native/rafaelia_l0_device_armv7.S"
AARCH64_ADAPTER="android/app/native/rafaelia_l0_device_aarch64.S"
OUT="build/frida-l0-crossarch"
EVIDENCE="evidence/frida-l0-crossarch"
rm -rf "$OUT" "$EVIDENCE"
mkdir -p "$OUT/armv7" "$OUT/aarch64" "$EVIDENCE"

COMMON=(
  -std=c11
  -O2
  -Wall
  -Wextra
  -Werror
  -pedantic
  -ffreestanding
  -fno-builtin
  -fno-stack-protector
  -fno-unwind-tables
  -fno-asynchronous-unwind-tables
  -fno-pic
  -fno-pie
  -I android/app/native
)

build_one() {
  local name="$1"
  local target="$2"
  local march="$3"
  local class_re="$4"
  local machine_re="$5"
  local adapter="$6"
  shift 6
  local extra=("$@")
  local dir="$OUT/$name"
  local obj="$dir/l0.o"
  local core="$dir/l0-core.elf"
  local adapter_obj="$dir/device-adapter.o"
  local probe="$dir/l0-device-probe.elf"

  "$CLANG" --target="$target" -march="$march" "${extra[@]}" "${COMMON[@]}" -c "$SRC_C" -o "$obj"

  if nm -u "$obj" | grep -q .; then
    echo "FRIDA_L0_CROSSARCH_FAIL arch=$name stage=object undefined_symbols=FOUND" >&2
    nm -u "$obj" >&2
    exit 10
  fi

  "$LLD_BIN" "${LLD_ARGS[@]}" -static -e rafaelia_l0_entry --build-id=none "$obj" -o "$core"

  readelf -h "$core" > "$EVIDENCE/$name-core-header.txt"
  readelf -l "$core" > "$EVIDENCE/$name-core-program.txt"
  readelf -d "$core" > "$EVIDENCE/$name-core-dynamic.txt" 2>&1 || true
  nm -u "$core" > "$EVIDENCE/$name-core-undefined.txt"

  grep -Eq "Class:[[:space:]]+$class_re" "$EVIDENCE/$name-core-header.txt"
  grep -Eq "Machine:[[:space:]]+$machine_re" "$EVIDENCE/$name-core-header.txt"
  grep -Eq 'Type:[[:space:]]+EXEC' "$EVIDENCE/$name-core-header.txt"
  ! grep -q 'INTERP' "$EVIDENCE/$name-core-program.txt"
  ! grep -q 'NEEDED' "$EVIDENCE/$name-core-dynamic.txt"
  test ! -s "$EVIDENCE/$name-core-undefined.txt"

  "$CLANG" --target="$target" -march="$march" "${extra[@]}" -ffreestanding -c "$adapter" -o "$adapter_obj"
  if nm -u "$adapter_obj" | grep -Ev '^[[:space:]]+U[[:space:]]+rafaelia_l0_entry$' | grep -q .; then
    echo "FRIDA_L0_CROSSARCH_FAIL arch=$name stage=adapter unexpected_undefined=FOUND" >&2
    nm -u "$adapter_obj" >&2
    exit 11
  fi

  "$LLD_BIN" "${LLD_ARGS[@]}" -static -e _start --build-id=none "$obj" "$adapter_obj" -o "$probe"

  readelf -h "$probe" > "$EVIDENCE/$name-probe-header.txt"
  readelf -l "$probe" > "$EVIDENCE/$name-probe-program.txt"
  readelf -d "$probe" > "$EVIDENCE/$name-probe-dynamic.txt" 2>&1 || true
  nm -u "$probe" > "$EVIDENCE/$name-probe-undefined.txt"

  grep -Eq "Class:[[:space:]]+$class_re" "$EVIDENCE/$name-probe-header.txt"
  grep -Eq "Machine:[[:space:]]+$machine_re" "$EVIDENCE/$name-probe-header.txt"
  grep -Eq 'Type:[[:space:]]+EXEC' "$EVIDENCE/$name-probe-header.txt"
  ! grep -q 'INTERP' "$EVIDENCE/$name-probe-program.txt"
  ! grep -q 'NEEDED' "$EVIDENCE/$name-probe-dynamic.txt"
  test ! -s "$EVIDENCE/$name-probe-undefined.txt"

  file "$core" "$probe" > "$EVIDENCE/$name-file.txt"
}

build_one armv7 armv7a-none-eabi armv7-a ELF32 ARM "$ARMV7_ADAPTER" -mfloat-abi=soft
build_one aarch64 aarch64-none-elf armv8-a ELF64 AArch64 "$AARCH64_ADAPTER"

sha256sum   "$SRC_H"   "$SRC_C"   "$ARMV7_ADAPTER"   "$AARCH64_ADAPTER"   "$OUT/armv7/l0-core.elf"   "$OUT/armv7/l0-device-probe.elf"   "$OUT/aarch64/l0-core.elf"   "$OUT/aarch64/l0-device-probe.elf"   > "$EVIDENCE/SHA256SUMS.txt"

ARMV7_CORE_SHA="$(sha256sum "$OUT/armv7/l0-core.elf")"; ARMV7_CORE_SHA="${ARMV7_CORE_SHA%% *}"
ARMV7_PROBE_SHA="$(sha256sum "$OUT/armv7/l0-device-probe.elf")"; ARMV7_PROBE_SHA="${ARMV7_PROBE_SHA%% *}"
A64_CORE_SHA="$(sha256sum "$OUT/aarch64/l0-core.elf")"; A64_CORE_SHA="${A64_CORE_SHA%% *}"
A64_PROBE_SHA="$(sha256sum "$OUT/aarch64/l0-device-probe.elf")"; A64_PROBE_SHA="${A64_PROBE_SHA%% *}"

cat > "$EVIDENCE/receipt.json" <<EOF
{
  "schema": "rafaelia.frida.l0.crossarch.receipt.v1",
  "source_sha": "${GITHUB_SHA:-LOCAL}",
  "linker": "$(basename "$LLD_BIN")",
  "linker_resolution": "PREINSTALLED_ONLY_NO_PACKAGE_INSTALL",
  "architectures": {
    "armv7": {
      "target": "armv7a-none-eabi",
      "core_elf_sha256": "$ARMV7_CORE_SHA",
      "device_probe_sha256": "$ARMV7_PROBE_SHA",
      "core_interp": "NONE",
      "core_needed": "NONE",
      "core_undefined_symbols": 0,
      "device_probe_interp": "NONE",
      "device_probe_needed": "NONE",
      "device_probe_undefined_symbols": 0
    },
    "aarch64": {
      "target": "aarch64-none-elf",
      "core_elf_sha256": "$A64_CORE_SHA",
      "device_probe_sha256": "$A64_PROBE_SHA",
      "core_interp": "NONE",
      "core_needed": "NONE",
      "core_undefined_symbols": 0,
      "device_probe_interp": "NONE",
      "device_probe_needed": "NONE",
      "device_probe_undefined_symbols": 0
    }
  },
  "l0_core_os_syscalls": "NONE",
  "device_probe_boundary": "RAW_LINUX_EXIT_GROUP_SYSCALL_ADAPTER",
  "physical_armv7_execution": "TOKEN_VAZIO",
  "physical_aarch64_execution": "TOKEN_VAZIO",
  "whole_frida_freestanding": "TOKEN_VAZIO",
  "claim_allowed_crossarch_structure": true,
  "claim_allowed_physical": false
}
EOF

cat "$EVIDENCE/receipt.json"
echo "FRIDA_L0_CROSSARCH_OK armv7=PASS aarch64=PASS physical=TOKEN_VAZIO"

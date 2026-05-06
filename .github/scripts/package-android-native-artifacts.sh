#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <android-arch> <frida-prefix>" >&2
  exit 64
fi

arch="$1"
frida_prefix="$2"
out="frida-android-${arch}"

mkdir -p "$out"
cp -a "$frida_prefix/bin/frida-server" "$out/"
cp -a "$frida_prefix/bin/frida-portal" "$out/"
cp -a "$frida_prefix/bin/frida-inject" "$out/"
if [[ "$arch" == *64* ]]; then
  cp -a "$frida_prefix/lib/frida-1.0/64/frida-gadget.so" "$out/"
else
  cp -a "$frida_prefix/lib/frida-1.0/32/frida-gadget.so" "$out/"
fi

tar -cJf "${out}.tar.xz" "$out"

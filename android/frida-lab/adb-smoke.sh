#!/usr/bin/env bash
set -euo pipefail

APK_DIR="${1:-dist}"
PACKAGE="io.rafaelia.fridalab"
ACTIVITY="${PACKAGE}/.MainActivity"
PORT="${FRIDA_PORT:-27042}"

command -v adb >/dev/null || {
  echo "ERROR: adb not found in PATH" >&2
  exit 64
}

adb get-state >/dev/null

sdk="$(adb shell getprop ro.build.version.sdk | tr -d '\r')"
release="$(adb shell getprop ro.build.version.release | tr -d '\r')"
abi="$(adb shell getprop ro.product.cpu.abi | tr -d '\r')"
abilist="$(adb shell getprop ro.product.cpu.abilist | tr -d '\r')"

case "$abi" in
  arm64-v8a)
    apk="${APK_DIR}/frida-lab-arm64-debug.apk"
    ;;
  armeabi-v7a|armeabi)
    apk="${APK_DIR}/frida-lab-armv7-debug.apk"
    ;;
  *)
    echo "ERROR: unsupported primary ABI: $abi" >&2
    echo "Supported by this lab: armeabi-v7a, arm64-v8a" >&2
    exit 65
    ;;
esac

[[ -f "$apk" ]] || {
  echo "ERROR: APK not found: $apk" >&2
  exit 66
}

echo "Device Android: ${release:-TOKEN_VAZIO} / API ${sdk:-TOKEN_VAZIO}"
echo "Primary ABI: $abi"
echo "ABI list: ${abilist:-TOKEN_VAZIO}"
echo "Installing: $apk"

adb install -r "$apk"
adb forward --remove "tcp:${PORT}" >/dev/null 2>&1 || true
adb forward "tcp:${PORT}" "tcp:${PORT}"
adb shell am force-stop "$PACKAGE" >/dev/null 2>&1 || true
adb shell am start -W -n "$ACTIVITY"

pid="$(adb shell pidof "$PACKAGE" | tr -d '\r' || true)"
echo "PID: ${pid:-TOKEN_VAZIO}"
echo "ADB forward: host 127.0.0.1:${PORT} -> app-local endpoint 127.0.0.1:${PORT}"
echo "Self-process Gadget smoke prepared. System-wide instrumentation is outside this lab APK."

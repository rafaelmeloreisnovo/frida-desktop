#!/usr/bin/env bash
set -euo pipefail

APK_DIR="dist"
VERBOSE=0

while (($#)); do
  case "$1" in
    --verbose|-v)
      VERBOSE=1
      shift
      ;;
    --apk-dir)
      [[ $# -ge 2 ]] || { echo "ERROR: --apk-dir requires a value" >&2; exit 64; }
      APK_DIR="$2"
      shift 2
      ;;
    *)
      if [[ "$APK_DIR" == "dist" && "$1" != -* ]]; then
        APK_DIR="$1"
        shift
      else
        echo "Usage: $0 [--verbose|-v] [--apk-dir DIR|DIR]" >&2
        exit 64
      fi
      ;;
  esac
done

if ((VERBOSE)); then
  set -x
fi

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

if ((VERBOSE)); then
  echo
  echo "--- VERBOSE APP LOGS ---"
  adb logcat -d -s 'RAFAELIA-FridaLab:V' '*:S' || true
  echo
  echo "--- HOST NEXT COMMANDS ---"
  echo "frida-ps -H 127.0.0.1:${PORT}"
  echo "frida -H 127.0.0.1:${PORT} -n Gadget"
fi

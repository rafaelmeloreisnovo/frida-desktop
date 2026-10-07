#!/usr/bin/env bash
set -u

if [ "$#" -ne 4 ]; then
  echo "usage: $0 <probe-elf> <expected-sha256> <source-sha> <armv7|aarch64>" >&2
  exit 64
fi

artifact="$1"
expected_sha="$2"
source_sha="$3"
expected_arch="$4"

for cmd in sha256sum getprop uname date chmod; do
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "DEVICE_RECEIPT_FAIL missing_tool=$cmd" >&2
    exit 65
  }
done

if [ ! -f "$artifact" ]; then
  echo "DEVICE_RECEIPT_FAIL artifact_missing=$artifact" >&2
  exit 66
fi

read -r actual_sha _ < <(sha256sum "$artifact")
if [ "$actual_sha" != "$expected_sha" ]; then
  echo "DEVICE_RECEIPT_FAIL sha256 expected=$expected_sha actual=$actual_sha" >&2
  exit 67
fi

abi="$(getprop ro.product.cpu.abi 2>/dev/null || true)"
model="$(getprop ro.product.model 2>/dev/null || true)"
android_release="$(getprop ro.build.version.release 2>/dev/null || true)"
kernel_arch="$(uname -m 2>/dev/null || true)"

case "$expected_arch" in
  armv7)
    case "$abi:$kernel_arch" in
      armeabi-v7a:*|armeabi:*|*:armv7l|*:armv8l) ;;
      *) echo "DEVICE_RECEIPT_FAIL arch_mismatch expected=armv7 abi=$abi uname=$kernel_arch" >&2; exit 68 ;;
    esac
    ;;
  aarch64)
    case "$abi:$kernel_arch" in
      arm64-v8a:*|*:aarch64|*:arm64) ;;
      *) echo "DEVICE_RECEIPT_FAIL arch_mismatch expected=aarch64 abi=$abi uname=$kernel_arch" >&2; exit 69 ;;
    esac
    ;;
  *)
    echo "DEVICE_RECEIPT_FAIL invalid_expected_arch=$expected_arch" >&2
    exit 70
    ;;
esac

chmod 700 "$artifact" || exit 71
set +e
"$artifact"
run_rc=$?
set -e

escape_json() {
  local v="$1"
  v="${v//\\/\\\\}"
  v="${v//\"/\\\"}"
  printf '%s' "$v"
}

timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
model_json="$(escape_json "$model")"
abi_json="$(escape_json "$abi")"
kernel_json="$(escape_json "$kernel_arch")"
release_json="$(escape_json "$android_release")"

if [ "$run_rc" -eq 0 ]; then
  execution="PASS"
  claim_allowed="true"
else
  execution="FAIL"
  claim_allowed="false"
fi

cat <<EOF
{
  "schema": "rafaelia.frida.l0.physical-device.receipt.v1",
  "timestamp_utc": "$timestamp",
  "source_sha": "$source_sha",
  "artifact_sha256": "$actual_sha",
  "expected_arch": "$expected_arch",
  "device_model": "$model_json",
  "device_abi": "$abi_json",
  "kernel_arch": "$kernel_json",
  "android_release": "$release_json",
  "probe_exit_code": $run_rc,
  "physical_execution": "$execution",
  "boundary": "L0_CORE_PLUS_RAW_EXIT_GROUP_ADAPTER",
  "whole_frida_freestanding": "TOKEN_VAZIO",
  "claim_allowed_physical_probe_only": $claim_allowed
}
EOF

exit "$run_rc"

#!/usr/bin/env bash
# Resolve only the host inspection tools actually missing from the runner.
# This keeps package management as a fallback catalyst instead of an
# unconditional network/update loop on every Android build.

set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=ci-common.sh
source "$SCRIPT_DIR/ci-common.sh"

missing=()

need_pkg() {
  local command_name="$1"
  local package_name="$2"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    missing+=("$package_name")
  fi
}

need_pkg readelf binutils
need_pkg file file
need_pkg curl curl
need_pkg unzip unzip
need_pkg xz xz-utils
need_pkg zip zip
need_pkg sha256sum coreutils

mkdir -p evidence/android17-lab

if ((${#missing[@]} == 0)); then
  printf 'mode=PREINSTALLED\npackages_installed=0\n' \
    | tee evidence/android17-lab/host-tools-resolution.txt
  rafaelia_notice "Host inspection tools already present; apt update/install skipped"
  exit 0
fi

# De-duplicate package names without requiring another helper runtime.
declare -A seen=()
unique=()
for package_name in "${missing[@]}"; do
  if [[ -z "${seen[$package_name]:-}" ]]; then
    seen[$package_name]=1
    unique+=("$package_name")
  fi
done

printf 'mode=APT_FALLBACK\npackages_installed=%d\n' "${#unique[@]}" \
  | tee evidence/android17-lab/host-tools-resolution.txt
printf 'packages=%s\n' "${unique[*]}" \
  | tee -a evidence/android17-lab/host-tools-resolution.txt

rafaelia_need_cmd sudo
sudo apt-get update
sudo apt-get install -y --no-install-recommends "${unique[@]}"

for command_name in readelf file curl unzip xz zip sha256sum; do
  rafaelia_need_cmd "$command_name"
done

rafaelia_notice "Host-tool fallback completed: ${unique[*]}"

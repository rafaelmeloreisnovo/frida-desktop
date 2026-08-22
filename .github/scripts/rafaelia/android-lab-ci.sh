#!/usr/bin/env bash
# RAFAELIA Frida Android Lab build pipeline.
#
# This script is intentionally callable both from GitHub Actions and from a
# compatible Linux workstation. The workflow YAML only orchestrates these
# stages; all fail-closed build and evidence logic lives here.

set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=ci-common.sh
source "$SCRIPT_DIR/ci-common.sh"

ROOT="$(rafaelia_repo_root)"
cd "$ROOT"

TOOLCHAIN_ENV="build/android17/toolchain.env"
EVIDENCE_DIR="evidence/android17-lab"
DIST_DIR="dist/android17-lab"
DOWNLOAD_DIR="build/android17/downloads"
NATIVE_DIR="build/android17/native"
APK_WORK_DIR="build/android17/apk"
DEX_DIR="build/android17/dex"
CLASSES_DIR="build/android17/classes"

require_contract_env() {
  local name
  for name in COMPILE_SDK TARGET_SDK MIN_SDK NDK_VERSION FRIDA_VERSION; do
    rafaelia_assert_clean_value "$name"
  done
}

load_toolchain_env() {
  rafaelia_need_file "$TOOLCHAIN_ENV"
  # File is generated only from validated local paths/version strings.
  # shellcheck disable=SC1090
  source "$TOOLCHAIN_ENV"
  rafaelia_assert_clean_value BT_DIR
  rafaelia_assert_clean_value ANDROID_JAR
  rafaelia_assert_clean_value NDK_DIR
  rafaelia_assert_clean_value TOOLCHAIN
  rafaelia_assert_clean_value RESOLVED_BUILD_TOOLS
  rafaelia_assert_clean_value RESOLVED_PLATFORM_PACKAGE
}

resolve_sdk() {
  require_contract_env
  rafaelia_need_cmd sdkmanager
  rafaelia_need_cmd awk
  rafaelia_need_cmd sort
  rafaelia_assert_clean_value ANDROID_SDK_ROOT

  mkdir -p "$EVIDENCE_DIR" "$(dirname "$TOOLCHAIN_ENV")"
  local sdk_list
  sdk_list="$(mktemp)"

  sdkmanager --list --channel=3 > "$sdk_list"
  cp "$sdk_list" "$EVIDENCE_DIR/sdkmanager-list.txt"

  local bt_pkg platform_pkg bt_version platform_dir bt_dir android_jar ndk_dir toolchain
  bt_pkg="$(
    awk -F'|' -v sdk="$COMPILE_SDK" '
      {
        pkg=$1
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", pkg)
        pattern="^build-tools;" sdk "\\.[0-9]+\\.[0-9]+$"
        if (pkg ~ pattern) print pkg
      }
    ' "$sdk_list" | sort -Vu | tail -n 1
  )"

  platform_pkg="$(
    awk -F'|' -v sdk="$COMPILE_SDK" '
      {
        pkg=$1
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", pkg)
        pattern="^platforms;android-" sdk "(\\.[0-9]+)?$"
        if (pkg ~ pattern) print pkg
      }
    ' "$sdk_list" | sort -Vu | tail -n 1
  )"

  # Android 17/API 37 preview naming compatibility. This fallback is bounded
  # to the declared compile SDK and never silently changes the target API.
  if [[ -z "$platform_pkg" && "$COMPILE_SDK" == "37" ]]; then
    platform_pkg="$(
      awk -F'|' '
        /platforms;android-CinnamonBun([[:space:]]|$)/ {
          gsub(/^[[:space:]]+|[[:space:]]+$/, "", $1)
          print $1
        }
      ' "$sdk_list" | head -n 1
    )"
  fi

  [[ -n "$bt_pkg" ]] || rafaelia_die "stable Build-Tools ${COMPILE_SDK}.x not found"
  [[ -n "$platform_pkg" ]] || rafaelia_die "Android platform for API ${COMPILE_SDK} not found"

  {
    printf 'compile_sdk=%s\n' "$COMPILE_SDK"
    printf 'resolved_platform_package=%s\n' "$platform_pkg"
    printf 'resolved_build_tools_package=%s\n' "$bt_pkg"
    printf 'ndk_version=%s\n' "$NDK_VERSION"
    printf 'frida_version=%s\n' "$FRIDA_VERSION"
  } | tee "$EVIDENCE_DIR/toolchain-resolution.txt"

  yes | sdkmanager --licenses >/dev/null || true
  sdkmanager --channel=3 \
    "$platform_pkg" \
    "$bt_pkg" \
    platform-tools \
    "ndk;${NDK_VERSION}"

  bt_version="${bt_pkg#build-tools;}"
  platform_dir="${platform_pkg#platforms;}"
  bt_dir="${ANDROID_SDK_ROOT}/build-tools/${bt_version}"
  android_jar="${ANDROID_SDK_ROOT}/platforms/${platform_dir}/android.jar"
  ndk_dir="${ANDROID_SDK_ROOT}/ndk/${NDK_VERSION}"
  toolchain="${ndk_dir}/toolchains/llvm/prebuilt/linux-x86_64/bin"

  local tool
  for tool in aapt2 d8 apksigner zipalign; do
    [[ -x "$bt_dir/$tool" ]] || rafaelia_die "missing Android Build-Tools executable: $bt_dir/$tool"
  done
  rafaelia_need_file "$android_jar"
  [[ -x "$toolchain/armv7a-linux-androideabi${MIN_SDK}-clang" ]] || rafaelia_die "missing ARMv7 NDK clang wrapper"
  [[ -x "$toolchain/aarch64-linux-android${MIN_SDK}-clang" ]] || rafaelia_die "missing AArch64 NDK clang wrapper"

  {
    printf 'BT_DIR=%q\n' "$bt_dir"
    printf 'ANDROID_JAR=%q\n' "$android_jar"
    printf 'NDK_DIR=%q\n' "$ndk_dir"
    printf 'TOOLCHAIN=%q\n' "$toolchain"
    printf 'RESOLVED_BUILD_TOOLS=%q\n' "$bt_version"
    printf 'RESOLVED_PLATFORM_PACKAGE=%q\n' "$platform_pkg"
  } > "$TOOLCHAIN_ENV"

  rm -f "$sdk_list"
  rafaelia_notice "Android toolchain resolved fail-closed: ${platform_pkg}, build-tools ${bt_version}, NDK ${NDK_VERSION}"
}

fetch_frida() {
  require_contract_env
  rafaelia_need_cmd curl
  rafaelia_need_cmd python3
  rafaelia_need_cmd xz
  rafaelia_need_cmd sha256sum

  mkdir -p "$DOWNLOAD_DIR" "$NATIVE_DIR/armeabi-v7a" "$NATIVE_DIR/arm64-v8a" "$EVIDENCE_DIR"
  local release_json="$EVIDENCE_DIR/frida-release.json"
  local assets_tsv="$EVIDENCE_DIR/frida-assets.tsv"

  local -a auth_args=()
  if [[ -n "${GH_TOKEN:-}" ]]; then
    auth_args=(-H "Authorization: Bearer ${GH_TOKEN}")
  fi

  curl \
    --proto '=https' \
    --tlsv1.2 \
    --fail \
    --silent \
    --show-error \
    --location \
    --retry 3 \
    --retry-delay 2 \
    -H 'Accept: application/vnd.github+json' \
    -H 'X-GitHub-Api-Version: 2022-11-28' \
    "${auth_args[@]}" \
    "https://api.github.com/repos/frida/frida/releases/tags/${FRIDA_VERSION}" \
    -o "$release_json"

  FRIDA_RELEASE_JSON="$release_json" python3 - <<'PY' > "$assets_tsv"
import json
import os
from pathlib import Path

version = os.environ["FRIDA_VERSION"]
release = json.loads(Path(os.environ["FRIDA_RELEASE_JSON"]).read_text(encoding="utf-8"))
if release.get("tag_name") != version:
    raise SystemExit(f"release tag mismatch: expected {version!r}, got {release.get('tag_name')!r}")

wanted = {
    "armeabi-v7a": f"frida-gadget-{version}-android-arm.so.xz",
    "arm64-v8a": f"frida-gadget-{version}-android-arm64.so.xz",
}
assets = {asset.get("name"): asset for asset in release.get("assets", [])}
for abi, name in wanted.items():
    asset = assets.get(name)
    if asset is None:
        raise SystemExit(f"missing release asset: {name}")
    digest = asset.get("digest") or ""
    if not digest.startswith("sha256:") or len(digest) != 71:
        raise SystemExit(f"missing/invalid SHA-256 release digest for {name}: {digest!r}")
    url = asset.get("browser_download_url") or ""
    prefix = f"https://github.com/frida/frida/releases/download/{version}/"
    if not url.startswith(prefix):
        raise SystemExit(f"unexpected download URL for {name}: {url!r}")
    print("\t".join((abi, name, url, digest)))
PY

  : > "$EVIDENCE_DIR/FRIDA_ASSET_SHA256SUMS.txt"
  local abi name url digest compressed expected actual
  while IFS=$'\t' read -r abi name url digest; do
    [[ -n "$abi" && -n "$name" && -n "$url" && -n "$digest" ]] || rafaelia_die "malformed Frida asset row"
    compressed="$DOWNLOAD_DIR/$name"
    curl \
      --proto '=https' \
      --tlsv1.2 \
      --fail \
      --silent \
      --show-error \
      --location \
      --retry 3 \
      --retry-delay 2 \
      "$url" \
      -o "$compressed"
    expected="${digest#sha256:}"
    actual="$(rafaelia_sha256 "$compressed")"
    [[ "$actual" == "$expected" ]] || rafaelia_die "SHA-256 mismatch for $name: expected=$expected actual=$actual"
    xz -t "$compressed"
    xz -dc "$compressed" > "$NATIVE_DIR/$abi/libfrida-gadget.so"
    printf '%s  %s\n' "$actual" "$name" >> "$EVIDENCE_DIR/FRIDA_ASSET_SHA256SUMS.txt"
  done < "$assets_tsv"
}

build_native() {
  require_contract_env
  load_toolchain_env
  mkdir -p "$NATIVE_DIR/armeabi-v7a" "$NATIVE_DIR/arm64-v8a"
  rafaelia_need_file android/app/native/elf_probe.c

  local common=(
    -std=c11 -O2 -fPIC -fvisibility=hidden -shared
    -Wall -Wextra -Werror
    -Wl,-soname,librafaelia-probe.so
    -Wl,--build-id=sha1
  )

  "$TOOLCHAIN/armv7a-linux-androideabi${MIN_SDK}-clang" \
    "${common[@]}" \
    -Wl,-z,max-page-size=4096 \
    -Wl,-z,common-page-size=4096 \
    -o "$NATIVE_DIR/armeabi-v7a/librafaelia-probe.so" \
    android/app/native/elf_probe.c

  "$TOOLCHAIN/aarch64-linux-android${MIN_SDK}-clang" \
    "${common[@]}" \
    -Wl,-z,max-page-size=16384 \
    -Wl,-z,common-page-size=4096 \
    -o "$NATIVE_DIR/arm64-v8a/librafaelia-probe.so" \
    android/app/native/elf_probe.c
}

verify_native() {
  rafaelia_need_cmd file
  rafaelia_need_cmd readelf
  rafaelia_need_cmd python3
  mkdir -p "$EVIDENCE_DIR"

  local abi name path
  for abi in armeabi-v7a arm64-v8a; do
    for name in libfrida-gadget.so librafaelia-probe.so; do
      path="$NATIVE_DIR/$abi/$name"
      rafaelia_need_file "$path"
      python3 - "$path" <<'PY'
import pathlib
import sys
p = pathlib.Path(sys.argv[1])
magic = p.read_bytes()[:4]
if magic != b"\x7fELF":
    raise SystemExit(f"ELF magic gate failed for {p}: {magic!r}")
print("ELF magic PASS:", p)
PY
      file "$path" | tee "$EVIDENCE_DIR/${abi}-${name}.file.txt"
      readelf -h "$path" | tee "$EVIDENCE_DIR/${abi}-${name}.elf-header.txt"
      readelf -d "$path" > "$EVIDENCE_DIR/${abi}-${name}.elf-dynamic.txt"
      readelf -lW "$path" > "$EVIDENCE_DIR/${abi}-${name}.elf-program-headers.txt"
    done
  done

  readelf -h "$NATIVE_DIR/armeabi-v7a/libfrida-gadget.so" | grep -Eq 'Machine:[[:space:]]+ARM([[:space:]]|$)'
  readelf -h "$NATIVE_DIR/armeabi-v7a/librafaelia-probe.so" | grep -Eq 'Machine:[[:space:]]+ARM([[:space:]]|$)'
  readelf -h "$NATIVE_DIR/arm64-v8a/libfrida-gadget.so" | grep -Eq 'Machine:[[:space:]]+AArch64'
  readelf -h "$NATIVE_DIR/arm64-v8a/librafaelia-probe.so" | grep -Eq 'Machine:[[:space:]]+AArch64'

  readelf -Ws "$NATIVE_DIR/armeabi-v7a/librafaelia-probe.so" | grep -q 'rafaelia_elf_probe_identity'
  readelf -Ws "$NATIVE_DIR/arm64-v8a/librafaelia-probe.so" | grep -q 'rafaelia_elf_probe_identity'

  # Assert the source-built probe alignment contract independently from the
  # logical NEON4096 page contract. Official Gadget assets are inspected but
  # not rewritten to force our linker policy onto upstream binaries.
  python3 - "$NATIVE_DIR/armeabi-v7a/librafaelia-probe.so" 4096 \
             "$NATIVE_DIR/arm64-v8a/librafaelia-probe.so" 16384 <<'PY'
import subprocess
import sys

for i in range(1, len(sys.argv), 2):
    path = sys.argv[i]
    expected = int(sys.argv[i + 1])
    text = subprocess.check_output(["readelf", "-lW", path], text=True)
    aligns = []
    for line in text.splitlines():
        if line.lstrip().startswith("LOAD"):
            token = line.split()[-1]
            aligns.append(int(token, 0))
    if not aligns:
        raise SystemExit(f"no PT_LOAD alignment observed: {path}")
    if max(aligns) > expected:
        raise SystemExit(f"PT_LOAD alignment exceeds contract for {path}: {aligns}, expected <= {expected}")
    print(f"PT_LOAD alignment PASS: {path}: {aligns}; contract <= {expected}")
PY
}

build_dex() {
  require_contract_env
  load_toolchain_env
  rafaelia_need_cmd javac
  rm -rf "$CLASSES_DIR" "$DEX_DIR"
  mkdir -p "$CLASSES_DIR" "$DEX_DIR"

  javac \
    --release 8 \
    -classpath "$ANDROID_JAR" \
    -d "$CLASSES_DIR" \
    android/app/src/io/rafaelia/fridalab/MainActivity.java

  mapfile -t classes < <(find "$CLASSES_DIR" -type f -name '*.class' -print | sort)
  ((${#classes[@]} > 0)) || rafaelia_die "javac produced no .class files"

  "$BT_DIR/d8" \
    --lib "$ANDROID_JAR" \
    --min-api "$MIN_SDK" \
    --output "$DEX_DIR" \
    "${classes[@]}"

  python3 - "$DEX_DIR/classes.dex" <<'PY'
import pathlib
import sys
p = pathlib.Path(sys.argv[1])
magic = p.read_bytes()[:8]
if not magic.startswith(b"dex\n"):
    raise SystemExit(f"DEX magic gate failed: {magic!r}")
print("DEX magic PASS:", magic)
PY
}

package_apks() {
  require_contract_env
  load_toolchain_env
  rafaelia_need_cmd keytool
  rafaelia_need_cmd zip
  rafaelia_need_cmd unzip
  rafaelia_need_file "$DEX_DIR/classes.dex"
  mkdir -p "$DIST_DIR" "$APK_WORK_DIR"

  local keystore="build/android17/debug.keystore"
  rm -f "$keystore"
  keytool -genkeypair \
    -keystore "$keystore" \
    -storepass android \
    -alias androiddebugkey \
    -keypass android \
    -dname 'CN=Android Debug,O=RAFAELIA,C=BR' \
    -keyalg RSA \
    -keysize 2048 \
    -validity 3650 \
    -noprompt

  local gadget_config="build/android17/gadget-config.json"
  cat > "$gadget_config" <<'JSON'
{
  "interaction": {
    "type": "listen",
    "address": "127.0.0.1",
    "port": 27042,
    "on_port_conflict": "fail",
    "on_load": "resume"
  },
  "teardown": "minimal",
  "runtime": "default"
}
JSON

  build_one_apk() {
    local flavor="$1"
    shift
    local work="$APK_WORK_DIR/$flavor"
    rm -rf "$work"
    mkdir -p "$work/stage"

    "$BT_DIR/aapt2" link \
      -o "$work/base.apk" \
      -I "$ANDROID_JAR" \
      --manifest android/app/AndroidManifest.xml \
      --min-sdk-version "$MIN_SDK" \
      --target-sdk-version "$TARGET_SDK" \
      --version-code 1 \
      --version-name "17-api${TARGET_SDK}-${GITHUB_RUN_NUMBER:-local}"

    cp "$work/base.apk" "$work/unsigned.apk"
    (
      cd "$DEX_DIR"
      zip -q "../apk/$flavor/unsigned.apk" classes.dex
    )

    local abi
    for abi in "$@"; do
      mkdir -p "$work/stage/lib/$abi"
      cp "$NATIVE_DIR/$abi/libfrida-gadget.so" "$work/stage/lib/$abi/libfrida-gadget.so"
      cp "$NATIVE_DIR/$abi/librafaelia-probe.so" "$work/stage/lib/$abi/librafaelia-probe.so"
      cp "$gadget_config" "$work/stage/lib/$abi/libfrida-gadget.config.so"
    done
    (
      cd "$work/stage"
      zip -q -r "../unsigned.apk" lib
    )

    "$BT_DIR/zipalign" -p -f 4 "$work/unsigned.apk" "$work/aligned.apk"
    "$BT_DIR/apksigner" sign \
      --ks "$keystore" \
      --ks-pass pass:android \
      --key-pass pass:android \
      --ks-key-alias androiddebugkey \
      --out "$DIST_DIR/frida-lab-${flavor}-debug.apk" \
      "$work/aligned.apk"

    "$BT_DIR/apksigner" verify \
      --verbose \
      --print-certs \
      "$DIST_DIR/frida-lab-${flavor}-debug.apk" \
      | tee "$DIST_DIR/frida-lab-${flavor}.signature.txt"
    "$BT_DIR/zipalign" -c -p 4 "$DIST_DIR/frida-lab-${flavor}-debug.apk"
    unzip -l "$DIST_DIR/frida-lab-${flavor}-debug.apk" \
      | tee "$DIST_DIR/frida-lab-${flavor}.contents.txt"
    unzip -p "$DIST_DIR/frida-lab-${flavor}-debug.apk" classes.dex \
      | python3 -c 'import sys; d=sys.stdin.buffer.read(8); assert d.startswith(b"dex\n"), d; print("APK DEX PASS:", d)'

    for abi in "$@"; do
      unzip -l "$DIST_DIR/frida-lab-${flavor}-debug.apk" | grep -q "lib/$abi/libfrida-gadget.so"
      unzip -l "$DIST_DIR/frida-lab-${flavor}-debug.apk" | grep -q "lib/$abi/libfrida-gadget.config.so"
      unzip -l "$DIST_DIR/frida-lab-${flavor}-debug.apk" | grep -q "lib/$abi/librafaelia-probe.so"
    done
  }

  build_one_apk armv7 armeabi-v7a
  build_one_apk arm64 arm64-v8a
  build_one_apk universal armeabi-v7a arm64-v8a

  cp android/app/adb-smoke.sh "$DIST_DIR/adb-smoke.sh"
}

write_receipt() {
  require_contract_env
  load_toolchain_env
  mkdir -p "$DIST_DIR" "$EVIDENCE_DIR"

  local -a manifest_paths=(
    "$DIST_DIR/frida-lab-armv7-debug.apk"
    "$DIST_DIR/frida-lab-arm64-debug.apk"
    "$DIST_DIR/frida-lab-universal-debug.apk"
    "$NATIVE_DIR/armeabi-v7a/libfrida-gadget.so"
    "$NATIVE_DIR/armeabi-v7a/librafaelia-probe.so"
    "$NATIVE_DIR/arm64-v8a/libfrida-gadget.so"
    "$NATIVE_DIR/arm64-v8a/librafaelia-probe.so"
  )
  rafaelia_write_sha256_manifest "$DIST_DIR/SHA256SUMS.txt" "${manifest_paths[@]}"

  GITHUB_REPOSITORY="${GITHUB_REPOSITORY:-LOCAL}" \
  GITHUB_RUN_ID="${GITHUB_RUN_ID:-0}" \
  GITHUB_SHA="${GITHUB_SHA:-LOCAL}" \
  RESOLVED_BUILD_TOOLS="$RESOLVED_BUILD_TOOLS" \
  RESOLVED_PLATFORM_PACKAGE="$RESOLVED_PLATFORM_PACKAGE" \
  DIST_DIR="$DIST_DIR" \
  NATIVE_DIR="$NATIVE_DIR" \
  python3 - <<'PY'
import hashlib
import json
import os
from pathlib import Path


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def info(path: Path) -> dict:
    return {"bytes": path.stat().st_size, "sha256": sha256(path)}


dist = Path(os.environ["DIST_DIR"])
native_root = Path(os.environ["NATIVE_DIR"])
apk = {p.name: info(p) for p in sorted(dist.glob("*.apk"))}
native = {}
for abi in ("armeabi-v7a", "arm64-v8a"):
    native[abi] = {
        "frida_gadget": info(native_root / abi / "libfrida-gadget.so"),
        "source_built_probe": info(native_root / abi / "librafaelia-probe.so"),
    }

receipt = {
    "schema": "rafaelia.frida.android-apk-lab.receipt.v3",
    "github_repository": os.environ["GITHUB_REPOSITORY"],
    "github_workflow_run_id": int(os.environ["GITHUB_RUN_ID"]),
    "github_sha": os.environ["GITHUB_SHA"],
    "frida_version": os.environ["FRIDA_VERSION"],
    "compile_sdk": int(os.environ["COMPILE_SDK"]),
    "target_sdk": int(os.environ["TARGET_SDK"]),
    "min_sdk": int(os.environ["MIN_SDK"]),
    "android_platform_package": os.environ["RESOLVED_PLATFORM_PACKAGE"],
    "build_tools": os.environ["RESOLVED_BUILD_TOOLS"],
    "ndk_version": os.environ["NDK_VERSION"],
    "abis": ["armeabi-v7a", "arm64-v8a"],
    "build_graph": "C -> NDK clang -> ELF; Java -> javac -> D8 -> DEX; aapt2 -> zipalign -> apksigner -> APK",
    "logical_neon4096_page_bytes": 4096,
    "source_built_elf_linker_page_contract": {
        "armeabi-v7a_max_page_bytes": 4096,
        "arm64-v8a_max_page_bytes": 16384,
    },
    "gates": {
        "frida_release_digest": "PASS",
        "source_built_elf": "PASS",
        "frida_gadget_elf": "PASS",
        "dex": "PASS",
        "apk_signature": "PASS",
    },
    "apk": apk,
    "native_elf": native,
    "apk_signing": "ephemeral-debug-key",
    "physical_device_smoke": "TOKEN_VAZIO",
    "gpu_compute_backend": "TOKEN_VAZIO",
    "scope": "embedded-self-process-lab",
    "claim_allowed": False,
}

out = dist / "receipt.android17-apk-lab.v3.json"
out.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n", encoding="utf-8")
print(out.read_text(encoding="utf-8"))
PY
}

usage() {
  cat <<'EOF'
usage: android-lab-ci.sh <stage>

stages:
  resolve-sdk     Resolve/install SDK, Build-Tools and NDK; freeze local paths.
  fetch-frida     Fetch pinned official Gadget assets and verify release SHA-256.
  build-native    Cross-compile source-built probe for ARMv7 and ARM64.
  verify-native   Verify ELF identity, machine ABI, symbols and page alignment.
  build-dex       Compile Java and produce verified DEX.
  package-apks    Build, align, sign and inspect ARMv7/ARM64/universal APKs.
  receipt         Emit SHA-256 manifest and evidence receipt.
EOF
}

case "${1:-}" in
  resolve-sdk) resolve_sdk ;;
  fetch-frida) fetch_frida ;;
  build-native) build_native ;;
  verify-native) verify_native ;;
  build-dex) build_dex ;;
  package-apks) package_apks ;;
  receipt) write_receipt ;;
  *) usage; exit 64 ;;
esac

#!/usr/bin/env bash
# Hosted Android Gradle Lite build, separate from the standalone Android17 lab.
# Bounded tooling: Java17, SDK34, Gradle8.4 distribution SHA-256 verified.
# Does not assert JNI/probe/Gadget were rebuilt or physically installed.
set -Eeuo pipefail
export LC_ALL=C
umask 077

ROOT="$(cd "$(dirname "\${BASH_SOURCE[0]}")/../../.." && pwd -P)"
: "\${RUNNER_TEMP:?RUNNER_TEMP is required}"
: "\${ANDROID_HOME:?ANDROID_HOME is required}"
: "\${RAFAELIA_SOURCE_SHA:?Source commit required}"
[[ "$RAFAELIA_SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "FAIL: invalid source SHA" >&2; exit 2; }

GVER="8.4"
G_SHA256="3e1af3ae886920c3ac87f7a91f816c0c7c436f276a6eefdb3da152100fef72ae"
G_URL="https://services.gradle.org/distributions/gradle-\${GVER}-bin.zip"
WORK="$(mktemp -d "\${RUNNER_TEMP}/rafaelia-frida-gradle.XXXXXXXX")"
trap 'rm -rf -- "$WORK"' EXIT
ZIP="$WORK/gradle-\${GVER}-bin.zip"

echo "Gradle toolchain: pinned \${GVER}, digest verification required"
curl --fail --location --retry 2 --connect-timeout 15 --max-time 240 \
  --silent --show-error "$G_URL" --output "$ZIP"
printf '%s  %s\n' "$G_SHA256" "$ZIP" | sha256sum --check --status || {
  echo "FAIL: Gradle distribution digest mismatch" >&2
  exit 3
}
unzip -q "$ZIP" -d "$WORK"
test -x "$WORK/gradle-\${GVER}/bin/gradle"

# The standalone lab provisions API 37, not the Gradle host application's
# compileSdk=34 contract. Install only missing hosted platform/tooling.
SDKMANAGER="$(command -v sdkmanager)"
test -x "$SDKMANAGER" || { echo "FAIL: sdkmanager unavailable" >&2; exit 4; }
"$SDKMANAGER" --sdk_root="$ANDROID_HOME" --channel=0 \
  "platforms;android-34" "build-tools;34.0.0" >/dev/null

cd "$ROOT/android"
"$WORK/gradle-\${GVER}/bin/gradle" --version
"$WORK/gradle-\${GVER}/bin/gradle" --no-daemon --max-workers=1 --no-parallel \
  --console=plain :app:assembleDebug

APK="$ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
test -s "$APK" || { echo "FAIL: Gradle hosted APK not produced" >&2; exit 5; }

# Append-only evidence: caller creates a unique per-CI-run output path.
python3 "$ROOT/android/app/validate-lite-profile.py" \
  --artifact-root "$ROOT/android/app/build/outputs/apk/debug" \
  --receipt "$ROOT/evidence/android17-lab/hosted-gradle-shell-footprint.v1.json"
sha256sum "$APK"
echo "PASS_SCOPED: hosted Gradle shell assembled; runtime/gadget/physical gates remain TOKEN_VAZIO"

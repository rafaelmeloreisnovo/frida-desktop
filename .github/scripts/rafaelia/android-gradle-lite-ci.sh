#!/usr/bin/env bash
# Pinned hosted Gradle shell; separate from Android17 ELF/DEX.
# No new GitHub Action catalyst, no promotion from build to physical claim.
set -Eeuo pipefail
IFS=$'\n\t'

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"
: "$ANDROID_SDK_ROOT"
: "$RAFAELIA_SOURCE_SHA"
: "$RUNNER_TEMP"
[[ "$RAFAELIA_SOURCE_SHA" =~ ^[[:xdigit:]]{40}$ ]] || {
  echo "source SHA must have exactly 40 hex characters" >&2; exit 2;
}
for tool in curl unzip sha256sum sdkmanager python3; do
  command -v "$tool" >/dev/null || { echo "missing executable $tool" >&2; exit 2; }
done

readonly VERSION="8.4"
readonly SHA256="3e1af3ae886920c3ac87f7a91f816c0c7c436f276a6eefdb3da152100fef72ae"
readonly URL="https://services.gradle.org/distributions/gradle-8.4-bin.zip"
readonly TOOL_DIR="$RUNNER_TEMP/rafaelia-gradle-lite-$RAFAELIA_SOURCE_SHA"
mkdir -p "$TOOL_DIR" evidence/android17-lab
test ! -e "$TOOL_DIR/gradle-bin.zip" || {
  echo "Gradle ZIP already exists; refusing unchecked reuse" >&2; exit 2;
}
curl --fail --location --show-error --silent --proto '=https' --proto-redir '=https' \
  --tlsv1.2 --retry 3 --connect-timeout 20 --max-time 300 \
  "$URL" -o "$TOOL_DIR/gradle-bin.zip"
printf '%s  %s\n' "$SHA256" "$TOOL_DIR/gradle-bin.zip" | sha256sum -c -
unzip -q "$TOOL_DIR/gradle-bin.zip" -d "$TOOL_DIR"
test -x "$TOOL_DIR/gradle-$VERSION/bin/gradle" || {
  echo "Gradle from verified ZIP was not executable" >&2; exit 2;
}
sdkmanager --channel=0 "platforms;android-34" "build-tools;34.0.0"
(
  cd android
  "$TOOL_DIR/gradle-$VERSION/bin/gradle" \
    --no-daemon --max-workers=1 :app:assembleDebug
)
python3 android/app/validate-lite-profile.py \
  --artifact-root android/app/build/outputs/apk/debug \
  --receipt evidence/android17-lab/hosted-gradle-shell-footprint.v1.json
test -s android/app/build/outputs/apk/debug/app-debug.apk
echo "HOSTED_GRADLE_LITE_BUILD_PASS_SCOPED source=$RAFAELIA_SOURCE_SHA"

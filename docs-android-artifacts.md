# Android artifacts and signing

Frida's Android CI lane builds native artifacts, not APKs.

Targets built per ABI:
- `android-arm` (armeabi-v7a / arm32)
- `android-arm64` (arm64-v8a)
- `android-x86`
- `android-x86_64`

Generated outputs per ABI:
- `frida-server`
- `frida-portal`
- `frida-inject`
- `frida-gadget.so` (`lib/frida-1.0/32` for 32-bit ABIs, `lib/frida-1.0/64` for 64-bit ABIs)
- Devkits (`gum`, `gumjs`, `core`)

Packaging source of truth:
- `.github/scripts/package-android-native-artifacts.sh`
- Called from `.github/workflows/ci.yml` job `frida-android`

## Signed vs unsigned outputs

Unsigned artifacts are always produced and uploaded from `frida-android`:
- `frida-android-package-android-arm`
- `frida-android-package-android-arm64`
- `frida-android-package-android-x86`
- `frida-android-package-android-x86_64`

Signed archives are produced only when both repository secrets are set:
- `ANDROID_ARTIFACT_SIGNING_KEY`
- `ANDROID_ARTIFACT_SIGNING_KEY_ID`

Signing mode:
- Import private key from `ANDROID_ARTIFACT_SIGNING_KEY`.
- Create detached armored signatures (`.asc`) for each `tar.xz` package.
- Upload both package and signature as workflow artifacts.

This preserves the official signed release path and keeps unsigned validation builds available.

## Scope boundary

This repository and workflow do **not** produce APK/AAB artifacts (signed or unsigned). The Android lane is native-tooling output only.

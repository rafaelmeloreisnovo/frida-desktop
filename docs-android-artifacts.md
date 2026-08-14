# Android artifacts and signing

Frida's primary Android CI lane builds native artifacts. A separate development lab workflow can now consume the ARM Gadget outputs and assemble an APK for explicit ELF/DEX validation.

Targets built by the native CI lane per ABI:
- `android-arm` (armeabi-v7a / arm32)
- `android-arm64` (arm64-v8a)
- `android-x86`
- `android-x86_64`

Generated native outputs per ABI include:
- `frida-server`
- `frida-portal`
- `frida-inject`
- `frida-gadget.so` (`lib/frida-1.0/32` for 32-bit ABIs, `lib/frida-1.0/64` for 64-bit ABIs)
- Devkits (`gum`, `gumjs`, `core`)

Packaging source of truth for the native lane:
- `.github/scripts/package-android-native-artifacts.sh`
- Called from `.github/workflows/ci.yml` job `frida-android`

## Native signed vs unsigned outputs

Unsigned native artifacts are produced and uploaded from `frida-android`.

Signed native archives are produced only when both repository secrets are set:
- `ANDROID_ARTIFACT_SIGNING_KEY`
- `ANDROID_ARTIFACT_SIGNING_KEY_ID`

Signing mode:
- Import private key from `ANDROID_ARTIFACT_SIGNING_KEY`.
- Create detached armored signatures (`.asc`) for each `tar.xz` package.
- Upload both package and signature as workflow artifacts.

This preserves the native release path and keeps unsigned validation builds available.

## Android 17 APK ELF/DEX lab

`.github/workflows/android17-apk-elf-dex.yml` is a separate development path. It does not replace the native Frida build.

It consumes only the existing ARM Gadget artifacts:
- `frida-gadget-android-arm`
- `frida-gadget-android-arm64`

It then performs an explicit toolchain:
- prove ARMv7/AArch64 ELF headers;
- compile `MainActivity.java` with `javac`;
- convert classes to `classes.dex` with `d8`;
- assemble APKs with `aapt2`;
- add `libfrida-gadget.so` for `armeabi-v7a` and/or `arm64-v8a`;
- `zipalign` and debug-sign with `apksigner`;
- emit SHA-256 and an evidence receipt.

APK variants:
- ARMv7
- ARM64
- universal ARMv7 + ARM64

SDK policy for the lab:
- compileSdk 37
- targetSdk 37 (Android 17)
- minSdk 21

The APK lane is intentionally scoped to an embedded self-process Gadget development app. It does not bundle `frida-server` or claim that Developer mode grants system-wide instrumentation.

See `docs/android-apk-elf-dex-lab.md` for the ADB/device workflow and evidence boundary.

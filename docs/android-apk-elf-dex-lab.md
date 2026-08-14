# Android 17 APK + ELF/DEX lab

This repository now has two separate Android delivery paths.

1. The existing Frida Android CI lane remains the source of truth for native artifacts.
2. `.github/workflows/android17-apk-elf-dex.yml` consumes the ARM Frida Gadget artifacts and assembles an installable development APK without Gradle.

## Explicit build path

The APK lane is intentionally low-level and inspectable:

`Java source -> javac -> .class -> d8 -> classes.dex -> aapt2 -> APK -> zipalign -> apksigner`

The native side is verified independently:

`Frida CI artifact -> ELF magic -> readelf machine gate -> lib/<ABI>/libfrida-gadget.so`

Supported APK ABIs:

- `armeabi-v7a` (ARMv7 / 32-bit)
- `arm64-v8a` (AArch64 / 64-bit)

Android SDK policy:

- `compileSdk = 37`
- `targetSdk = 37` (Android 17)
- `minSdk = 21`
- Build-Tools: latest `37.x` visible to `sdkmanager` at build time

## Outputs

The workflow produces:

- `frida-lab-armv7-debug.apk`
- `frida-lab-arm64-debug.apk`
- `frida-lab-universal-debug.apk`
- ARMv7 and ARM64 `libfrida-gadget.so` evidence inputs
- ELF header evidence
- APK content listings
- `SHA256SUMS.txt`
- `receipt.android17-apk-lab.v1.json`
- `adb-smoke.sh`

The APK is signed with an ephemeral debug key generated during CI. It is a development/test artifact, not a release-signing path.

## Developer mode / ADB

On the Android device:

1. Enable Developer options.
2. Enable USB debugging, or Wireless debugging where supported.
3. Authorize the host when Android shows the ADB fingerprint prompt.

With the workflow artifact extracted on the host:

```bash
chmod +x dist/adb-smoke.sh
./dist/adb-smoke.sh dist
```

The script detects the device API and primary ABI, chooses the ARMv7 or ARM64 APK, installs it, starts `io.rafaelia.fridalab/.MainActivity`, and forwards TCP 27042 through ADB.

The embedded Frida Gadget is configured for localhost port 27042 with `on_load = resume`. The Activity makes the boundary explicit:

`classes.dex -> MainActivity -> System.loadLibrary("frida-gadget") -> ELF`

## Scope boundary

Developer mode / ADB does not itself grant system-wide process instrumentation privileges.

This lab embeds Frida Gadget inside its own debuggable application process. That path can be installed and exercised without root because the native library belongs to the app being tested. System-wide `frida-server` operation is a separate mode and is not bundled into this APK workflow.

## Evidence policy

The CI receipt records the DEX gate, ELF gate, APK SHA-256, Gadget SHA-256, source CI run, workflow run, commit, SDK and Build-Tools values.

A GitHub-hosted runner cannot prove a physical-device install/launch by itself. Until a real Android device executes the ADB smoke path, the receipt keeps:

- `physical_device_smoke = TOKEN_VAZIO`
- `claim_allowed = false`

This prevents a cloud build from being mislabeled as a physical Android validation.

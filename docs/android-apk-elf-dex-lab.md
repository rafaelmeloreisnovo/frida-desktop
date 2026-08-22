# Android 17 APK + ELF/DEX lab

This repository has two independent Android paths:

1. The existing Frida Android CI lane builds the repository's native Frida targets.
2. `.github/workflows/android17-apk-elf-dex.yml` is a standalone development lab for an installable self-process APK. It does not depend on the monolithic native CI producing artifacts first.

## Explicit build graph

The lab deliberately avoids Gradle so every binary transition remains visible.

Source-built native path:

`elf_probe.c -> Android NDK clang -> ARMv7 ELF + AArch64 ELF -> readelf/file gates`

Managed-code path:

`MainActivity.java -> javac -> .class -> d8 -> classes.dex`

APK path:

`AndroidManifest.xml + classes.dex + ELF libraries -> aapt2/zip -> zipalign -> apksigner -> APK`

Frida Gadget provenance path:

`pinned Frida release metadata -> exact asset name -> release SHA-256 digest -> HTTPS download -> SHA-256 comparison -> xz validation -> ELF validation`

The pinned development input is Frida `17.9.11`. The workflow refuses to continue if either required release asset is absent, if its release metadata lacks a valid `sha256:` digest, if the download URL is outside the expected Frida release path, or if the downloaded bytes do not match that digest.

## ABI and SDK contract

Supported APK ABIs:

- `armeabi-v7a` — ARMv7 / 32-bit
- `arm64-v8a` — AArch64 / 64-bit

Android toolchain policy:

- `compileSdk = 37`
- `targetSdk = 37` — Android 17
- `minSdk = 21`
- NDK `29.0.14206865`
- latest Build-Tools `37.x` visible to `sdkmanager` at build time

The universal APK contains both ARM ABIs. It does not make a 32-bit ABI executable on a 64-bit-only device: Android still chooses only an ABI supported by the physical device. Use the ARM64 APK on ARM64-only devices.

## Native ELF gates

For each ABI, the workflow carries two independent ELF objects:

- `librafaelia-probe.so`: compiled in the workflow from `android/app/native/elf_probe.c` with the corresponding NDK clang wrapper;
- `libfrida-gadget.so`: retrieved from the pinned official Frida release and checked against its release digest.

The gate checks ELF magic and machine type with `readelf`:

- ARMv7 must report `Machine: ARM`;
- ARM64 must report `Machine: AArch64`.

The source-built probe must also expose `rafaelia_elf_probe_identity` in its symbol table. Header, dynamic-section and `file` evidence are preserved in the workflow artifact.

## DEX gate

`MainActivity.java` is compiled directly by `javac`. `d8` converts the resulting `.class` files to `classes.dex`. The workflow checks DEX magic before packaging and checks the DEX again after extracting it from each signed APK.

At runtime the Activity makes both native loads explicit:

`classes.dex -> MainActivity -> System.loadLibrary("rafaelia-probe") -> source-built ELF`

`classes.dex -> MainActivity -> System.loadLibrary("frida-gadget") -> Frida Gadget ELF`

## APK outputs

The workflow produces:

- `frida-lab-armv7-debug.apk`
- `frida-lab-arm64-debug.apk`
- `frida-lab-universal-debug.apk`
- ARMv7 and ARM64 source-built probe ELFs
- ARMv7 and ARM64 Frida Gadget ELFs
- ELF header/dynamic-section evidence
- APK content and signature evidence
- `SHA256SUMS.txt`
- `receipt.android17-apk-lab.v2.json`
- `adb-smoke.sh`

Each APK is aligned with `zipalign`, signed with an ephemeral CI debug key, and verified with `apksigner`. This is a development/test signing path, not a production release key.

## Developer options and ADB

On the Android device:

1. Enable Developer options.
2. Enable USB debugging, or Wireless debugging where supported.
3. Authorize the host when Android presents the ADB fingerprint prompt.

With the workflow artifact extracted on the host:

```bash
chmod +x dist/adb-smoke.sh
./dist/adb-smoke.sh dist
```

The script reads the physical device API and primary ABI, selects the ARMv7 or ARM64 APK, installs it with ADB, launches `io.rafaelia.fridalab/.MainActivity`, obtains its PID, and creates a host-to-device TCP forward for port `27042`.

The embedded Gadget is configured to listen only on device localhost `127.0.0.1:27042` with `on_load = resume`.

## Scope boundary

Developer options and ADB do not grant root or system-wide process instrumentation privileges.

This lab embeds Frida Gadget only inside its own debuggable application process. It does not package or deploy `frida-server`, does not alter other applications, and does not represent ADB access as system privilege.

## Evidence policy

The V2 receipt records:

- repository, workflow run and commit identity;
- Frida version;
- SDK, Build-Tools and NDK versions;
- ARMv7/ARM64 native ELF hashes;
- three APK hashes;
- release-digest gate;
- source-built ELF gate;
- Frida Gadget ELF gate;
- DEX gate;
- APK signature gate.

A GitHub-hosted runner cannot prove a physical-device installation and launch. Until `adb-smoke.sh` is run against a real Android device, the receipt deliberately keeps:

- `physical_device_smoke = TOKEN_VAZIO`
- `claim_allowed = false`

Cloud compilation is therefore not mislabeled as physical Android validation.

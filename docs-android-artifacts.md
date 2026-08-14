# Android artifacts and signing

Frida's primary Android CI lane builds the repository's native Frida targets. The Android 17 APK ELF/DEX lab is a separate standalone development path and does not require that monolithic CI lane to produce artifacts first.

Targets described by the native CI lane include:
- `android-arm` (`armeabi-v7a` / ARM32)
- `android-arm64` (`arm64-v8a`)
- `android-x86`
- `android-x86_64`

Native packaging source of truth remains:
- `.github/scripts/package-android-native-artifacts.sh`
- `.github/workflows/ci.yml` job `frida-android`

## Native signed vs unsigned outputs

The existing native lane may produce unsigned native artifacts and can sign native archives when its configured signing secrets are available. That mechanism is independent of APK signing in the development lab.

## Android 17 standalone APK ELF/DEX lab

`.github/workflows/android17-apk-elf-dex.yml` performs its own explicit ARM development chain.

Native source proof:
- installs Android NDK `29.0.14206865`;
- compiles `android/frida-lab/native/elf_probe.c` with the ARMv7 NDK clang wrapper;
- compiles the same source with the AArch64 NDK clang wrapper;
- checks ELF magic, machine type and the exported probe symbol.

Pinned Frida Gadget proof:
- uses Frida `17.9.11` as an explicit input;
- resolves the exact `android-arm` and `android-arm64` Gadget release assets from official Frida release metadata;
- requires a `sha256:` release digest;
- verifies the downloaded compressed bytes against that digest before decompression;
- checks each resulting Gadget as an ELF for the expected architecture.

DEX/APK proof:
- compiles `MainActivity.java` with `javac`;
- converts `.class` to `classes.dex` with `d8`;
- assembles the package with `aapt2` and `zip`;
- embeds both the source-built probe ELF and Frida Gadget ELF for each selected ABI;
- aligns with `zipalign`;
- signs with an ephemeral debug key using `apksigner`;
- verifies signature, alignment, DEX magic and expected native-library entries;
- emits SHA-256 values and a V2 evidence receipt.

APK variants:
- ARMv7 (`armeabi-v7a`)
- ARM64 (`arm64-v8a`)
- universal ARMv7 + ARM64

SDK policy:
- compileSdk 37
- targetSdk 37 (Android 17)
- minSdk 21
- Build-Tools latest `37.x` visible to `sdkmanager`

The universal APK does not override a device's ABI support. A 64-bit-only Android device uses the ARM64 code path; the ARMv7 APK requires a device/runtime that still supports the 32-bit ARM ABI.

## Scope and evidence boundary

The APK lane embeds Frida Gadget only in its own debuggable laboratory application process. It does not bundle or deploy `frida-server` and does not treat Developer options or ADB as root/system-wide privilege.

The workflow can prove cloud-side build, ELF, DEX, alignment and APK-signature gates. Physical installation and launch remain `TOKEN_VAZIO` until `android/frida-lab/adb-smoke.sh` is executed against an actual Android device.

See `docs/android-apk-elf-dex-lab.md` for the complete raw toolchain, ADB workflow and receipt contract.

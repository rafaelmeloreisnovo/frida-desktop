# Android artifacts and signing

Frida's Android CI lane builds native artifacts, not APKs.

Targets built per ABI:
- `android-arm` (armeabi-v7a equivalent)
- `android-arm64` (arm64-v8a equivalent)
- `android-x86`
- `android-x86_64`

Generated outputs:
- `frida-server`
- `frida-portal`
- `frida-inject`
- `frida-gadget.so`
- Devkits (`gum`, `gumjs`, `core`)

## Signed vs unsigned outputs

- Unsigned artifacts are always uploaded from `frida-android`.
- Signed archives are produced only when these repository secrets exist:
  - `ANDROID_ARTIFACT_SIGNING_KEY`
  - `ANDROID_ARTIFACT_SIGNING_KEY_ID`

Signing mode:
- Import private key from `ANDROID_ARTIFACT_SIGNING_KEY`.
- Create detached armored signatures (`.asc`) for each `tar.xz` package.
- Upload both package and signature as workflow artifacts.

This preserves an official signed release path without weakening unsigned validation builds.

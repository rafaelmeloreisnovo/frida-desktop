# Frida Desktop Android Build Guide — Current Contracts

**Snapshot date:** 2026-09-28  
**Authority:** repository source/manifests on the exact Git ref under test  
**Scope:** Android build routing and evidence boundaries  
**Claim gate:** `claim_allowed=false` for physical/runtime claims unless a physical receipt closes the gate

This repository has **two different Android build paths**. They solve different
problems and must not be described as one configuration.

```text
A. Hosted Gradle app
   android/app/build.gradle
   -> Android application packaging / hosted UI

B. Standalone APK/ELF/DEX evidence lab
   .github/workflows/android17-apk-elf-dex.yml
   -> explicit javac/d8/NDK/aapt2/zipalign/apksigner graph
```

## 1. Hosted Gradle application

Current `android/app/build.gradle` declares:

```text
applicationId = io.rafaelia.fridalab
compileSdk    = 34
minSdk        = 29
targetSdk     = 34
Java          = 11
ABIs          = armeabi-v7a, arm64-v8a
```

The module also declares:

```text
java.srcDirs    = ['src']
res.srcDirs     = ['res']
assets.srcDirs  = ['assets']
jniLibs.srcDirs = ['libs']
```

Important boundary: there is currently no `externalNativeBuild` block in the
Gradle module. Therefore:

```text
:app:assembleDebug PASS
!= proof that the current C sources were compiled into the APK
```

The Gradle path consumes native libraries from the declared JNI-libs surface
when those artifacts are present.

### Hosted dependencies

The Gradle application is explicitly hosted and currently depends on AndroidX,
Material, Gson and OkHttp, plus Android/JUnit/Espresso test dependencies.

That surface is **not** the freestanding RAFAELIA core proof.

## 2. SDK configuration drift

`android/app/AndroidManifest.xml` still contains legacy values:

```xml
<uses-sdk
    android:minSdkVersion="21"
    android:targetSdkVersion="37" />
```

Those values differ from the Gradle `defaultConfig` (29/34).

This documentation classifies the discrepancy as:

```text
ANDROID_MANIFEST_GRADLE_SDK_DRIFT = OPEN
```

For the hosted Gradle contract, use `android/app/build.gradle` as the declared
build configuration. Do not collapse the legacy manifest values and the
standalone Android-17 workflow into one SDK claim.

## 3. Standalone Android 17 APK / ELF / DEX lab

The evidence-oriented standalone route is:

`.github/workflows/android17-apk-elf-dex.yml`

It deliberately keeps binary transitions explicit instead of relying on the
Gradle application build.

### Build graph

```text
elf_probe.c
  -> Android NDK clang
  -> ARMv7/AArch64 ELF

MainActivity.java
  -> javac
  -> .class
  -> d8
  -> classes.dex

AndroidManifest.xml + classes.dex + native ELFs
  -> aapt2 / zip
  -> zipalign
  -> apksigner
  -> APK
```

The workflow uses a separate Android 17/API 37 policy and currently pins Frida
Gadget provenance independently. See
`../docs/android-apk-elf-dex-lab.md` for the exact version/toolchain contract.

This path is the correct place to reason about:

- DEX identity;
- source-built probe ELF identity;
- Frida Gadget asset provenance;
- ABI-specific and universal APK identity;
- APK signing/alignment evidence;
- SHA-256 artifact manifests.

## 4. Current native runtime source

The Android lab native surface includes:

```text
android/app/native/
  elf_probe.c
  learning_runtime.[ch]
  learning_store.[ch]
  learning_runtime_selftest.c
  learning_store_selftest.c
  neon4096_core.[ch]
  neon4096_armv7.S
  neon4096_freestanding.h
  hash-math / bit-exact sidecar sources
```

Current responsibilities are intentionally separated semantically even where the
hosted bridge still composes sources:

- `learning_store`: RFL V1 persistence, predictor table, record replay, CRC;
- `learning_runtime`: logical mode/validation adapter;
- `neon4096_core`: hosted 4096-byte page contract and scalar/NEON route;
- strict freestanding sidecars: separate structural proof surfaces;
- `elf_probe`: Android/JNI hosted bridge.

`HOSTED_ANDROID` and `FREESTANDING_CORE` are different evidence scopes.

## 5. Current learning modes

The operator/runtime logical modes are:

```text
OFF
OBSERVE
LEARN_SHADOW
PREDICT_SHADOW
VALIDATE_SHADOW
FROZEN
```

`VALIDATE_SHADOW` maps the underlying store to a frozen model while preserving
a distinct logical validation state. Automatic `ACTIVE` policy remains
disabled.

## 6. Building the hosted Gradle shell

Prerequisites depend on the environment, but the repository contract requires a
JDK compatible with Java 11 source/target and Android SDK components sufficient
for API 34.

From `android/`, with a compatible Gradle installation:

```sh
gradle :app:assembleDebug
```

If a Gradle wrapper is added/present on the ref under test, the equivalent is:

```sh
./gradlew :app:assembleDebug
```

Do not document the wrapper as guaranteed unless the exact ref contains it.

Expected Gradle output location:

```text
android/app/build/outputs/apk/debug/
```

Again, this package build alone does not prove the native C source was rebuilt
because the current module uses `jniLibs` rather than an
`externalNativeBuild` declaration.

## 7. Building the evidence lab

For reproducible native/APK evidence, prefer the repository workflow contract
rather than inventing a local build graph:

```text
.github/workflows/android17-apk-elf-dex.yml
.github/workflows/android17-rfl-selftest.yml
```

Related structural gates include:

```text
.github/workflows/arm32-neon4096-freestanding.yml
.github/workflows/hash-math-plugin-freestanding.yml
.github/workflows/hash-bitexact-backend.yml
.github/workflows/hash-bitexact-streaming-neon.yml
```

Hosted CI evidence is ref-scoped. A green workflow is not a physical-device
receipt.

## 8. Physical on-device verifier

The current local physical verifier is:

```sh
bash android/app/on-device-smoke.sh
```

Preconditions:

- run from a repository checkout when source binding is required;
- tracked source tree must be clean for a PASS;
- Frida CLI and Python bindings must be available in the execution environment;
- the Gadget endpoint must be local/loopback;
- the lab process/Gadget must be reachable.

The verifier does not inject a training observation.

Its append-only receipt currently verifies:

- source commit is available;
- tracked source is clean;
- verifier script SHA-256;
- Android identity surface;
- Gadget enumeration + Frida attach;
- Java + `MainActivity` resolution;
- raw learning snapshot;
- evidence-normalized snapshot;
- zero-sample `TOKEN_VAZIO` semantics;
- NEON4096 page geometry;
- SIMD fold self-test;
- automatic ACTIVE disabled;
- GPU backend unpromoted;
- validation persistence explicit as `TOKEN_VAZIO`.

Default receipt directory:

```text
$HOME/.local/state/rafaelia/frida-lab/receipts/
```

Each receipt gets a sibling SHA-256 file and is created append-only.

## 9. What a physical PASS still does not prove

The current on-device receipt does not yet bind all installed bytes to the same
source ref.

Until extended, preserve:

```text
INSTALLED_APK_SHA256       = TOKEN_VAZIO
PROBE_ELF_SHA256           = TOKEN_VAZIO
GADGET_ELF_SHA256          = TOKEN_VAZIO
APK_TO_SOURCE_EXACT_BIND   = TOKEN_VAZIO
SHAREDMEMORY_RESTART       = TOKEN_VAZIO
FRIDA_REATTACH_RESTORE     = TOKEN_VAZIO
GPU_COMPUTE                = TOKEN_VAZIO
VALIDATION_PERSISTENCE     = TOKEN_VAZIO
CAUSAL_RUNTIME_CLAIM       = TOKEN_VAZIO
```

## 10. Failure interpretation

Use these distinctions:

```text
build configuration exists != build executed
build PASS                != artifact identity bound
artifact identity bound   != install/launch PASS
attach PASS                != learning accuracy evidence
zero samples               != zero error
hosted CI PASS             != physical Android PASS
physical observation       != causal proof
```

## 11. Documentation routing

- current global state: `../IMPLEMENTATION_SUMMARY.md`
- one-screen runtime: `app/ONE_SCREEN_OPERATOR_V1.md`
- learning architecture: `app/LEARNING_ARCHITECTURE_V1.md`
- standalone APK/ELF/DEX: `../docs/android-apk-elf-dex-lab.md`
- ARM32 freestanding: `../docs/arm32-neon4096-freestanding.md`
- physical NEON benchmark contract: `../docs/arm32-neon4096-physical-benchmark.md`

## 12. R3

```text
F_ok:
  build routes are now separated;
  current Gradle values and current native/runtime topology are documented;
  on-device verifier semantics match the current code.

F_gap:
  manifest-vs-Gradle SDK drift remains explicit;
  installed APK/probe/Gadget byte binding remains open.

F_next:
  bind APK + probe ELF + Gadget ELF hashes to source_commit in the physical
  append-only receipt, then execute that exact artifact on the authorized
  ARM32 target.

claim_allowed=false
```

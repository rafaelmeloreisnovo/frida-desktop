# RAFAELIA Frida — Current Implementation Summary

**Snapshot date:** 2026-09-28  
**Source authority:** `rafaelmeloreisnovo/frida-desktop`  
**Base observed before this documentation refactor:** `main@a941926b7e8ee3eb67d14dde3e1e9215e1b2bef4`  
**State:** `IMPLEMENTED_MULTI_LAYER / HOSTED_CI_VERIFIED_SCOPED / PHYSICAL_EVIDENCE_PARTIAL`  
**Global claim gate:** `claim_allowed=false`

> This file supersedes the 2026-08-22 “Phase 1 complete / ready for Phase 2”
> description. Historical plans remain useful as provenance, but source code and
> exact-ref evidence govern current implementation status.

## 1. Authority and evidence model

The repository is evaluated with the following invariant:

```text
SOURCE != ARTIFACT != EXECUTION != EVIDENCE != CLAIM
TOKEN_VAZIO != 0 != FAIL != PASS
IMPLEMENTED_UNTESTED != PASS
HOSTED_CI_PASS != PHYSICAL_DEVICE_PASS
```

Documentation describes the code; it does not promote the code. A physical or
causal claim requires evidence from the corresponding execution boundary.

## 2. What exists in the current source

### Android self-process lab

The hosted Android application is `io.rafaelia.fridalab`.

The normal operator path is:

```text
MainActivity / DEX
        -> JNI
        -> source-built native ELF
        -> RFL learning runtime
        -> NEON4096
```

Frida Gadget is an instrumentation boundary reachable at the declared local
endpoint `127.0.0.1:27042`. It is not the authority for learning state.

The one-screen operator currently exposes:

- local diagnostic receipt `RAFAELIA_FRIDA_LAB_RECEIPT_V1`;
- receipt schema 1.1 evidence semantics;
- raw read-only learning snapshot;
- evidence-normalized read-only snapshot;
- explicit learning initialization disposition;
- explicit `filesystem_write_claim=TOKEN_VAZIO`;
- automatic ACTIVE policy disabled;
- passive detailed runtime dump contract reference
  `rafaelia.android.runtime-stability/v2`.

See `android/app/ONE_SCREEN_OPERATOR_V1.md`.

### RFL learning runtime

The native runtime is no longer a stub. The current logical modes are:

```text
OFF
OBSERVE
LEARN_SHADOW
PREDICT_SHADOW
VALIDATE_SHADOW
FROZEN
```

`VALIDATE_SHADOW` intentionally freezes the low-level mutable model while the
runtime preserves a distinct logical validation mode. Automatic policy
activation is not implemented.

RFL V1 currently defines:

- 64-byte fixed header;
- 64-byte fixed record;
- 4096-byte slab = 64 records;
- 256 predictor sets x 4 ways = 1024 entries;
- CRC32C-protected header/records;
- append/replay and partial/corrupt-tail recovery semantics;
- bounded latency samples and evidence-aware snapshot projection.

A zero observation/prediction count does not prove zero error or zero overhead.
The operator/evidence projection reports undefined zero-denominator metrics as
`TOKEN_VAZIO / NO_SAMPLES`.

### NEON4096/3

The current hosted page contract is:

```text
4096 B page
= 64 B control
+ 1344 B HOT
+ 1344 B BUFFER
+ 1344 B STORAGE
```

Equivalent structural views include:

- 64 x 64-byte cache lines;
- 256 x 128-bit vectors;
- 8 x 512-byte microblocks;
- 21 cache lines per 1344-byte region;
- 84 128-bit vectors per region.

The runtime can select `NEON128 / CPU_NEON` on supported ARM execution and has
a seal/verify/corruption self-test. No GPU compute backend is promoted.

Separate strict freestanding ARM32/portable sidecar contracts exist in
`docs/arm32-neon4096-freestanding.md` and related workflows. Those structural
proofs are distinct from the hosted Android runtime.

### On-device evidence verifier

`android/app/on-device-smoke.sh` is an append-only physical-device verifier,
not a second application UI.

Its current receipt binds, when available:

- repository commit;
- tracked-tree clean state;
- SHA-256 of the verifier script;
- Android release/SDK/ABI/model/fingerprint;
- local Gadget enumeration;
- Frida attach;
- Java availability and `MainActivity` resolution;
- raw learning snapshot;
- evidence-normalized learning snapshot;
- zero-sample `TOKEN_VAZIO` semantics;
- 4096-byte NEON page observation;
- SIMD fold self-test;
- automatic ACTIVE disabled;
- GPU and validation-persistence non-promotion.

It deliberately does **not** inject a training observation.

The remaining custody gap is that the device receipt does not yet bind the
installed APK, source-built probe ELF and Frida Gadget ELF by byte hash to the
same exact source ref.

### Runtime stability / debugger layer

The repository also contains a separate passive stability/observability family:

- Runtime Stability Dump V2;
- robust repeated-measure baseline;
- evidence ladder from observation through causal-support structure;
- privacy-bounded module/runtime surfaces;
- HyperMemory causal-tail bridge;
- crash/ANR/process-death metadata observers;
- explicit observer-effect and visibility boundaries.

These facilities do not convert drift into instability or association into
causality.

### Runtime uncertainty / automatic mutation boundary

The current uncertainty contract enforces:

- heuristic observations are `OBSERVATION_ONLY`;
- observation-only patterns cannot authorize AutoFixer;
- worsening success/rollback evidence may tighten automatic thresholds;
- strong outcomes do not automatically relax those thresholds;
- evidence-facing integrity verification uses SHA-256;
- fast non-cryptographic routing hashes remain a separate semantic class.

See `docs/runtime-uncertainty-family-v1.md`.

## 3. Hosted CI evidence currently bound

The current `main` is merge commit
`a941926b7e8ee3eb67d14dde3e1e9215e1b2bef4` from PR #74.

For PR #74 exact head
`1660af1ea1943f24d5b0c1e2084725c4af9b2a0a`, the following observed runs
completed successfully:

| Gate | Run | State |
|---|---:|---|
| 0000 · OMEGA Integrator | 36286029935 | PASS |
| RAFAELIA Provenance Non-Regression Gate | 36286029690 | PASS |
| Workflow Architecture Contract | 36286029718 | PASS |
| Android 17 APK + ELF/DEX Lab | 36286029667 | PASS |

PR #74 is the current successor for Android/RFL re-entry. It keeps native init
fail-closed and accepts Activity recreation only when exact `ERR_STATE=-5`
coexists with a successful read-only native snapshot. The receipt records
`learning_init_disposition`, and the Detailed Runtime Dump V2 remains
`OBSERVATION_ONLY` with physical capture separately gated.

PR #73 is the receipt-V1.1 predecessor. Its evidence established the
zero-denominator/TOKEN_VAZIO projection and produced exact-head Android
APK/ELF/DEX build artifacts, but the current physical receipt still does not
prove that the installed APK/probe/Gadget bytes are exactly those artifacts.

These are scoped implementation/build facts. Hosted CI does not by itself prove
physical execution, restart/reattach, performance, persistence or causality.

## 4. Android build paths — do not conflate them

There are two distinct Android build contracts.

### Hosted Gradle application contract

`android/app/build.gradle` declares:

- `compileSdk 34`;
- `minSdk 29`;
- `targetSdk 34`;
- Java 11;
- ABI filters `armeabi-v7a` and `arm64-v8a`.

The Gradle module declares `jniLibs.srcDirs = ['libs']`; it does not currently
declare an `externalNativeBuild` block. Native artifact production therefore
must not be assumed from `:app:assembleDebug` alone.

### Standalone Android 17 APK/ELF/DEX lab

`.github/workflows/android17-apk-elf-dex.yml` is a different, explicit build
graph. It compiles/package-checks DEX and ELF directly, uses Android 17/API 37
tooling policy, produces ABI-specific/universal APK artifacts, and pins Frida
Gadget provenance separately.

See `docs/android-apk-elf-dex-lab.md`.

The manifest still contains legacy `<uses-sdk>` values that differ from the
Gradle `defaultConfig`. That is tracked as configuration drift and must not be
silently treated as one unified SDK contract.

## 5. Hosted auxiliary layers

The Node/React dashboard, semantic ontology and historical harness remain
hosted/auxiliary layers. They are useful consumers and analysis surfaces, but
their existence is not evidence of Android physical execution.

The old statement “Android Bridge = stub” is superseded by the current JNI/RFL
implementation. The old statement “Phase 1 complete / Phase 2 not started” is
also superseded: multiple later runtime, validation, stability, HyperMemory,
NEON and evidence layers are materialized.

## 6. Open gates

Current high-value gaps are:

1. `APK_SHA256 <-> SOURCE_COMMIT` binding on the physical device;
2. source-built probe ELF hash in the same physical receipt;
3. Frida Gadget ELF hash in the same physical receipt;
4. before/after RFL store identity when proving OFF/FROZEN immutability;
5. physical SharedMemory/holder survival across target restart;
6. Frida reattach + state-restore receipt;
7. physical overhead/performance evidence for the exact artifact under test;
8. validation persistence implementation/evidence;
9. GPU backend implementation + measured total-cost evidence;
10. causal runtime claims, which remain independently gated.

## 7. Documentation routing

Use these documents by role:

| Role | Document |
|---|---|
| current implementation snapshot | `IMPLEMENTATION_SUMMARY.md` |
| Android build paths | `android/BUILD_GUIDE.md` |
| one-screen / device receipt | `android/app/ONE_SCREEN_OPERATOR_V1.md` |
| RFL design + implemented state | `android/app/LEARNING_ARCHITECTURE_V1.md` |
| APK/ELF/DEX standalone lab | `docs/android-apk-elf-dex-lab.md` |
| Runtime Stability Dump V2 | `docs/android-runtime-stability-dump.md` |
| falsifiability / causality boundary | `docs/runtime-stability-falsifiability.md` |
| HyperMemory | `docs/hypermemory-runtime-v1.md` |
| uncertainty / actionability | `docs/runtime-uncertainty-family-v1.md` |
| historical GUI architecture | `docs/GUI_ARCHITECTURE.md` |

## 8. R3

```text
F_ok:
  current JNI/RFL/NEON4096 code is materialized;
  exact-head hosted gates are recorded;
  physical diagnostic evidence exists at a narrower scope;
  documentation now separates source, CI, physical execution and claim.

F_gap:
  byte-exact installed-artifact -> source binding remains TOKEN_VAZIO;
  restart/reattach/persistence/GPU/causal gates remain open.

F_next:
  extend the existing on-device receipt to bind APK + probe ELF + Gadget ELF
  hashes to one clean exact source head, then execute that verifier physically.

claim_allowed=false
```

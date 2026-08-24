# RAFAELIA — Frida Implementation Correction Map V1

**Snapshot authority:** `rafaelmeloreisnovo/frida-desktop@27104496379491008ff56ce157ce9e7de1bdcce8`  
**Date:** 2026-08-24  
**Scope:** `MAPPING_ONLY` — correction of implementation topology; no runtime mutation, build, attachment, or physical-device claim.  
**Gate:** `claim_allowed=false`  
**Invariant:** `VISÃO ≠ ARTEFATO ≠ EXECUÇÃO ≠ EVIDÊNCIA ≠ CLAIM`.

## 1. Objective

Map the real dependency and execution boundaries currently present in `frida-desktop`, so a future implementation can move the RAFAELIA/RFL native path toward a small freestanding-authorial core without pretending that the whole Frida product is dependency-free.

The correction target is therefore:

```text
Frida upstream / Android / POSIX / JNI / dashboard
                    ↓ explicit boundary
          RFL host adapters / bridges
                    ↓ narrow ABI
       freestanding-authorial core candidate
```

This document does **not** claim that Frida itself can be made ISO-C freestanding without replacing the operating-system/process-instrumentation boundary. Frida's purpose requires target-process and OS interfaces. The auditable goal is to isolate those interfaces instead of allowing them to leak into the core.

## 2. Real dependency surface observed at the snapshot

### 2.1 Upstream Frida boundary — third-party source dependencies

`.gitmodules` declares 10 upstream repositories:

1. `frida-gum`
2. `frida-core`
3. `frida-python`
4. `frida-node`
5. `frida-swift`
6. `frida-clr`
7. `frida-qml`
8. `frida-tools`
9. `frida-go`
10. `releng`

**Classification:** `UPSTREAM_FRIDA / EXTERNAL_SOURCE / NOT_FREESTANDING`.

**Correction:** keep this entire family behind an explicit `frida_adapter` boundary. Do not describe these sources as authorial or dependency-free. Any future replacement must be evidenced component-by-component; absence of evidence remains `TOKEN_VAZIO`.

### 2.2 Android application boundary

`android/app/build.gradle` currently declares:

- Android application plugin;
- `compileSdk 34`, `minSdk 29`, `targetSdk 34`;
- Java 11 source/target;
- ABI filters `armeabi-v7a` and `arm64-v8a`;
- runtime/UI dependencies: AppCompat, ConstraintLayout, Material, Gson, OkHttp;
- test dependencies: JUnit, AndroidX JUnit, Espresso.

**Classification:** `ANDROID_HOSTED / BUILD_AND_RUNTIME_EXTERNAL`.

**Correction:** Android UI/network/JSON concerns must not be prerequisites for compiling the deterministic RFL core. They remain a host application layer.

### 2.3 Dashboard boundary

The backend is explicitly Node-hosted and uses `express`, `sqlite3`, `cors`, `dotenv`, `ws`, and `uuid`; its development path adds `nodemon`, `jest`, `supertest`, and `eslint`.

The web dashboard is explicitly browser/Node-hosted and uses `react`, `react-dom`, `recharts`, `axios`, and `zustand`; its build path also depends on TypeScript/Vite/ESLint tooling.

**Classification:** `HOSTED_AUXILIARY / OPTIONAL_FOR_CORE`.

**Correction:** dashboard and backend must remain consumers of receipts/snapshots, never dependencies of the native core or proof that Android native execution occurred.

## 3. Native code — real boundary leaks

### 3.1 `android/app/native/neon4096_core.c`

Observed direct dependencies:

- POSIX: `<fcntl.h>`, `<unistd.h>`, `open`, `read`, `close`, `sysconf`, `/proc/cpuinfo`;
- C library: `<string.h>`, `memset`, `memcpy`, `memcmp`;
- C11 atomics: `<stdatomic.h>`;
- compiler/architecture surface: `<arm_neon.h>` and target-specific NEON intrinsics.

The deterministic CRC32C, fold, page seal/verify and scalar/NEON algorithms are separable from the OS probes. The OS leakage comes chiefly from runtime NEON detection and page-size observation.

**Correction boundary:**

```text
neon4096_core_algorithm.c    # no /proc, no open/read/close/sysconf
        ↑
rafaelia_platform_probe.h    # narrow capability ABI
        ↑
platform_android_linux.c     # /proc/cpuinfo + sysconf implementation
```

AArch64 baseline-NEON knowledge may stay compile-time; ARM32 runtime capability observation belongs to the platform adapter.

### 3.2 `android/app/native/learning_store.c`

Observed direct dependencies:

- POSIX file lifecycle: `open`, `close`, `fstat`, `pread`, `pwrite`, `ftruncate`, `fdatasync`;
- POSIX time: `clock_gettime(CLOCK_MONOTONIC, ...)`;
- POSIX types/contracts: `errno`, `EINTR`, `off_t`, `struct stat`;
- C library: `memset`, `memcpy`;
- C11 atomics: `atomic_flag`.

The predictor, record encoding, CRC, replay rules, confidence/error accounting and deterministic state transitions are conceptually distinct from storage syscalls.

**Correction boundary:**

```text
learning_model_core.c       # predictor/state/record semantics
learning_codec_core.c       # header/record encoding + CRC
        ↑
rfl_storage_port.h          # read_at/write_at/resize/sync/size
rfl_clock_port.h            # monotonic_ns
        ↑
platform_posix_store.c      # current syscall implementation
```

No `open/pread/pwrite/ftruncate/fdatasync/clock_gettime` should remain in the future core target.

### 3.3 `android/app/native/learning_runtime.c`

Observed direct surface is materially smaller: `<limits.h>`, `<stdatomic.h>`, `<string.h>` plus project headers. It is therefore the strongest current candidate for a freestanding-authorial nucleus, subject to replacing/containing memory helpers and proving the emitted object has no forbidden runtime imports.

**Correction:** keep mode transitions, validation table and deterministic counters in core; inject persistence, clock and platform capabilities through interfaces.

### 3.4 `android/app/native/elf_probe.c`

Observed direct dependencies:

- JNI: `<jni.h>` and `JNIEnv` operations;
- hosted formatting: `<stdio.h>` / `snprintf`;
- it directly `#include`s `learning_store.c`, `neon4096_core.c`, and `learning_runtime.c` into one translation unit.

The file itself documents this amalgamation as temporary pending a canonical Android/native source manifest.

**Correction boundary:**

```text
core/*.c                       # compiled independently
ports/*.c                      # platform implementations
bridge/android/rfl_jni.c       # JNI only
bridge/android/rfl_text.c      # optional hosted formatting only
```

JNI and presentation strings must not be compiled into the freestanding core proof object.

## 4. Corrected topology — target tree

```text
frida-desktop/
├── upstream/ or subprojects/              [EXTERNAL / FRIDA]
│   └── ...                                 explicit adapter only
├── rafaelia/
│   ├── core/                               [AUTHORIAL / FREESTANDING TARGET]
│   │   ├── rfl_model_core.*
│   │   ├── rfl_runtime_core.*
│   │   ├── rfl_codec_core.*
│   │   └── neon4096_core_algorithm.*
│   ├── ports/                              [BOUNDARY CONTRACTS]
│   │   ├── rfl_storage_port.h
│   │   ├── rfl_clock_port.h
│   │   ├── rfl_cpu_caps_port.h
│   │   └── rfl_memory_port.h
│   ├── platform/
│   │   └── android_linux/                  [POSIX/ANDROID IMPLEMENTATION]
│   └── bridge/
│       ├── frida/                          [FRIDA ADAPTER]
│       └── android_jni/                    [JNI ADAPTER]
├── android/app/                            [HOST APP]
└── dashboard/                              [HOSTED AUXILIARY]
```

This is a **target topology**, not evidence that these paths already exist.

## 5. Audit flags — mapping semantics

These are mapping flags, not current compile macros:

| Flag | Snapshot state | Meaning |
|---|---:|---|
| `FRIDA_UPSTREAM_EXTERNAL_PRESENT` | `1` | 10 upstream Frida/releng submodules exist. |
| `ANDROID_HOSTED_DEPS_PRESENT` | `1` | Android Gradle dependency surface exists. |
| `DASHBOARD_HOSTED_DEPS_PRESENT` | `1` | Node/React dependency surfaces exist. |
| `RFL_POSIX_IO_IN_CORE_PATH` | `1` | learning store currently owns POSIX persistence calls. |
| `RFL_OS_PROBE_IN_NEON_PATH` | `1` | NEON/page probing currently owns OS calls. |
| `RFL_JNI_IN_AMALGAMATION_PATH` | `1` | JNI bridge currently amalgamates native `.c` sources. |
| `RFL_CORE_FREESTANDING_TARGET` | `1` | architectural target is valid as an isolated subset. |
| `FULL_FRIDA_FREESTANDING_PROVEN` | `0` | not proven and not claimed. |
| `NO_EXTERNAL_DEPENDENCIES_PROVEN` | `0` | not proven and contradicted by current manifests. |
| `CLAIM_ALLOWED` | `0` | remains false pending evidence gates. |

## 6. Correction sequence — no unnecessary loop

### Gear A — isolate deterministic logic

Move only algorithm/state logic across the boundary first. Preserve byte layouts and ABIs. Do not change behavior while changing ownership.

### Gear B — introduce narrow ports

Every external effect must become an explicit port:

- storage;
- monotonic clock;
- CPU capability/page-size observation;
- optional memory primitives;
- Frida integration;
- JNI/UI formatting.

### Gear C — split translation units

Remove `.c`-file inclusion from the JNI translation unit. Build the deterministic core, platform ports and bridge as separate objects with an explicit source manifest.

### Gear D — dependency gates

The core gate must reject accidental re-entry of hosted headers/syscalls. Suggested static checks:

- core source contains no `jni.h`, `stdio.h`, `unistd.h`, `fcntl.h`, `sys/stat.h`;
- core symbol table has no `open/read/pread/pwrite/close/ftruncate/fdatasync/sysconf/clock_gettime/snprintf` imports;
- no dashboard/Gradle package is needed to build the core objects.

### Gear E — ABI evidence

After topology correction, produce separate receipts for:

1. hosted C11 object/self-test;
2. `-ffreestanding -fno-builtin` object;
3. ARM32 cross-build;
4. ARM64 cross-build;
5. Android host integration;
6. authorized Frida adapter integration;
7. physical ARM32 Android execution;
8. bounded overhead/stability benchmark.

Only receipts can change evidence state.

## 7. Existing TOKEN_VAZIO ledger alignment

Do not renumber or erase the existing ledger. This map routes its unresolved gates:

- `TV-26` — ARM32 cross-build receipt → **TOKEN_VAZIO**;
- `TV-27` — ARM64 cross-build receipt → **TOKEN_VAZIO**;
- `TV-28` — authorized Android Frida attachment adapter → **TOKEN_VAZIO**;
- `TV-29` — physical Android ARM32 runtime receipt → **TOKEN_VAZIO**;
- `TV-30` — bounded overhead/stability measurement → **TOKEN_VAZIO**.

The earlier local freestanding-object receipt does not prove this *current Android/RFL tree* has already been separated according to the topology above. No silent promotion is allowed.

## 8. Hard non-regression rules

1. `upstream Frida ≠ RAFAELIA authorial core`.
2. `Android host ≠ freestanding core`.
3. `dashboard fixture ≠ device execution`.
4. `JNI bridge ≠ deterministic algorithm`.
5. `compile success ≠ attachment success`.
6. `attachment success ≠ stability/performance proof`.
7. `TOKEN_VAZIO ≠ zero`; it is an auditable pending state.
8. Any replacement of an external dependency must name the removed artifact, replacement artifact, ABI effect, license effect, test, and receipt.

## 9. Definition of done for the correction stage

This mapping stage is complete when the repository has a stable dependency map and machine-readable companion describing the same boundaries. It does **not** close runtime gates.

Future implementation is allowed to claim `RFL_CORE_ISOLATED` only after static symbol/header gates and freestanding object receipts pass on the ref under test.

Until then:

```text
status = MAPPED_FOR_CORRECTION
claim_allowed = false
runtime_execution = TOKEN_VAZIO
```

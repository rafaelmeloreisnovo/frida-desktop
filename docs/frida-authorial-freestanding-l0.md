# Frida refactor — authorial freestanding L0

Status: `PASS_BOUNDED_L0`.
Exact tested source head: `e08d2fe055946faf8ac20d80418ea4e837e1fcaf`.
Merged by PR #78 into main: `83859641ea55ff449b2127ddf7f59bf02ddfc137`.
Scope: RAFAELIA local L0 delta only.
Whole-Frida freestanding: `TOKEN_VAZIO`.
Whole-repository authorship claim: `false`.
claim_allowed(L0 structural/runtime-dependency scope): `true`.
claim_allowed(whole Frida): `false`.

## What changed

The runtime-bearing local slice now has a direct L0 boundary:

- `android/app/native/rafaelia_freestanding_l0.h`
- `android/app/native/rafaelia_freestanding_l0.c`
- `android/app/native/rafaelia_freestanding_l0_selftest.c`

L0 uses caller-owned memory and has no system-header include, libc call, heap,
OS API, JNI API, Frida/Gum header, dynamic loader, or language runtime.

The existing `learning_runtime.c` was refactored to consume L0 for fixed-state
zeroing, locking, saturating counters, and validation ratios. Its direct
`<limits.h>`, `<stdatomic.h>`, and `<string.h>` includes were removed.

## Structural gate

`frida-authorial-freestanding-l0-gate.sh` compiles the core with
`-ffreestanding -fno-builtin`, then links a no-runtime ELF with
`-nostdlib -nodefaultlibs -nostartfiles`.

The gate fails if the L0 object/ELF has undefined symbols, a program
interpreter, or a `DT_NEEDED` dependency. A separate hosted harness checks
the primitive semantics, including CRC32C `123456789 -> e3069283`.

The compiler, linker, shell, `readelf`, `nm`, and GitHub runner are
build/evidence tooling, not runtime dependencies of the L0 ELF.

## Boundary

Inherited Frida remains third-party. This refactor does not rewrite provenance
and does not promote upstream Frida, Gum, Gadget, language bindings, or hosted
Android layers to freestanding.

```text
SOURCE != ARTIFACT != EXECUTION != EVIDENCE != CLAIM
BUILD_TOOLCHAIN != RUNTIME_DEPENDENCY
IMPLEMENTED_UNTESTED_CI != PASS
TOKEN_VAZIO != 0
```

## Closed gates and remaining boundary

The exact tested head `e08d2fe055946faf8ac20d80418ea4e837e1fcaf`
closed:

1. L0 structural ELF gate: `PASS`;
2. RFL + NEON4096 regression selftest with L0 linked: `PASS`;
3. Android APK + ELF/DEX lab: `PASS`;
4. workflow architecture + provenance non-regression: `PASS`;
5. OMEGA fail-closed final verdict: `PASS`.

The generic L0 cross-architecture no-runtime proof and physical-device
execution remain `TOKEN_VAZIO`. The whole repository remains
`TOKEN_VAZIO` for freestanding status.

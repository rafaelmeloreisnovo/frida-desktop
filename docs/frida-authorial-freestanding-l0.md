# Frida refactor — authorial freestanding L0

Status: `PASS_BOUNDED_L0_CROSSARCH`.
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

## Cross-architecture closure — PR #79

Exact tested source head: `2102f01fd21cabafe22de62dd382401fa26f660b`.  
Merged to main: `786f22f5e7a520222f5aac044fa664efb91290cd`.  
OMEGA run: `37684304254` = `SUCCESS`.

The same L0 source now cross-compiles and links as bare/no-runtime ELF for:

- ARMv7: ELF32 / ARM;
- AArch64: ELF64 / AArch64.

For both core ELFs the exact-head gate observed:

```text
PT_INTERP = NONE
DT_NEEDED = NONE
undefined_symbols = 0
```

The ratio path no longer relies on compiler-generated 64-bit division helpers;
it uses an explicit scaled integer algorithm and keeps the existing hosted
semantic tests green.

Exact bytes produced by the validated run:

```text
ARMv7  core  9802c0fb914ccc4c96c4babc3a2f297bcabb15b7abee614f6066d6b147123c84
ARMv7  probe 580a489b9d5c93c871a4b42a662e3ee8eedb1ba07ed695365d61142c3cf9911d
AArch64 core  38ddeef3f0cdf9e31680aa83f747c78b1f955db8182b900d907647b43b0a938b
AArch64 probe 2b2e0cb1d079bde70b64d643e1b053d01bc9885a0ca114faecb0c76daebba8cf
```

Artifact: `frida-l0-crossarch-37684304254`, GitHub artifact id
`11509863828`, archive digest
`sha256:c20bfcfc3d227bab04c2919bce6efba0385259a549da85e91e4c97706a321ced`.

The device probe is intentionally a separate boundary. It adds only a raw
Linux `exit_group` adapter so an Android/Linux process can return observable
success/failure. The pure L0 core itself remains syscall-free.

Physical ARMv7 execution = `TOKEN_VAZIO`.  
Physical AArch64 execution = `TOKEN_VAZIO`.  
Whole-Frida freestanding = `TOKEN_VAZIO`.

One runtime-learning integration attempt hit a 10-second watchdog timeout;
the same unchanged source passed when only that failed job was rerun. The
timeout remains historical evidence of timing variability and is not erased.

# Frida refactor — authorial freestanding L0

Status: `IMPLEMENTED_UNTESTED_CI` until exact-head CI closes the gate.
Code head recorded by this document: `d3cca63c3267e60638cda9632881d8a76be4d910`.
Scope: RAFAELIA local delta only.
Whole-Frida freestanding: `TOKEN_VAZIO`.
Whole-repository authorship claim: `false`.
Global claim gate: `claim_allowed=false`.

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

## Next gate

Exact-head CI must prove:

1. L0 structural ELF gate;
2. RFL + NEON4096 regression selftest with L0 linked;
3. existing OMEGA core path remains green.

Only then may this exact slice move from `IMPLEMENTED_UNTESTED_CI` to
`PASS`. The whole repository remains `TOKEN_VAZIO` for freestanding status.

# Freestanding diagnostic profile

This repository is primarily a hosted desktop build.  The freestanding profile is
therefore intentionally opt-in and non-invasive: the default build remains the
same, while `-Dfreestanding_profile=true` selects a constrained diagnostic shape
that downstream targets can use as the first step toward no-malloc, no-heap,
no-GC, bare-metal style validation.

## Contract

When `freestanding_profile` is enabled, the top-level build file:

- defines `FRIDA_FREESTANDING_PROFILE=1` for C sources;
- adds `-ffreestanding` and `-fno-builtin` when the active C compiler supports them;
- disables GumJS (`gumjs=disabled`) so the JavaScript/GC runtime layer is not
  selected by this profile;
- disables graft, gadget, server, portal, and injector products at the top
  level;
- skips hosted language/tooling layers such as .NET, Node.js, Python, Swift,
  QML, and CLI tools.

The separate `debugger_class_a` option defines `FRIDA_DEBUGGER_CLASS_A=1`.  It is
kept independent so strict debugger diagnostics can be enabled without changing
the default desktop build or forcing the freestanding profile.

A matching standalone route-planning module is available in
`tools/frida-debugger-class-a-autotune.c`.  It keeps the same opt-in stance: the
source can be compiled by target diagnostics that need branchless, no-heap
FAILSAFE/FAILOVER/ROLLBACK decisions, but it is not wired into the default
desktop build.

## Strict ARM32/NEON4096 leaf core

For hot paths that need a stronger contract than the repository-wide diagnostic
profile, `android/app/native/neon4096_armv7.S` is a separate ARMv7-A leaf core.
It does not inherit the hosted implementation in `neon4096_core.c` and does not
perform runtime CPU discovery, POSIX I/O, allocation, atomics, libc calls, or
system calls.

Its ABI is declared in `android/app/native/neon4096_freestanding.h` and contains
only two `void` entry points: one fixed 4096-byte staging kernel and one
three-source 4096-byte NEON XOR kernel. The object-level gate requires ELF32 ARM,
zero undefined symbols, no call instructions, no stack push/pop, and only the
two intended hidden global ABI symbols.

The ARM32 core uses 128-bit NEON vectors. With `u8` data that is 16 lanes per
vector ALU operation; a 4096-byte page is 256 such vectors. `pld` is used only as
a prefetch hint. It does not turn a 128-bit physical NEON register into a
4096-byte register and it does not by itself prove a cache-hit or bandwidth
claim.

Run the strict structural gate with:

```sh
bash .github/scripts/rafaelia/arm32-neon4096-freestanding-gate.sh
```

See `docs/arm32-neon4096-freestanding.md` for the exact ABI, flags, cache/buffer
contract, three-stream interpretation, and the remaining physical-device
`TOKEN_VAZIO` gates.

## Freestanding hash-math sidecar

`android/app/native/hash_math_plugin_*` adds a second, independent leaf family
for an opt-in RAFAELIA sidecar transform. It is deliberately not wired by
rewriting MD5, SHA-2, BLAKE, BLAKE2, or BLAKE3 internals.

The portable object has a compile-time enable/disable switch. The disabled build
is required to export zero plugin globals. The Arm specializations are:

- ARMv7-A: 128-bit NEON, 16 `u8` lanes per physical vector operation;
- AArch64: 128-bit Advanced SIMD, 16 `u8` lanes per physical vector operation,
  with two vectors issued per 32-byte software stage.

A 10-target cross-compile matrix checks structural freestanding portability for
ARMv7, AArch64, x86-64, i386, RISC-V 64/32, PPC64LE, s390x, MIPS32LE, and
MIPS64LE. This matrix is coverage, not a market-share claim.

Run:

```sh
bash .github/scripts/rafaelia/hash-math-plugin-freestanding-gate.sh
```

The gate attempts every target before issuing the final aggregate result. See
`docs/hash-math-plugin-freestanding.md` for the standards boundary, authorship
boundary, plugin semantics, architecture matrix, security non-claim, and open
physical `TOKEN_VAZIO` gates.

## Scope and non-goals

This profile does not claim that every transitive subproject is already
bare-metal safe.  In particular, eliminating every allocator, heap dependency,
system call, or runtime service must be proven inside the relevant subprojects
and target platform code.  The top-level repository can only provide a safe
selector that removes the obvious hosted/GC layers and exposes compile-time
macros for downstream enforcement.

The strict ARM32 leaf core and the hash-math sidecar are narrower and stronger
than that top-level profile. Their structural PASS must not be generalized into
a claim that all Frida subprojects are freestanding.

## Two-cycle validation loop

Use two feedback cycles before promoting a target:

1. **Configuration cycle:** run Meson with the profile enabled and verify that
   only the expected subprojects/components are configured.
2. **Evidence cycle:** run the target-specific symbol, syscall, and allocator
   checks for the produced binaries.  Treat missing evidence as `SKIPPED`, not
   as success.

The helper below validates the top-level contract without requiring submodules:

```sh
python3 tools/validate-freestanding-profile.py
```

For the strict ARM32 leaf object, also run:

```sh
bash .github/scripts/rafaelia/arm32-neon4096-freestanding-gate.sh
```

For the hash-math sidecar, run:

```sh
bash .github/scripts/rafaelia/hash-math-plugin-freestanding-gate.sh
```

## Example configuration

```sh
./configure -Dfreestanding_profile=true -Ddebugger_class_a=true
```

For a hosted desktop build, omit both options; defaults are intentionally
unchanged.

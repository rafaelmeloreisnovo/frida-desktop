# Freestanding 4096-byte sidecar transport

> **Status:** retained for compatibility and data-path experiments. It is no
> longer the primary mathematical backend for MD5/SHA/BLAKE. The bit-exact
> backend is documented in `docs/hash-bitexact-backend.md`.

## What this component is

The `hash_math_plugin_*` files implement an opt-in RAFAELIA-authored 4096-byte,
three-stream page transform with caller-owned buffers and specialized ARMv7
NEON/AArch64 Advanced SIMD leaves.

Its strict leaf contract remains:

- fixed 4096-byte pages;
- three input streams plus one caller-provided output buffer;
- `void` ABI;
- compile-time enable/disable;
- no allocator, heap, GC, libc, syscall, runtime loader, shadow route or tail-call
  dispatch inside the strict leaf;
- fixed-count/data-independent loop control;
- ARM32 NEON physical width 128 bits = 16 u8 lanes;
- AArch64 Advanced SIMD physical width 128 bits = 16 u8 lanes, with wider
  software stages formed by composing vectors.

## What this component is not

The three-stream XOR/page mixer is **not** the implementation of MD5, SHA-2 or
BLAKE3 mathematics. Applying it to message bytes before a hash changes the
message being hashed. Therefore it cannot be used as proof of standard digest
compatibility.

The standards-preserving path is now:

```text
host message/padding/schedule/constants
  -> hash_bitexact_core.h
  -> hash_bitexact_equations.h
  -> architecture lowering
  -> bit-identical standard digest
```

See `docs/hash-bitexact-backend.md` and run:

```sh
bash .github/scripts/rafaelia/hash-bitexact-backend-gate.sh
```

That gate checks both ten-target freestanding compilation and semantic reference
vectors for MD5, SHA-256 and BLAKE3.

## Authorship boundary

RAFAELIA authorship is asserted over the repository-specific sidecar ABI,
4096-byte/three-stream orchestration, specialized leaf implementations, build
contracts, gates, receipts, integration and documentation. No authorship claim
is made over MD5, SHA, BLAKE/BLAKE3 mathematics, Arm instruction semantics or
abstract mathematical identities.

## Performance boundary

Prefetch and multiple independent streams expose work to the microarchitecture;
they do not prove cache residency, 3x throughput, 3x bandwidth or eight-core
scaling. Those claims remain `TOKEN_VAZIO` until measured on the exact physical
object/device with a reproducible baseline.

MD5 remains legacy interoperability only and is not promoted as a modern
collision-resistant hash.

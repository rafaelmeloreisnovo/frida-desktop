# Freestanding 4096-byte sidecar transport

> **Authority:** transport/orchestration compatibility layer. The standards-preserving mathematical backend is `docs/hash-bitexact-backend.md`.

The `hash_math_plugin_*` files remain an opt-in RAFAELIA-authored 4096-byte, three-stream transform with caller-owned buffers. They are intentionally retained so the existing ABI/data-path work is not regressed.

## Current ARM32 geometry

- 128-bit physical NEON = 16 u8 lanes;
- 4096-byte page;
- 16 fixed loop iterations x 256 bytes;
- prefetch point every 128 processed bytes;
- three independent source streams and one caller output;
- XOR accumulates into the first-source registers rather than a separate shadow-result register path;
- only fixed-count loop control is conditional;
- allocator/heap/GC/libc/syscall/runtime-loader/shadow-route/tail-dispatch dependencies remain outside the strict leaf.

This preserves the loop-control reduction introduced on main while keeping prefetch cadence unchanged. It is a structural change, not a throughput claim.

## Standards boundary

The page mixer is **not** the MD5, SHA-2 or BLAKE3 equation engine. Applying it before a host hash changes the message. Therefore standard digest compatibility is proven only by the bit-exact backend, whose gate executes known MD5/SHA-256/BLAKE3 vectors.

Use:

`bash .github/scripts/rafaelia/hash-bitexact-backend-gate.sh`

for semantic equivalence, and the existing sidecar gate for transport/ELF geometry.

## Eight-core/cache boundary

Static page partitioning, CPU affinity and measurement orchestration stay outside the freestanding leaf. Prefetch remains a hint, not a cache-hit guarantee. Physical cache miss rate, 3x throughput/bandwidth and eight-core scaling remain `TOKEN_VAZIO`.

## Authorship/security

RAFAELIA authorship covers the repository-specific sidecar ABI, page/stream orchestration, specialized implementation, gates, receipts and integration; it does not cover standardized hash mathematics or ISA semantics. MD5 remains legacy interoperability only, not a modern collision-resistance recommendation.

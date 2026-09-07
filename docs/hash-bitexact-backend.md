# RAFAELIA bit-exact hash backend

This layer sits **below** the published hash mathematics. It does not transform the message, replace constants, change schedules, or rename a modified digest as MD5/SHA/BLAKE. It expresses the same fixed-width word algebra directly as freestanding operations suitable for compiler or architecture-specific lowering.

## Primitive boundary

`ADD mod 2^32/2^64`, `XOR`, `OR`, `AND`, `NOT`, logical shift, rotate, and explicit endian load/store are kept distinct. In particular, XOR is not replaced by ADD: carries would change the algorithm.

The production core is header-only/static-inline, so it requires no global ABI symbols. `hash_bitexact_equations.h` currently expresses MD5 F/G/H/I and step, SHA-256 Ch/Maj/sigma families, and BLAKE3 G using that primitive layer.

## Equivalence authority

Run `bash .github/scripts/rafaelia/hash-bitexact-backend-gate.sh`.

The gate compiles the production headers for ten targets (ARMv7, AArch64, x86-64, i386, RISC-V 64/32, PPC64LE, s390x, MIPS32LE, MIPS64LE), requires zero globals from a header-only probe, then executes reference vectors for MD5("abc"), SHA-256("abc"), and BLAKE3(""). Any differing bit fails the gate.

## Relationship to 4096-byte sidecar

The existing three-stream 4096-byte sidecar remains a transport/orchestration primitive. It is not the standards-preserving hash equation layer. Its current ARM32 geometry—16 fixed iterations x 256 bytes, 128-byte prefetch cadence, 128-bit NEON/16 u8 lanes, no separate shadow-result register path—is preserved.

The standards-compatible route is:

`host padding/schedule/constants -> bit-exact equations -> registers/architecture lowering -> identical digest`.

## Authorship boundary

RAFAELIA authorship applies to this repository-specific freestanding expression, ABI choices, lowering strategy, orchestration, gates, receipts and documentation. It does not claim authorship of MD5, SHA-2, BLAKE/BLAKE3 mathematics, published constants, Arm ISA semantics, or abstract mathematical identities.

## Performance boundary

Semantic equivalence can be proven in CI. Physical ARM32/ARM64 timing, cache miss rate, warm/cold behavior, 3x throughput/bandwidth and eight-core scaling remain `TOKEN_VAZIO` until measured on exact artifacts; performance `claim_allowed=false` remains in force.

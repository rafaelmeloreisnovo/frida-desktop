# RAFAELIA bit-exact hash backend

## Purpose

This is the low-level mathematical execution layer for hash implementations in
this repository. It does **not** transform the message, alter constants, change
round order, or redefine MD5, SHA-256, or BLAKE3. Its job is narrower: express
the same published word/bit algebra directly as freestanding operations that a
compiler or architecture-specific backend can lower into registers and machine
instructions.

The production layer is header-only/static-inline so the algebra itself adds no
required global ABI symbols.

## Exact algebra boundary

The primitive set is:

```text
ADD modulo 2^32 / 2^64
XOR
OR
AND
NOT
logical shift
rotate-left / rotate-right
explicit endian load/store
```

Unsigned C arithmetic supplies the required modulo-2^w wraparound. Rotates are
expressed without data-dependent branches and mask their count to word width.

A critical invariant is that boolean operations are not replaced by arithmetic
addition. For example, XOR and ADD are not interchangeable because ADD carries
between bit positions. Any such substitution would change the hash algorithm.

## Algorithm equations

`android/app/native/hash_bitexact_equations.h` currently maps the primitive
layer into the exact equation families required by:

- MD5: F, G, H, I and the modular-add/rotate step;
- SHA-256: Ch, Maj, big-sigma and small-sigma functions;
- BLAKE3: the 32-bit G mixing function.

The algorithm identity, constants, schedules, round counts and ordering remain
owned by their respective specifications/designs. RAFAELIA authorship applies
to this repository-specific freestanding expression, integration, gates,
receipts, architecture lowering and orchestration—not to the underlying
published hash mathematics.

## Equivalence gate

Run:

```sh
bash .github/scripts/rafaelia/hash-bitexact-backend-gate.sh
```

The gate has two independent responsibilities.

### 1. Structural freestanding gate

The production headers are scanned for hosted dependencies and compiled as a
header-only translation unit across ten target triples:

1. armv7a-none-eabi
2. aarch64-none-elf
3. x86_64-none-elf
4. i386-none-elf
5. riscv64-none-elf
6. riscv32-none-elf
7. powerpc64le-none-elf
8. s390x-none-elf
9. mipsel-none-elf
10. mips64el-none-elf

The header-only object must export zero global symbols.

### 2. Semantic bit-equivalence gate

A no-libc test translation unit evaluates known reference vectors using the
RAFAELIA primitives/equations:

```text
MD5("abc")
SHA-256("abc")
BLAKE3("")
```

The process exits nonzero if any output bit differs from its reference digest.
This means the gate is fail-closed at the semantic boundary: compilation alone
is not sufficient.

## Relation to the previous 4096-byte sidecar

The earlier `hash_math_plugin_*` 4096-byte/three-stream component is retained as
an optional data-path/page orchestration primitive for compatibility. It is not
the mathematical backend for a standards-conforming hash and must not be used
as evidence that MD5/SHA/BLAKE mathematics were preserved.

For standard digest compatibility, the path is now:

```text
message/padding owned by host algorithm
        -> exact algorithm schedule/constants
        -> RAFAELIA bit-exact word equations
        -> architecture lowering / registers
        -> identical standard digest
```

not:

```text
message -> generic sidecar transform -> hash
```

unless the caller intentionally wants to hash transformed data, in which case
that is a different message and therefore a different digest input.

## Low-level implementation principle

The desired optimization boundary is below the mathematics:

```text
published equation
  -> fixed-width word operations
  -> static-inline collapse
  -> compiler/ASM instruction selection
  -> registers / SIMD where semantics permit
```

Architecture specialization is allowed only when it is bit-identical to the
scalar equation layer. SIMD can execute independent words/blocks in parallel,
but it may not merge operations in a way that changes carries, rotations,
endianness, schedules or lane independence.

## ARM32 / ARM64

ARM32 NEON and AArch64 Advanced SIMD both have 128-bit physical vector registers.
For byte lanes, one vector contains 16 u8 lanes. Wider software stages are
composition of multiple 128-bit vectors, not larger physical NEON registers.

A future specialized hash backend may therefore process multiple independent
words/blocks in parallel while the scalar bit-exact layer remains the semantic
oracle.

## Security and compatibility

MD5 is retained only for legacy compatibility/equivalence testing; no new
collision-resistance claim is made for it.

The backend must never report a modified digest as standard MD5/SHA/BLAKE. A
standard algorithm name is permitted only when the final digest is bit-identical
to the applicable reference vectors/specification.

## Evidence state

Structural and semantic equivalence can be proven in CI. The following still
require physical-device evidence and remain `TOKEN_VAZIO` until measured:

- ARM32 physical timing;
- ARM64 physical timing;
- cache miss rate;
- warm/cold cache behavior;
- throughput ratio versus same-revision baseline;
- memory bandwidth ratio;
- eight-core scaling;
- any 3x performance statement.

Therefore performance `claim_allowed=false` remains correct until those gates
are closed.

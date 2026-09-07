# Freestanding hash-math sidecar plugin

## Purpose

This module provides an opt-in, freestanding RAFAELIA-authored transform that may
be placed before or beside a host hash implementation without rewriting the host
hash algorithm.

The contract is intentionally narrow:

- fixed 4096-byte working pages;
- three caller-provided input streams;
- caller-provided output buffer;
- `void` ABI;
- compile-time enable/disable;
- no allocator, heap, GC, libc, syscall, runtime CPU discovery, plugin loader,
  thread runtime, shadow path, or tail-call dispatch in the strict leaf kernels;
- no runtime algorithm switch inside the leaf hot path.

The transform is **not** itself claimed to be a cryptographic hash or a
replacement security primitive.

## Standards boundary

The following algorithm identities are host metadata only:

- `RAFAELIA_HASH_HOST_MD5`
- `RAFAELIA_HASH_HOST_SHA2`
- `RAFAELIA_HASH_HOST_BLAKE3`

The plugin does not contain or redefine the standardized/published mathematics
of MD5, SHA-2, or BLAKE3.

If the plugin is disabled, a standards-conforming host hash remains untouched.
If the plugin transforms message bytes before hashing, the result is a hash of
the transformed message, not the standard digest of the original message. If a
plugin transform is applied to a digest after hashing, that transformed value is
not the standard host-hash digest unless the original digest is preserved and
reported separately.

MD5 exists only as a legacy interoperability identity here. It must not be
promoted as collision-resistant security.

## Authorship boundary

RAFAELIA authorship is asserted only over the repository-specific expression
and engineering introduced here, including:

- the sidecar ABI and compile-time state contract;
- the 4096-byte/three-stream orchestration;
- the ARMv7 NEON and AArch64 Advanced SIMD leaf implementations;
- the portable freestanding fallback implementation;
- build flags, structural gates, receipts, documentation, and integration
  choices specific to this repository.

No authorship claim is made over:

- the MD5 algorithm or RFC 1321;
- SHA-2 or the Secure Hash Standard;
- BLAKE/BLAKE2/BLAKE3 algorithm design or specifications;
- Arm NEON / Advanced SIMD instruction-set semantics;
- mathematical principles, formulas, algorithms, or equations as abstract
  ideas or discoveries.

This is a provenance boundary, not legal advice. Licensing and attribution of
third-party source code remain governed by the licenses of that source. The
plugin deliberately avoids copying third-party hash implementation source.

## Enable/disable model

`RAFAELIA_HASH_MATH_PLUGIN_STATE` is a compile-time selector.

Enabled:

```text
-DRAFAELIA_HASH_MATH_PLUGIN_STATE=1
```

Disabled:

```text
-DRAFAELIA_HASH_MATH_PLUGIN_STATE=0
```

The structural gate verifies that the disabled portable object exports zero
plugin globals. There is therefore no runtime branch required merely to decide
whether the plugin exists.

## ARM32 hot path

`android/app/native/hash_math_plugin_armv7.S`

Target contract:

```text
--target=armv7a-none-eabi
-march=armv7-a
-mfpu=neon
-mfloat-abi=softfp
-ffreestanding
-fno-builtin
```

The physical NEON vector width is 128 bits. For `u8`, that is 16 lanes per
vector ALU operation. The implementation works over three independent streams,
prefetches each stream 256 bytes ahead using `pld`, and processes a fixed
4096-byte page.

The ARM32 sidecar is now structurally aligned with the strict NEON4096 leaf:

```text
16 fixed loop iterations x 256 bytes = 4096 bytes
prefetch point every 128 processed bytes
3 independent source streams
1 caller-provided output stream
```

Each 256-byte loop iteration is composed from two consecutive 128-byte vector
groups. The second group receives a new prefetch point, preserving the existing
128-byte prefetch cadence while halving loop-control executions from 32 to 16
per page. This is a structural control-flow reduction, not a measured throughput
claim.

The XOR result is accumulated directly into the registers that initially hold
the first source stream (`q0`/`q1`). No separate shadow-result register path is
introduced. The loop is fixed-count and data-independent; the only conditional
branch in the leaf is loop control.

## AArch64 hot path

`android/app/native/hash_math_plugin_aarch64.S`

Target contract:

```text
--target=aarch64-none-elf
-march=armv8-a+simd
-ffreestanding
-fno-builtin
```

AArch64 Advanced SIMD also uses 128-bit vector registers. Therefore a single
`u8` vector ALU operation has 16 lanes, not 32. The implementation issues two
independent 128-bit vector operations per software stage, giving a 32-byte
software stage while preserving the actual hardware-width statement.

This distinction is deliberate:

```text
physical vector width = 128 bits
u8 lanes per physical vector = 16
vectors per software stage = 2
effective software stage = 32 bytes
```

## 128 -> 256 -> 512 -> 1024 -> 2048 -> 4096 composition

These values are treated as page-composition levels, not as fictitious physical
register widths:

```text
128-bit physical vector
  -> 256-bit software pair
  -> 512-bit composed group
  -> 1024-bit composed group
  -> 2048-bit composed group
  -> 4096-byte page contract
```

The gate and documentation must never rewrite these composition levels as a
claim that NEON has 256-, 512-, 1024-, 2048-, or 4096-bit physical registers.

## Ten-target structural portability matrix

The portable leaf is cross-compiled as an object for ten target triples:

1. `armv7a-none-eabi`
2. `aarch64-none-elf`
3. `x86_64-none-elf`
4. `i386-none-elf`
5. `riscv64-none-elf`
6. `riscv32-none-elf`
7. `powerpc64le-none-elf`
8. `s390x-none-elf`
9. `mipsel-none-elf`
10. `mips64el-none-elf`

This is an engineering coverage matrix, **not a market-share ranking**. A target
appearing here means only that its freestanding object contract is structurally
checked by the repository gate. It does not mean the repository claims equal
commercial relevance, equal optimization quality, or physical-device
validation across all ten targets.

ARMv7 and AArch64 additionally have handwritten SIMD leaf kernels. The remaining
targets currently use only the portable structural fallback and therefore carry
no SIMD-performance claim.

## Full-scan shell gate

Run:

```sh
bash .github/scripts/rafaelia/hash-math-plugin-freestanding-gate.sh
```

The shell gate scans all ten portable targets and records each result before
making the final gate decision. A single target failure does not terminate the
matrix before the remaining targets are attempted.

Evidence is emitted under:

```text
evidence/hash-math-plugin-freestanding/
```

including:

- `target-matrix.tsv`
- per-target build logs
- per-target undefined-symbol reports
- disabled-object global-symbol reports
- ARMv7 and AArch64 ELF headers and symbol tables
- SHA-256 identities
- `receipt.json`

Receipt v2 also binds the ARM32 geometry:

- `arm32_bytes_per_fixed_loop_iteration = 256`
- `arm32_fixed_loop_iterations_per_page = 16`
- `arm32_prefetch_cadence_bytes = 128`
- `arm32_loop_control_iteration_reduction_vs_v1 = 32_to_16`

## Cache and buffer contract

The specialized Arm leaves use prefetch hints and caller-owned buffers. The
intended topology is:

```text
memory -> prefetch hint -> cache hierarchy -> vector registers -> caller buffer
```

A prefetch instruction is a hint to the microarchitecture, not a guarantee of a
cache hit. The code therefore does not claim deterministic cache residency.

The three-stream layout creates independent memory/vector work that may improve
instruction-level overlap. It does not prove three times the throughput or
bandwidth.

For an eight-core ARM32 target, static page partitioning belongs to the external
measurement/orchestration layer. CPU affinity, scheduling and thread creation do
not belong inside this freestanding leaf, because introducing them would violate
the zero-runtime-dependency boundary.

## Open physical gates

The following remain `TOKEN_VAZIO` until measured on the physical target with
reproducible evidence:

- ARM32 physical execution of the exact object SHA-256;
- ARM64 physical execution of the exact object SHA-256;
- cache miss rate;
- warm-cache versus cold-cache behavior;
- throughput relative to a same-revision baseline;
- memory bandwidth relative to a same-revision baseline;
- any `3x` throughput or bandwidth statement;
- cross-core scaling across an eight-core device.

`claim_allowed=false` remains the correct state until those runtime gates are
closed.

## Security non-claim

The three-stream XOR sidecar is an orchestration/mixing primitive for the
RAFAELIA data path. It is not asserted to provide collision resistance,
preimage resistance, authentication, key derivation, or any other cryptographic
security property.

When cryptographic security is required, the host hash must retain its own
standards-conforming implementation and security analysis.

# Bit-exact streaming hashes + ARM32 NEON specialization

## Scope

This layer lowers the existing MD5, SHA-256 and SHA-512 mathematics to fixed-width words and caller-owned buffers. It does not redefine the algorithms, change constants, change round order, add salts, or transform the input before hashing.

Production path:

`bytes -> fixed buffer -> exact word loads -> original Boolean/modular equations -> state -> digest`

The production headers are freestanding and header-only. They do not require malloc, heap, GC, libc, syscalls, atomics, TLS, thread runtimes, external crypto libraries, shadow routes, or tail-call dispatch.

## Streaming

`hash_bitexact_digest.h` provides caller-owned contexts for MD5, SHA-256 and SHA-512. Padding, block boundaries, length encoding and incremental updates are implemented directly on fixed arrays. The CI differential oracle checks 25 lengths per algorithm, including both sides of the MD5/SHA-256 56/64-byte and SHA-512 112/128-byte padding boundaries plus 4095/4096/4097 bytes.

The Python/hashlib oracle exists only in the test harness. It is not a production dependency.

## ARM32 NEON mathematics

`hash_bitexact_neon4.h` expresses four independent SHA-256 states as one 128-bit compiler vector. Under the required ARMv7-A flags, one vector ALU instruction therefore operates on four independent `u32` lanes:

`128 bits / 32 bits = 4 SHA-256 lanes`

This is distinct from the byte transport kernel, where one 128-bit NEON operation carries sixteen `u8` lanes:

`128 bits / 8 bits = 16 byte lanes`

The code must not claim sixteen `u32` lanes in one 128-bit register. Sixteen independent SHA-256 states require four independent 128-bit vectors; the compiler may keep several such vectors in flight, but each individual 32-bit vector instruction still has four lanes.

The NEON gate cross-compiles for ARMv7-A with `-march=armv7-a -mfpu=neon -mfloat-abi=softfp -ffreestanding -fno-builtin -fno-stack-protector -fno-unwind-tables -fno-asynchronous-unwind-tables`. The ARM32 object must have zero undefined symbols. In addition, Clang emits ARM assembly from the same source and exact target/O3 flags; that generated assembly must contain NEON vector add/XOR/shift/OR operations. This keeps the code-generation proof independent of runner-specific `llvm-objdump` executable names.

## Loop specialization

`RAFAELIA_HASH_NEON4_FULL_UNROLL=0` is the default portable specialization. `RAFAELIA_HASH_NEON4_FULL_UNROLL=1` asks Clang to fully expand the fixed SHA-256 schedule/round loops. CI requires the generated ARM32 full-unroll assembly to contain zero conditional loop branches and to remain semantically equivalent to the default path.

Full unroll is a structural candidate, not a speed claim. Larger instruction footprint may increase I-cache pressure, so physical promotion requires device measurement.

## 128 -> 4096 cache/buffer boundary

The strict transport leaf keeps the existing 4096-byte page contract: physical NEON width 128 bits, 16 byte lanes per vector operation, 256 vectors per page, caller-owned buffers and three independent source streams where the existing `xor3` ABI is used. `pld` is a cache prefetch hint, not a cache-residency guarantee.

The intended boundary is:

`memory -> PLD/prefetch hint -> cache hierarchy -> caller buffer -> bit-exact word/SIMD math -> caller output buffer`

Software can choose addresses and prefetch points, but it cannot directly command hardware cache replacement policy. Cache miss rate therefore remains an observed metric, not a software-controlled fact.

## Eight cores

The strict math and transport leaves contain no scheduler or thread dependency. Static partitioning across 1/2/4/8 workers belongs to the external measurement/orchestration layer already present in the repository.

## Evidence boundary

Structural/semantic gates may prove exact digest equivalence for tested inputs, zero production-header global symbols, zero undefined symbols in ARM32 probes, actual NEON code generation under the exact ARM32 target flags, four parallel SHA-256 `u32` lanes per 128-bit vector, sixteen parallel transport `u8` lanes per 128-bit vector, and zero conditional loop branches in the full-unroll code-generation probe.

They do not prove physical cache behavior or a performance ratio. Until an exact-object physical device run binds object SHA, CPU identity, clock/governor, alignment, warm/cold protocol and repeated samples, physical ARM32 execution of the new hash specialization, cache miss rate, throughput ratio, physical DRAM bandwidth ratio, generalized 3x throughput/bandwidth and synchronized eight-core wall scaling remain `TOKEN_VAZIO`.

`claim_allowed=false` remains mandatory until those physical gates are satisfied.

# ARM32 NEON4096 strict freestanding core

## Scope

This document defines the strict ARMv7-A/NEON hot path in
`android/app/native/neon4096_armv7.S`. It is intentionally separate from the
hosted Frida desktop runtime and from `neon4096_core.c`.

The strict core has two entry points only:

- `rafaelia_neon4096_stage4096_armv7(dst, src)` stages one fixed 4096-byte page
  from a source region into a caller-provided calculation buffer.
- `rafaelia_neon4096_xor3_4096_armv7(dst, src0, src1, src2)` consumes three
  independent 4096-byte streams and writes their vector XOR into a
  caller-provided 4096-byte buffer.

Both functions return `void`. They allocate no memory and own no persistent
state.

## Hard invariants

The strict object is compiled as ARMv7-A EABI with NEON and is required to have:

- no `malloc`, heap, GC, libc, syscall, atomics, TLS, GOT/PLT, external call, or
  external undefined symbol;
- no call instruction and no stack push/pop in the hot-path assembly;
- no GPU/shadow route and no tail-call path;
- no global data or mutable process-wide state;
- exactly two hidden global ABI function symbols;
- fixed 4096-byte page geometry;
- 128-bit NEON vectors, giving 16 parallel `u8` lanes for each 128-bit vector
  ALU operation;
- 256 128-bit vectors per 4096-byte page;
- data-dependent branchless processing. The remaining `bne` is fixed-count
  loop control, not a data-dependent decision.

The build gate verifies the resulting object instead of inferring compliance
from source intent.

## 128 -> 4096 interpretation

NEON remains physically 128 bits wide on ARMv7-A. A single instruction does
not produce a 4096-byte physical vector. The implemented contract is therefore
page-level composition:

`128-bit vector lane -> repeated fixed vector operations -> 4096-byte page`

A 4096-byte page contains exactly 256 NEON vectors. This preserves the requested
128-to-4096 working geometry without making a false hardware-width claim.

## Cache and buffer orchestration

The assembly emits `pld` prefetch hints 256 bytes ahead of the current source
cursor and performs all writes into caller-provided buffers. The three-stream
kernel prefetches `src0`, `src1`, and `src2` independently before their NEON
loads.

`pld` is a microarchitectural hint, not a command that can guarantee cache
residency. Actual cache hit/miss behavior, memory bandwidth, and the best
prefetch distance depend on the physical ARM32 SoC and therefore require device
measurement.

The fixed page kernel now executes two consecutive four-transfer groups per loop
iteration. Each group advances 128 bytes and receives its own prefetch point, so
prefetch cadence remains one hint window per 128 processed bytes while loop
control is reduced from 32 to 16 iterations per 4096-byte page.

Therefore the structural geometry is:

`16 iterations x 256 bytes = 4096 bytes`

This reduces only fixed loop-control overhead. It is not promoted as a physical
throughput improvement until the exact object is benchmarked on the target
ARM32 device.

## Three-stream parallelism

`xor3_4096` exposes three independent input streams in the same hot loop. This
creates instruction-level independence and lets the ARM core overlap memory and
NEON work where its pipeline permits it. It does **not** prove three times the
physical throughput or memory bandwidth.

The XOR result reuses the source registers (`q0`/`q1`) rather than allocating a
separate result register set. This keeps the hot path register-local and avoids
adding a shadow result route.

For an eight-core target, page ranges may be statically partitioned by the
caller across cores. Core scheduling/affinity is deliberately outside this
freestanding object so the kernel acquires no OS or scheduler dependency.

## Build flags

The structural gate uses:

```text
--target=armv7a-none-eabi
-march=armv7-a
-mfpu=neon
-mfloat-abi=softfp
-ffreestanding
-fno-builtin
-fno-stack-protector
-fno-unwind-tables
-fno-asynchronous-unwind-tables
```

The assembly contains no sibling/tail calls, so no tail-call optimization is
present in the strict object.

## Evidence gate

Run:

```sh
bash .github/scripts/rafaelia/arm32-neon4096-freestanding-gate.sh
```

The gate emits `evidence/arm32-neon4096-freestanding/` containing ELF identity,
symbol table, section table, undefined-symbol report, SHA-256 identities and a
machine-readable receipt.

The v2 receipt additionally binds the fixed page geometry:

- `bytes_per_fixed_loop_iteration = 256`
- `fixed_loop_iterations_per_page = 16`
- `prefetch_cadence_bytes = 128`
- `loop_control_iteration_reduction_vs_v1 = 32_to_16`

A structural PASS proves only the object-level contract. It does not prove
physical performance.

## TOKEN_VAZIO gates

Until a physical ARM32 device run records reproducible measurements, these
remain explicitly open:

- `physical_arm32_execution = TOKEN_VAZIO`
- `cache_miss_rate = TOKEN_VAZIO`
- `throughput_ratio_vs_baseline = TOKEN_VAZIO`
- `bandwidth_ratio_vs_baseline = TOKEN_VAZIO`
- `three_x_throughput_claim = TOKEN_VAZIO`
- `eight_core_scaling = TOKEN_VAZIO`
- `claim_allowed = false`

Promotion requires device evidence with the exact object SHA-256, CPU identity,
clock policy, page alignment, warm/cold-cache protocol, repeated samples and a
baseline built from the same source revision.

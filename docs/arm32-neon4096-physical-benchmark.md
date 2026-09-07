# ARM32 NEON4096 physical benchmark boundary

## Purpose

This benchmark exists to convert the remaining ARM32 performance
`TOKEN_VAZIO` fields into reproducible device observations without adding a
timer, scheduler, allocator, libc dependency, or runtime dispatch to the strict
freestanding leaf.

The boundary is explicit:

```text
strict leaf
  android/app/native/neon4096_armv7.S
  no hosted dependencies
        |
        v
hosted measurement adapter
  tools/arm32-neon4096-physical-bench.c
  tools/arm32-neon4096-physical-bench.sh
  timing/output/device evidence only
```

A hosted benchmark dependency is not inherited by the leaf.

## What is measured

The adapter compares the exact ARMv7 three-stream leaf
`rafaelia_neon4096_xor3_4096_armv7()` against a same-semantics scalar C
baseline.

The scalar baseline is compiled by the device runner with:

```text
-fno-vectorize
-fno-slp-vectorize
```

so the baseline is not silently converted into another SIMD implementation.

Two conditions are emitted:

- `warm`: repeatedly processes the same 4096-byte source/output pages;
- `stream`: rotates across 256 independent 4096-byte page sets.

The default timed count is 65,536 page operations after a fixed 2,048-operation
warm-up.

Before timing, the adapter calculates the same page with scalar C and the NEON
leaf and compares every byte. Timing is aborted unless correctness is `PASS`.

## No-heap measurement storage

The adapter uses only compile-time static, 64-byte-aligned buffers:

```text
src0: 256 x 4096 bytes
src1: 256 x 4096 bytes
src2: 256 x 4096 bytes
dst : 256 x 4096 bytes
ref : 1 x 4096 bytes
```

No `malloc`, `calloc`, `realloc`, `free`, `aligned_alloc`, `posix_memalign`,
`mmap`, or `munmap` is present in the adapter source.

This no-heap property belongs to the benchmark code authored here. The hosted
OS/C runtime used for timing and text output is outside the freestanding leaf
contract and is not represented as a freestanding dependency.

## Metrics and non-equivalences

For each kernel and condition the adapter reports:

- elapsed monotonic time;
- logical page GB/s (`4096 bytes x operations / elapsed time`);
- declared software I/O GB/s, counting three page reads plus one page write;
- a sampled output guard;
- NEON/scalar time ratio for `warm` and `stream`.

The declared `3 read + 1 write` byte count is a software data-path accounting
quantity only.

It is **not** interchangeable with physical DRAM traffic because caches,
prefetching, write-back policy and memory-controller behavior can reduce or
reshape external memory transactions.

Therefore:

```text
logical_GBps != physical_DRAM_bandwidth
software_3read_1write_GBps != measured_memory_bus_GBps
single_run_ratio != general_3x_claim
```

The benchmark prints:

```text
cache_miss_rate=TOKEN_VAZIO
physical_dram_bandwidth=TOKEN_VAZIO
eight_core_scaling=TOKEN_VAZIO
claim_allowed=false
```

until independent evidence exists for those dimensions.

## Device execution

On the physical ARM32 Termux/device checkout:

```sh
bash tools/arm32-neon4096-physical-bench.sh
```

The runner:

1. refuses a non-ARM32 execution architecture;
2. compiles the strict assembly into its own object using ARMv7-A + NEON +
   softfp flags;
3. compiles the hosted benchmark with scalar vectorization disabled;
4. links only the benchmark adapter and the exact strict leaf object;
5. pins to `RAFAELIA_BENCH_CPU` with `taskset` when that tool exists;
6. records device metadata, results and SHA-256 identities;
7. emits `evidence/arm32-neon4096-physical-bench/receipt.json`.

Example for another single CPU:

```sh
RAFAELIA_BENCH_CPU=3 bash tools/arm32-neon4096-physical-bench.sh
```

If `taskset` is unavailable, the run is allowed for exploratory measurement but
its affinity remains `TOKEN_VAZIO` in the receipt.

## Evidence required for promotion

A single successful local run is evidence of physical execution of that exact
binary/object, but it is not enough to generalize performance.

For a performance claim, preserve at minimum:

- source revision;
- strict leaf object SHA-256;
- benchmark binary SHA-256;
- device/CPU identity;
- affinity state;
- clock/governor state when observable;
- repeated samples;
- scalar and NEON values from the same revision;
- thermal state or at least run-order/randomization notes;
- correctness result.

For cache-miss claims, add a provider/kernel-exposed hardware counter source and
record counter availability and permissions. Do not infer cache-miss rate from
wall-clock time.

For eight-core scaling, a separate synchronized multi-worker measurement is
required. This v1 adapter intentionally does not create threads or move
scheduler policy into the leaf.

## Structural CI gate

CI runs:

```sh
bash .github/scripts/rafaelia/arm32-neon4096-physical-bench-adapter-gate.sh
```

That gate verifies static-buffer/no-allocation source properties, compiles the
hosted adapter as an object, checks the physical runner flags, and reuses the
canonical strict-leaf gate.

CI success means the **measurement apparatus is structurally ready**. It does
not mean a physical ARM32 benchmark has occurred.

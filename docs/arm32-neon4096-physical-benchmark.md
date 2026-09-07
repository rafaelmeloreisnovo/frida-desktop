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
hosted measurement adapters
  tools/arm32-neon4096-physical-bench.c
  tools/arm32-neon4096-physical-bench.sh
  tools/arm32-neon4096-multicore-bench.sh
  timing/affinity/output/device evidence only
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

Two single-process conditions are emitted:

- `warm`: repeatedly processes the same 4096-byte source/output pages;
- `stream`: rotates across 256 independent 4096-byte page sets.

The default timed count is 65,536 page operations after a fixed 2,048-operation
warm-up.

Before timing, the adapter calculates the same page with scalar C and the NEON
leaf and compares every byte. Timing is aborted unless correctness is `PASS`.

## Compile-time worker specialization

The same C source has compile-time-only worker modes:

```text
-DRAFAELIA_BENCH_WORKER_ONLY=1
-DRAFAELIA_BENCH_SYNC_WORKER=1
```

`WORKER_ONLY` executes only the verified NEON `stream` measurement. `SYNC_WORKER`
adds a hosted post-warmup software barrier: the worker emits `ready=1`, flushes
stdout, blocks in `getchar()`, and starts its timed interval only after the
orchestrator releases it with one stdin byte.

There is no runtime algorithm selector in the hot loop. These modes exist so
external process orchestration can measure 1/2/4/8 pinned workers without
introducing pthreads, a scheduler API, timing logic, or another dispatch layer
into the strict freestanding leaf.

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

The multicore orchestrator additionally records, for each 1/2/4/8-worker wave:

- the legacy per-process throughput sum for compatibility and candidate analysis;
- minimum worker `start_ns` and maximum worker `end_ns` as one synchronized wall window;
- wall logical GB/s computed from total page work divided by that wall window;
- wall declared software-I/O GB/s;
- worker start skew (`max(start_ns) - min(start_ns)`).

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
process_sum_scaling != synchronized_wall_scaling
synchronized_wall_observation != generalized_device_claim
```

The benchmark keeps these explicit boundaries:

```text
cache_miss_rate=TOKEN_VAZIO
physical_dram_bandwidth=TOKEN_VAZIO
generalized_eight_core_scaling_claim=TOKEN_VAZIO_REPEATED_DEVICE_SERIES_REQUIRED
claim_allowed=false
```

until independent evidence exists for those dimensions.

## Single-CPU device execution

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

Example:

```sh
RAFAELIA_BENCH_CPU=3 bash tools/arm32-neon4096-physical-bench.sh
```

If `taskset` is unavailable, the run is allowed for exploratory measurement but
its affinity remains `TOKEN_VAZIO` in the receipt.

## 1/2/4/8-core synchronized wall experiment

For an ARM32 device exposing at least eight CPUs and `taskset`:

```sh
bash tools/arm32-neon4096-multicore-bench.sh
```

The multicore runner:

- compiles the strict leaf once, unchanged;
- compiles the C adapter as `NEON_STREAM_ONLY` plus synchronized-worker mode at compile time;
- launches waves of 1, 2, 4 and 8 independent processes;
- pins each worker to a distinct CPU from `RAFAELIA_BENCH_CORE_LIST`;
- lets every worker complete correctness and warm-up before the timed interval;
- waits until every worker in a wave has emitted `ready=1`;
- releases the whole ready set through hosted FIFO/stdin channels;
- verifies each worker result independently;
- preserves the prior per-process sum as candidate evidence;
- computes synchronized wall throughput from `max(end_ns) - min(start_ns)`;
- records start skew for auditability;
- preserves source/object/binary SHA-256 and per-worker raw outputs.

Default CPU list:

```text
0,1,2,3,4,5,6,7
```

It can be overridden without changing the leaf:

```sh
RAFAELIA_BENCH_CORE_LIST=0,2,4,6,1,3,5,7 \
  bash tools/arm32-neon4096-multicore-bench.sh
```

The prior compatibility artifact remains:

```text
evidence/arm32-neon4096-multicore-bench/process-sum.tsv
evidence/arm32-neon4096-multicore-bench/receipt.json
```

and is still typed as candidate process-sum evidence. The stronger synchronized
surface is additive:

```text
evidence/arm32-neon4096-multicore-bench/synchronized-wall.tsv
evidence/arm32-neon4096-multicore-bench/synchronized-wall-receipt.json
```

The synchronized receipt may contain a measured 1/2/4/8 wall-scaling observation
for that exact binary/device/run. It deliberately keeps generalized performance
promotion disabled:

```text
generalized_eight_core_scaling_claim=TOKEN_VAZIO_REPEATED_DEVICE_SERIES_REQUIRED
three_x_throughput_general_claim=NOT_PROMOTED
claim_allowed=false
```

This preserves the distinction between one physical observation and a stable
claim across devices, thermal states, governors or repeated series.

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
- correctness result;
- synchronized wall interval and start skew for multicore runs.

For cache-miss claims, add a provider/kernel-exposed hardware counter source and
record counter availability and permissions. Do not infer cache-miss rate from
wall-clock time.

For generalized eight-core scaling, repeat the synchronized 1/2/4/8 waves under
equivalent thermal and governor conditions and retain the complete series. Until
that exists, the synchronized wall value is an observation, not a promoted
cross-run claim.

## Structural CI gate

CI runs:

```sh
bash .github/scripts/rafaelia/arm32-neon4096-physical-bench-adapter-gate.sh
```

That gate verifies static-buffer/no-allocation source properties, compiles the
full adapter, the worker specialization and the synchronized-worker
specialization as hosted objects, checks the physical runner and multicore
orchestration contracts, and reuses the canonical strict-leaf gate.

CI success means the **measurement apparatus is structurally ready**. It does
not mean a physical ARM32 benchmark has occurred.

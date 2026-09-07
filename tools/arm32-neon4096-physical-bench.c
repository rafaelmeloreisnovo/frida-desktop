#define _POSIX_C_SOURCE 200809L

#include <stdint.h>
#include <stdio.h>
#include <time.h>

#include "neon4096_freestanding.h"

#ifndef CLOCK_MONOTONIC_RAW
#define CLOCK_MONOTONIC_RAW CLOCK_MONOTONIC
#endif

#ifndef RAFAELIA_BENCH_PAGES
#define RAFAELIA_BENCH_PAGES 256u
#endif

#ifndef RAFAELIA_BENCH_ROUNDS
#define RAFAELIA_BENCH_ROUNDS 65536u
#endif

#ifndef RAFAELIA_BENCH_WARMUP
#define RAFAELIA_BENCH_WARMUP 2048u
#endif

#ifndef RAFAELIA_BENCH_WORKER_ONLY
#define RAFAELIA_BENCH_WORKER_ONLY 0
#endif

#if (RAFAELIA_BENCH_PAGES & (RAFAELIA_BENCH_PAGES - 1u)) != 0
#error RAFAELIA_BENCH_PAGES must be a power of two
#endif

#define RFS_PAGE RAFAELIA_NEON4096_FS_PAGE_BYTES
#define RFS_MASK (RAFAELIA_BENCH_PAGES - 1u)

#if defined(__GNUC__) || defined(__clang__)
#define RFS_NOINLINE __attribute__((noinline))
#else
#define RFS_NOINLINE
#endif

typedef void (*rfs_xor3_fn)(void *, const void *, const void *, const void *);

_Alignas(64) static uint8_t rfs_a[RAFAELIA_BENCH_PAGES][RFS_PAGE];
_Alignas(64) static uint8_t rfs_b[RAFAELIA_BENCH_PAGES][RFS_PAGE];
_Alignas(64) static uint8_t rfs_c[RAFAELIA_BENCH_PAGES][RFS_PAGE];
_Alignas(64) static uint8_t rfs_d[RAFAELIA_BENCH_PAGES][RFS_PAGE];
_Alignas(64) static uint8_t rfs_ref[RFS_PAGE];

static RFS_NOINLINE void
rfs_scalar(void *dst, const void *a, const void *b, const void *c)
{
  uint8_t *d = (uint8_t *) dst;
  const uint8_t *x = (const uint8_t *) a;
  const uint8_t *y = (const uint8_t *) b;
  const uint8_t *z = (const uint8_t *) c;
  uint32_t i = 0;

  while (i != RFS_PAGE) {
    d[i] = (uint8_t) (x[i] ^ y[i] ^ z[i]);
    i++;
  }
}

static rfs_xor3_fn volatile rfs_scalar_entry = rfs_scalar;

static uint64_t
rfs_now_ns(void)
{
  struct timespec t;

  if (clock_gettime(CLOCK_MONOTONIC_RAW, &t) != 0)
    return 0;

  return ((uint64_t) t.tv_sec * UINT64_C(1000000000)) + (uint64_t) t.tv_nsec;
}

static void
rfs_fill(void)
{
  uint32_t p = 0;
  uint32_t s0 = UINT32_C(0x13579bdf);
  uint32_t s1 = UINT32_C(0x2468ace1);
  uint32_t s2 = UINT32_C(0x9e3779b9);

  while (p != RAFAELIA_BENCH_PAGES) {
    uint32_t i = 0;
    while (i != RFS_PAGE) {
      s0 = (s0 * UINT32_C(1664525)) + UINT32_C(1013904223);
      s1 = (s1 * UINT32_C(22695477)) + UINT32_C(1);
      s2 ^= s2 << 13;
      s2 ^= s2 >> 17;
      s2 ^= s2 << 5;
      rfs_a[p][i] = (uint8_t) (s0 >> 24);
      rfs_b[p][i] = (uint8_t) (s1 >> 24);
      rfs_c[p][i] = (uint8_t) (s2 >> 24);
      rfs_d[p][i] = 0;
      i++;
    }
    p++;
  }
}

static int
rfs_verify(void)
{
  uint32_t i = 0;

  rfs_scalar_entry(rfs_ref, rfs_a[0], rfs_b[0], rfs_c[0]);
  rafaelia_neon4096_xor3_4096_armv7(rfs_d[0], rfs_a[0], rfs_b[0], rfs_c[0]);

  while (i != RFS_PAGE) {
    if (rfs_ref[i] != rfs_d[0][i])
      return 0;
    i++;
  }

  return 1;
}

static uint64_t
rfs_guard(uint32_t page)
{
  uint64_t x = UINT64_C(0xcbf29ce484222325);
  uint32_t i = 0;

  while (i != RFS_PAGE) {
    x ^= (uint64_t) rfs_d[page][i];
    x *= UINT64_C(0x100000001b3);
    i += 64u;
  }

  return x;
}

#if !RAFAELIA_BENCH_WORKER_ONLY
static uint64_t
rfs_warm(rfs_xor3_fn fn, uint32_t rounds)
{
  uint32_t i = 0;
  uint64_t a;
  uint64_t b;

  while (i != RAFAELIA_BENCH_WARMUP) {
    fn(rfs_d[0], rfs_a[0], rfs_b[0], rfs_c[0]);
    i++;
  }

  a = rfs_now_ns();
  i = 0;
  while (i != rounds) {
    fn(rfs_d[0], rfs_a[0], rfs_b[0], rfs_c[0]);
    i++;
  }
  b = rfs_now_ns();

  return (a == 0 || b <= a) ? 0 : b - a;
}
#endif

static uint64_t
rfs_stream(rfs_xor3_fn fn, uint32_t rounds)
{
  uint32_t i = 0;
  uint64_t a;
  uint64_t b;

  while (i != RAFAELIA_BENCH_WARMUP) {
    uint32_t p = i & RFS_MASK;
    fn(rfs_d[p], rfs_a[p], rfs_b[p], rfs_c[p]);
    i++;
  }

  a = rfs_now_ns();
  i = 0;
  while (i != rounds) {
    uint32_t p = i & RFS_MASK;
    fn(rfs_d[p], rfs_a[p], rfs_b[p], rfs_c[p]);
    i++;
  }
  b = rfs_now_ns();

  return (a == 0 || b <= a) ? 0 : b - a;
}

static void
rfs_emit(const char *kernel, const char *mode, uint64_t ns, uint32_t rounds,
         uint64_t guard)
{
  const double logical_bytes = (double) rounds * (double) RFS_PAGE;
  const double declared_io_bytes = logical_bytes * 4.0;
  const double logical_gbps = ns == 0 ? 0.0 : logical_bytes / (double) ns;
  const double declared_io_gbps = ns == 0 ? 0.0 : declared_io_bytes / (double) ns;

  printf("%s,%s,%u,%u,%llu,%.6f,%.6f,%016llx\n",
      kernel,
      mode,
      (unsigned int) rounds,
      (unsigned int) RFS_PAGE,
      (unsigned long long) ns,
      logical_gbps,
      declared_io_gbps,
      (unsigned long long) guard);
}

#if RAFAELIA_BENCH_WORKER_ONLY
int
main(void)
{
  uint64_t ns;
  uint32_t final_page;

  rfs_fill();
  if (!rfs_verify()) {
    puts("correctness=FAIL");
    return 2;
  }

  ns = rfs_stream(rafaelia_neon4096_xor3_4096_armv7, RAFAELIA_BENCH_ROUNDS);
  if (ns == 0) {
    puts("timing=FAIL");
    return 3;
  }

  final_page = (RAFAELIA_BENCH_ROUNDS - 1u) & RFS_MASK;
  puts("correctness=PASS");
  puts("worker_mode=NEON_STREAM_ONLY_COMPILE_TIME");
  puts("kernel,mode,rounds,page_bytes,elapsed_ns,logical_GBps,declared_3read_1write_GBps,guard");
  rfs_emit("neon", "stream", ns, RAFAELIA_BENCH_ROUNDS, rfs_guard(final_page));
  puts("cache_miss_rate=TOKEN_VAZIO");
  puts("physical_dram_bandwidth=TOKEN_VAZIO");
  puts("claim_allowed=false");
  return 0;
}
#else
int
main(void)
{
  uint64_t sw;
  uint64_t nw;
  uint64_t ss;
  uint64_t ns;
  uint32_t final_page;

  rfs_fill();

  if (!rfs_verify()) {
    puts("correctness=FAIL");
    return 2;
  }

  puts("correctness=PASS");
  printf("page_bytes=%u\n", (unsigned int) RFS_PAGE);
  printf("pages=%u\n", (unsigned int) RAFAELIA_BENCH_PAGES);
  printf("rounds=%u\n", (unsigned int) RAFAELIA_BENCH_ROUNDS);
  puts("baseline=scalar_c_compiled_with_vectorization_disabled_by_runner");
  puts("cache_miss_rate=TOKEN_VAZIO");
  puts("physical_dram_bandwidth=TOKEN_VAZIO");
  puts("eight_core_scaling=TOKEN_VAZIO");
  puts("kernel,mode,rounds,page_bytes,elapsed_ns,logical_GBps,declared_3read_1write_GBps,guard");

  sw = rfs_warm(rfs_scalar_entry, RAFAELIA_BENCH_ROUNDS);
  rfs_emit("scalar", "warm", sw, RAFAELIA_BENCH_ROUNDS, rfs_guard(0));

  nw = rfs_warm(rafaelia_neon4096_xor3_4096_armv7, RAFAELIA_BENCH_ROUNDS);
  rfs_emit("neon", "warm", nw, RAFAELIA_BENCH_ROUNDS, rfs_guard(0));

  ss = rfs_stream(rfs_scalar_entry, RAFAELIA_BENCH_ROUNDS);
  final_page = (RAFAELIA_BENCH_ROUNDS - 1u) & RFS_MASK;
  rfs_emit("scalar", "stream", ss, RAFAELIA_BENCH_ROUNDS, rfs_guard(final_page));

  ns = rfs_stream(rafaelia_neon4096_xor3_4096_armv7, RAFAELIA_BENCH_ROUNDS);
  rfs_emit("neon", "stream", ns, RAFAELIA_BENCH_ROUNDS, rfs_guard(final_page));

  if (sw == 0 || nw == 0 || ss == 0 || ns == 0) {
    puts("timing=FAIL");
    return 3;
  }

  printf("ratio_neon_vs_scalar_warm=%.6f\n", (double) sw / (double) nw);
  printf("ratio_neon_vs_scalar_stream=%.6f\n", (double) ss / (double) ns);
  puts("three_x_throughput_claim=MEASURED_RATIO_ONLY_NOT_GENERALIZED");
  puts("claim_allowed=false");

  return 0;
}
#endif

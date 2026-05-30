/*
 * Hosted benchmark harness for ChipQuantum basic commands.
 *
 * This file intentionally lives outside the default build.  Compile it together
 * with chipquantum-basic-commands.c to measure the real primitive code paths on
 * a workstation before moving evidence into a target-specific profile.
 */

#include <stdint.h>
#include <stdio.h>
#include <time.h>

#define CQ_BENCH_MAX_BYTES 4096u
#define CQ_BENCH_REPEAT 5000u
#define CQ_TORUS_DIMENSIONS 7u

struct cq_torus7 {
  uint16_t lane[CQ_TORUS_DIMENSIONS];
};

struct cq_frame {
  const uint8_t *data;
  size_t length;
  uint16_t entropy_milli;
  uint32_t state;
};

uint8_t cq_xor_accumulate(const uint8_t *data, size_t length);
uint64_t cq_fnv1a64(const uint8_t *data, size_t length);
uint32_t cq_crc32_basic(const uint8_t *data, size_t length);
uint16_t cq_entropy_milli(const uint8_t *data, size_t length);
struct cq_torus7 cq_toroidal_map(const struct cq_frame *frame);

static void
cq_fill_sensor_payload(uint8_t *data, size_t length, uint32_t seed)
{
  size_t index = 0;
  uint32_t state = seed;

  while (index != length) {
    state = (state * 1664525u) + 1013904223u;
    data[index] = (uint8_t) (state >> 24);
    index++;
  }
}

static double
cq_elapsed_ms(clock_t begin, clock_t end)
{
  return ((double) (end - begin) * 1000.0) / (double) CLOCKS_PER_SEC;
}

int
main(void)
{
  static uint8_t payload[CQ_BENCH_MAX_BYTES];
  const size_t sizes[] = { 32u, 128u, 1024u, CQ_BENCH_MAX_BYTES };
  size_t size_index = 0;
  uint64_t guard = 0;

  printf("size,repeat,entropy_milli,xor_ms,fnv1a_ms,crc32_ms,toroidal_ms,guard\n");

  while (size_index != sizeof(sizes) / sizeof(sizes[0])) {
    size_t length = sizes[size_index];
    uint16_t entropy;
    clock_t begin;
    clock_t end;
    double xor_ms;
    double fnv_ms;
    double crc_ms;
    double torus_ms;
    unsigned int repeat;

    cq_fill_sensor_payload(payload, length, 0x43485100u + (uint32_t) length);
    entropy = cq_entropy_milli(payload, length);

    begin = clock();
    repeat = 0;
    while (repeat != CQ_BENCH_REPEAT) {
      guard ^= cq_xor_accumulate(payload, length);
      repeat++;
    }
    end = clock();
    xor_ms = cq_elapsed_ms(begin, end);

    begin = clock();
    repeat = 0;
    while (repeat != CQ_BENCH_REPEAT) {
      guard ^= cq_fnv1a64(payload, length);
      repeat++;
    }
    end = clock();
    fnv_ms = cq_elapsed_ms(begin, end);

    begin = clock();
    repeat = 0;
    while (repeat != CQ_BENCH_REPEAT) {
      guard ^= cq_crc32_basic(payload, length);
      repeat++;
    }
    end = clock();
    crc_ms = cq_elapsed_ms(begin, end);

    begin = clock();
    repeat = 0;
    while (repeat != CQ_BENCH_REPEAT) {
      struct cq_frame frame;
      struct cq_torus7 torus;

      frame.data = payload;
      frame.length = length;
      frame.entropy_milli = entropy;
      frame.state = (uint32_t) (0x9e3779b9u + repeat + length);
      torus = cq_toroidal_map(&frame);
      guard ^= torus.lane[repeat % CQ_TORUS_DIMENSIONS];
      repeat++;
    }
    end = clock();
    torus_ms = cq_elapsed_ms(begin, end);

    printf("%lu,%u,%u,%.3f,%.3f,%.3f,%.3f,%llu\n",
        (unsigned long) length,
        (unsigned int) CQ_BENCH_REPEAT,
        (unsigned int) entropy,
        xor_ms,
        fnv_ms,
        crc_ms,
        torus_ms,
        (unsigned long long) guard);

    size_index++;
  }

  return guard == 0xffffffffffffffffull ? 1 : 0;
}

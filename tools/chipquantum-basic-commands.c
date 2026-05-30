/*
 * ChipQuantum basic command primitives for constrained diagnostics.
 *
 * This standalone translation unit is intentionally small and deterministic:
 * no heap allocation, no recursion, no runtime tables, and no dependency on
 * hosted Frida layers.  Build with -DCQ_BASIC_COMMANDS_SELFTEST to run the
 * built-in diagnostic main() on a hosted machine.
 */

#include <stddef.h>
#include <stdint.h>

#define CQ_TORUS_DIMENSIONS 7u
#define CQ_ATTRACTOR_STATES 42u
#define CQ_ALPHA_NUMERATOR 1u
#define CQ_ALPHA_DENOMINATOR 4u
#define CQ_Q16_ONE 65535u
#define CQ_FNV1A_OFFSET 14695981039346656037ull
#define CQ_FNV1A_PRIME 1099511628211ull
#define CQ_CRC32_POLY 0xedb88320u
#define CQ_SPIRAL_RATIO_MILLI 866u

struct cq_torus7 {
  uint16_t lane[CQ_TORUS_DIMENSIONS];
};

struct cq_frame {
  const uint8_t *data;
  size_t length;
  uint16_t entropy_milli;
  uint32_t state;
};

static uint16_t
cq_fold16_from64(uint64_t value)
{
  value ^= value >> 32;
  value ^= value >> 16;
  return (uint16_t) value;
}

uint8_t
cq_xor_accumulate(const uint8_t *data, size_t length)
{
  uint8_t acc = 0;
  size_t index = 0;

  while (index != length) {
    acc ^= data[index];
    index++;
  }

  return acc;
}

uint64_t
cq_fnv1a64(const uint8_t *data, size_t length)
{
  uint64_t hash = CQ_FNV1A_OFFSET;
  size_t index = 0;

  while (index != length) {
    hash ^= data[index];
    hash *= CQ_FNV1A_PRIME;
    index++;
  }

  return hash;
}

uint32_t
cq_crc32_basic(const uint8_t *data, size_t length)
{
  uint32_t crc = 0xffffffffu;
  size_t index = 0;

  while (index != length) {
    uint32_t byte_value = data[index];
    uint32_t bit = 0;

    crc ^= byte_value;
    while (bit != 8u) {
      uint32_t mask = (uint32_t) (0u - (crc & 1u));
      crc = (crc >> 1) ^ (CQ_CRC32_POLY & mask);
      bit++;
    }

    index++;
  }

  return ~crc;
}

uint16_t
cq_entropy_milli(const uint8_t *data, size_t length)
{
  uint8_t seen[256] = { 0 };
  uint32_t unique = 0;
  uint32_t transitions = 0;
  size_t index = 0;

  if (length == 0)
    return 0;

  while (index != length) {
    uint8_t byte_value = data[index];

    if (seen[byte_value] == 0) {
      seen[byte_value] = 1;
      unique++;
    }

    if (index != 0 && data[index - 1] != byte_value)
      transitions++;

    index++;
  }

  return (uint16_t) ((unique * 6000u) / 256u +
      ((length > 1) ? ((transitions * 2000u) / (uint32_t) (length - 1u)) : 0u));
}

uint16_t
cq_coherence_step_q16(uint16_t current_q16, uint16_t input_q16)
{
  uint32_t retained = (uint32_t) current_q16 *
      (CQ_ALPHA_DENOMINATOR - CQ_ALPHA_NUMERATOR);
  uint32_t incoming = (uint32_t) input_q16 * CQ_ALPHA_NUMERATOR;

  return (uint16_t) ((retained + incoming) / CQ_ALPHA_DENOMINATOR);
}

uint16_t
cq_phi_q16(uint16_t coherence_q16, uint16_t entropy_q16)
{
  uint32_t inverse_entropy = CQ_Q16_ONE - entropy_q16;
  return (uint16_t) ((inverse_entropy * (uint32_t) coherence_q16) / CQ_Q16_ONE);
}

uint32_t
cq_orbit42(uint64_t hash, uint16_t entropy_milli, uint32_t state)
{
  return (uint32_t) ((hash ^ ((uint64_t) entropy_milli << 32) ^ state) %
      CQ_ATTRACTOR_STATES);
}

uint32_t
cq_spiral_milli(unsigned int n)
{
  uint32_t radius_milli = 1000u;
  unsigned int step = 0;

  while (step != n) {
    radius_milli = (radius_milli * CQ_SPIRAL_RATIO_MILLI) / 1000u;
    step++;
  }

  return radius_milli;
}

struct cq_torus7
cq_toroidal_map(const struct cq_frame *frame)
{
  struct cq_torus7 result;
  uint64_t hash = cq_fnv1a64(frame->data, frame->length);
  uint32_t crc = cq_crc32_basic(frame->data, frame->length);
  uint8_t acc = cq_xor_accumulate(frame->data, frame->length);
  uint32_t orbit = cq_orbit42(hash, frame->entropy_milli, frame->state);
  uint16_t entropy_q16 = (uint16_t) (((uint32_t) frame->entropy_milli * CQ_Q16_ONE) / 8000u);
  uint16_t coherence_q16 = cq_coherence_step_q16(cq_fold16_from64(hash), (uint16_t) crc);
  uint16_t phi_q16 = cq_phi_q16(coherence_q16, entropy_q16);

  result.lane[0] = cq_fold16_from64(hash);
  result.lane[1] = (uint16_t) crc;
  result.lane[2] = (uint16_t) ((crc >> 16) ^ ((uint32_t) acc << 8));
  result.lane[3] = entropy_q16;
  result.lane[4] = coherence_q16;
  result.lane[5] = phi_q16;
  result.lane[6] = (uint16_t) (((orbit * CQ_Q16_ONE) / CQ_ATTRACTOR_STATES) ^
      (frame->state & 0xffffu));

  return result;
}

#ifdef CQ_BASIC_COMMANDS_SELFTEST
#include <stdio.h>

static int
cq_expect_u64(const char *label, uint64_t actual, uint64_t expected)
{
  if (actual == expected)
    return 0;

  printf("FAIL %s: got %llu expected %llu\n", label,
      (unsigned long long) actual, (unsigned long long) expected);
  return 1;
}

int
main(void)
{
  const uint8_t sample[] = { 'T', 'o', 'r', 'u', 's', '4', '2' };
  struct cq_frame frame;
  struct cq_torus7 mapped;
  int failures = 0;

  frame.data = sample;
  frame.length = sizeof(sample);
  frame.entropy_milli = cq_entropy_milli(sample, sizeof(sample));
  frame.state = 0x12345678u;
  mapped = cq_toroidal_map(&frame);

  failures += cq_expect_u64("xor", cq_xor_accumulate(sample, sizeof(sample)), 73u);
  failures += cq_expect_u64("fnv1a", cq_fnv1a64(sample, sizeof(sample)), 15840314119516940480ull);
  failures += cq_expect_u64("crc32", cq_crc32_basic(sample, sizeof(sample)), 1240283178u);
  failures += cq_expect_u64("entropy", frame.entropy_milli, 2164u);
  failures += cq_expect_u64("coherence", cq_coherence_step_q16(40000u, 8000u), 32000u);
  failures += cq_expect_u64("phi", cq_phi_q16(32000u, 10000u), 27117u);
  failures += cq_expect_u64("orbit", cq_orbit42(cq_fnv1a64(sample, sizeof(sample)), frame.entropy_milli, frame.state), 2u);
  failures += cq_expect_u64("spiral", cq_spiral_milli(3u), 648u);
  failures += cq_expect_u64("lane0", mapped.lane[0], 35513u);
  failures += cq_expect_u64("lane6", mapped.lane[6], 23112u);

  if (failures != 0)
    return 1;

  printf("PASS: ChipQuantum basic commands map %u lanes into 42-state orbit %lu\n",
      (unsigned int) CQ_TORUS_DIMENSIONS,
      (unsigned long) cq_orbit42(cq_fnv1a64(sample, sizeof(sample)), frame.entropy_milli, frame.state));
  return 0;
}
#endif

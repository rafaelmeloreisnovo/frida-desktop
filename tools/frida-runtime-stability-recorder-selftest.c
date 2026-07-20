#include "frida-runtime-stability-recorder.h"

static int
expect(int condition, int code)
{
  return condition ? 0 : code;
}

int
main(void)
{
  struct frida_rs_silicon_profile profile = {
    FRIDA_RS_SILICON_PROFILE_VERSION,
    FRIDA_RS_ARCH_ARM32 | FRIDA_RS_ARCH_NEON,
    32u,
    4096u,
    64u,
    0x1234u,
    0x5678u,
    0x41u
  };
  struct frida_rs_policy policy = {
    FRIDA_RS_DEFAULT_DELTA_TRIGGER_Q16,
    4096u,
    2u,
    8u,
    0u,
    0u
  };
  struct frida_rs_state state;
  struct frida_rs_state rejected;
  struct frida_rs_input input;
  struct frida_rs_record output[8];
  struct frida_dca_signal signal;
  size_t drained;
  uint64_t tag;
  uint32_t index;
  int rc;

  tag = frida_rs_silicon_tag(&profile);
  rc = expect(tag != 0u, 1);
  if (rc != 0)
    return rc;

  rc = frida_rs_init(&state, &profile, &policy);
  if (rc != 0)
    return 2;

  input.stream_id = 7u;
  input.peer_tag = 0xABCDEFu;
  input.pid = 100u;
  input.tid = 101u;
  input.descriptor = 9u;
  input.byte_count = 128u;
  input.latency_ns = 1000u;
  input.flags = 0u;
  input.kind = FRIDA_RS_EVENT_NET_READ;
  input.gc_pressure_q16 = 0u;

  for (index = 0u; index != 6u; index++) {
    input.monotonic_ns = UINT64_C(100000000) * (index + 1u);
    rc = expect(frida_rs_observe(&state, &policy, &input) ==
        FRIDA_RS_DECISION_STABLE, 3);
    if (rc != 0)
      return rc;
  }

  rc = expect(state.readable_count == 0u, 4);
  if (rc != 0)
    return rc;

  for (index = 0u; index != 4u; index++) {
    input.monotonic_ns += 100000u;
    input.kind = (index & 1u) != 0u ? FRIDA_RS_EVENT_NET_READ :
        FRIDA_RS_EVENT_NET_WRITE;
    input.gc_pressure_q16 = 60000u;
    input.latency_ns = 4500000u;
    input.flags = FRIDA_RS_FLAG_GC_NEARBY |
        FRIDA_RS_FLAG_WEB_BOUNDARY |
        FRIDA_RS_FLAG_DIRECTION_CHANGE;
    (void) frida_rs_observe(&state, &policy, &input);
  }

  rc = expect(state.readable_count != 0u, 5);
  if (rc != 0)
    return rc;

  drained = frida_rs_drain(&state, output, 8u);
  rc = expect(drained != 0u, 6);
  if (rc != 0)
    return rc;
  rc = expect(output[0].decision == FRIDA_RS_DECISION_DUMP, 7);
  if (rc != 0)
    return rc;
  rc = expect((output[0].flags & FRIDA_RS_FLAG_TRIGGERED) != 0u, 8);
  if (rc != 0)
    return rc;
  rc = expect(output[0].chain_hash != 0u, 9);
  if (rc != 0)
    return rc;

  frida_rs_make_dca_signal(&state,
      FRIDA_RS_ARCH_ARM32 | FRIDA_RS_ARCH_NEON, 512u,
      FRIDA_DCA_ROUTE_GENERIC, &signal);
  rc = expect((signal.arch_flags & FRIDA_DCA_ARCH_ARM32) != 0u, 10);
  if (rc != 0)
    return rc;
  rc = expect((signal.arch_flags & FRIDA_DCA_ARCH_NEON) != 0u, 11);
  if (rc != 0)
    return rc;

  policy.expected_silicon_tag = tag ^ UINT64_C(1);
  rc = expect(frida_rs_init(&rejected, &profile, &policy) == -3, 12);
  if (rc != 0)
    return rc;

  frida_rs_reset_epoch(&state);
  rc = expect(state.silicon_tag == tag, 13);
  if (rc != 0)
    return rc;
  rc = expect(state.readable_count == 0u, 14);
  if (rc != 0)
    return rc;

  return 0;
}

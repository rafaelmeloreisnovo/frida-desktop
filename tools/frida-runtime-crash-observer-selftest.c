#include "frida-runtime-crash-observer.h"

static int
expect(int condition, int code)
{
  return condition ? 0 : code;
}

int
main(void)
{
  struct frida_rco_state state;
  struct frida_rco_input input = {0};
  struct frida_rco_record output[4];
  size_t drained;
  int rc;

  frida_rco_init(&state);

  input.monotonic_ns = UINT64_C(1000000000);
  input.package_tag = UINT64_C(0x1111);
  input.process_tag = UINT64_C(0x2222);
  input.correlation_id = UINT64_C(1);
  input.pc = UINT64_C(0x1000);
  input.sp = UINT64_C(0x2000);
  input.fault_address = UINT64_C(0x3000);
  input.pid = 100u;
  input.tid = 101u;
  input.uid = 10200u;
  input.status = 11u;
  input.reason = 1u;
  input.flags = FRIDA_RCO_SOURCE_FRIDA_NATIVE | FRIDA_RCO_FLAG_FATAL;
  input.kind = FRIDA_RCO_EVENT_NATIVE_EXCEPTION;

  rc = expect(frida_rco_record_event(&state, &input) == 0, 1);
  if (rc != 0)
    return rc;
  rc = expect(state.observed_count == 1u, 2);
  if (rc != 0)
    return rc;
  rc = expect(state.readable_count == 1u, 3);
  if (rc != 0)
    return rc;

  input.monotonic_ns += UINT64_C(1000000);
  input.correlation_id++;
  input.pc = 0u;
  input.sp = 0u;
  input.fault_address = 0u;
  input.status = 0u;
  input.reason = 3u;
  input.flags = FRIDA_RCO_SOURCE_ADB_EVENTS | FRIDA_RCO_FLAG_IME;
  input.kind = FRIDA_RCO_EVENT_IME_PROCESS_EXIT;

  rc = expect(frida_rco_record_event(&state, &input) == 0, 4);
  if (rc != 0)
    return rc;

  drained = frida_rco_drain(&state, output, 4u);
  rc = expect(drained == 2u, 5);
  if (rc != 0)
    return rc;
  rc = expect(output[0].kind == FRIDA_RCO_EVENT_NATIVE_EXCEPTION, 6);
  if (rc != 0)
    return rc;
  rc = expect(output[1].kind == FRIDA_RCO_EVENT_IME_PROCESS_EXIT, 7);
  if (rc != 0)
    return rc;
  rc = expect(output[0].chain_hash != 0u, 8);
  if (rc != 0)
    return rc;
  rc = expect(output[1].chain_hash != output[0].chain_hash, 9);
  if (rc != 0)
    return rc;
  rc = expect((output[1].flags & FRIDA_RCO_FLAG_TRIGGERED) != 0u, 10);
  if (rc != 0)
    return rc;

  input.monotonic_ns -= UINT64_C(2000000);
  rc = expect(frida_rco_record_event(&state, &input) == -3, 11);
  if (rc != 0)
    return rc;
  rc = expect(state.rejected_count == 1u, 12);
  if (rc != 0)
    return rc;

  frida_rco_reset_epoch(&state);
  rc = expect(state.readable_count == 0u, 13);
  if (rc != 0)
    return rc;
  rc = expect(state.observed_count == 2u, 14);
  if (rc != 0)
    return rc;
  rc = expect(state.rejected_count == 1u, 15);
  if (rc != 0)
    return rc;

  return 0;
}

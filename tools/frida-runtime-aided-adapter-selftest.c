#include "frida-runtime-aided-adapter.h"

#include <assert.h>
#include <string.h>

int main(void) {
  struct frida_raa_event event;
  struct frida_rs_input out;

  memset(&event, 0, sizeof(event));
  memset(&out, 0, sizeof(out));

  event.monotonic_ns = 42u;
  event.pid = 100u;
  event.tid = 101u;
  event.descriptor = 7;
  event.operation = FRIDA_RAA_RECV;
  event.byte_count = 512u;
  event.latency_us = 18u;
  event.pressure_q16 = 70000u;
  event.stream_tag = 0x1234u;

  assert(frida_raa_translate(&event, &out) == 0);
  assert(out.kind == FRIDA_RS_EVENT_NET_READ);
  assert(out.byte_count == 512u);
  assert(out.latency_ns == 18000u);
  assert(out.gc_pressure_q16 == FRIDA_RS_Q16_ONE);
  assert(out.stream_id == 0x1234u);

  event.operation = 0xffffffffu;
  assert(frida_raa_translate(&event, &out) == -2);
  assert(frida_raa_translate(NULL, &out) == -1);
  assert(frida_raa_translate(&event, NULL) == -1);

  return 0;
}

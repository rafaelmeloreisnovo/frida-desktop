#include "frida-runtime-aided-adapter.h"

#include <assert.h>
#include <string.h>

static void reset(struct frida_raa_event *event, struct frida_rs_input *out) {
  memset(event, 0, sizeof(*event));
  memset(out, 0, sizeof(*out));
  event->monotonic_ns = 42u;
  event->pid = 100u;
  event->tid = 101u;
  event->descriptor = 7;
  event->byte_count = 512u;
  event->latency_us = 18u;
  event->pressure_q16 = 70000u;
  event->stream_tag = 0x1234u;
  event->peer_tag = 0x5678u;
}

int main(void) {
  struct frida_raa_event event;
  struct frida_rs_input out;

  reset(&event, &out);
  event.operation = FRIDA_RAA_RECV;
  assert(frida_raa_translate(&event, &out) == FRIDA_RAA_OK);
  assert(out.kind == FRIDA_RS_EVENT_NET_READ);
  assert(out.byte_count == 512u);
  assert(out.latency_ns == 18000u);
  assert(out.gc_pressure_q16 == FRIDA_RS_Q16_ONE);
  assert(out.stream_id == 0x1234u);
  assert(out.peer_tag == 0x5678u);

  event.operation = FRIDA_RAA_IPC_READ;
  assert(frida_raa_translate(&event, &out) == FRIDA_RAA_OK);
  assert(out.kind == FRIDA_RS_EVENT_IPC_READ);
  assert((out.flags & FRIDA_RS_FLAG_IPC_BOUNDARY) != 0u);

  event.operation = FRIDA_RAA_GC_BEGIN;
  event.descriptor = -1;
  assert(frida_raa_translate(&event, &out) == FRIDA_RAA_OK);
  assert(out.kind == FRIDA_RS_EVENT_GC_BEGIN);

  event.operation = FRIDA_RAA_WEB_EXIT;
  assert(frida_raa_translate(&event, &out) == FRIDA_RAA_OK);
  assert(out.kind == FRIDA_RS_EVENT_WEB_EXIT);

  event.operation = FRIDA_RAA_READ;
  event.descriptor = -1;
  assert(frida_raa_translate(&event, &out) == FRIDA_RAA_ERR_DESCRIPTOR);

  reset(&event, &out);
  event.monotonic_ns = 0u;
  event.operation = FRIDA_RAA_RECV;
  assert(frida_raa_translate(&event, &out) == FRIDA_RAA_ERR_TIME);

  reset(&event, &out);
  event.operation = 0xffffffffu;
  assert(frida_raa_translate(&event, &out) == FRIDA_RAA_ERR_OPERATION);
  assert(frida_raa_translate(NULL, &out) == FRIDA_RAA_ERR_NULL);
  assert(frida_raa_translate(&event, NULL) == FRIDA_RAA_ERR_NULL);

  return 0;
}

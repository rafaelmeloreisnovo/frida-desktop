#include "frida-runtime-aided-adapter.h"

#include <limits.h>
#include <stddef.h>

static uint32_t frida_raa_latency_ns(uint32_t latency_us) {
  if (latency_us > UINT32_MAX / 1000u)
    return UINT32_MAX;
  return latency_us * 1000u;
}

int frida_raa_translate(const struct frida_raa_event *event,
                        struct frida_rs_input *out) {
  uint16_t kind = FRIDA_RS_EVENT_NONE;
  uint32_t flags = event != NULL ? event->status_flags : 0u;

  if (event == NULL || out == NULL)
    return -1;

  switch (event->operation) {
    case FRIDA_RAA_READ:
    case FRIDA_RAA_RECV:
      kind = FRIDA_RS_EVENT_NET_READ;
      break;
    case FRIDA_RAA_WRITE:
    case FRIDA_RAA_SEND:
    case FRIDA_RAA_CONNECT:
      kind = FRIDA_RS_EVENT_NET_WRITE;
      break;
    case FRIDA_RAA_IPC:
      kind = FRIDA_RS_EVENT_IPC_WRITE;
      flags |= FRIDA_RS_FLAG_IPC_BOUNDARY;
      break;
    case FRIDA_RAA_GC:
      kind = FRIDA_RS_EVENT_ALLOC_PRESSURE;
      flags |= FRIDA_RS_FLAG_GC_NEARBY;
      break;
    case FRIDA_RAA_DLOPEN:
      kind = FRIDA_RS_EVENT_DYNAMIC_LOAD;
      flags |= FRIDA_RS_FLAG_DYNAMIC_LOAD;
      break;
    case FRIDA_RAA_WEB_BOUNDARY:
      kind = FRIDA_RS_EVENT_WEB_ENTER;
      flags |= FRIDA_RS_FLAG_WEB_BOUNDARY;
      break;
    default:
      return -2;
  }

  out->monotonic_ns = event->monotonic_ns;
  out->stream_id = event->stream_tag;
  out->peer_tag = event->stream_tag;
  out->pid = event->pid;
  out->tid = event->tid;
  out->descriptor = (uint32_t) event->descriptor;
  out->byte_count = event->byte_count;
  out->latency_ns = frida_raa_latency_ns(event->latency_us);
  out->flags = flags;
  out->kind = kind;
  out->gc_pressure_q16 = (uint16_t) (event->pressure_q16 > FRIDA_RS_Q16_ONE
      ? FRIDA_RS_Q16_ONE : event->pressure_q16);
  return 0;
}

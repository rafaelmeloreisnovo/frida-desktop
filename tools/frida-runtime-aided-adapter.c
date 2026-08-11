#include "frida-runtime-aided-adapter.h"

#include <limits.h>
#include <stddef.h>

static uint32_t frida_raa_latency_ns(uint32_t latency_us) {
  if (latency_us > UINT32_MAX / 1000u)
    return UINT32_MAX;
  return latency_us * 1000u;
}

static int frida_raa_requires_descriptor(uint32_t operation) {
  return operation == FRIDA_RAA_READ || operation == FRIDA_RAA_WRITE ||
         operation == FRIDA_RAA_SEND || operation == FRIDA_RAA_RECV ||
         operation == FRIDA_RAA_CONNECT || operation == FRIDA_RAA_IPC_READ ||
         operation == FRIDA_RAA_IPC_WRITE;
}

int frida_raa_translate(const struct frida_raa_event *event,
                        struct frida_rs_input *out) {
  uint16_t kind;
  uint32_t flags;

  if (event == NULL || out == NULL)
    return FRIDA_RAA_ERR_NULL;
  if (event->monotonic_ns == 0u)
    return FRIDA_RAA_ERR_TIME;
  if (frida_raa_requires_descriptor(event->operation) && event->descriptor < 0)
    return FRIDA_RAA_ERR_DESCRIPTOR;

  flags = event->status_flags;
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
    case FRIDA_RAA_IPC_READ:
      kind = FRIDA_RS_EVENT_IPC_READ;
      flags |= FRIDA_RS_FLAG_IPC_BOUNDARY;
      break;
    case FRIDA_RAA_IPC_WRITE:
      kind = FRIDA_RS_EVENT_IPC_WRITE;
      flags |= FRIDA_RS_FLAG_IPC_BOUNDARY;
      break;
    case FRIDA_RAA_GC_BEGIN:
      kind = FRIDA_RS_EVENT_GC_BEGIN;
      flags |= FRIDA_RS_FLAG_GC_NEARBY;
      break;
    case FRIDA_RAA_GC_END:
      kind = FRIDA_RS_EVENT_GC_END;
      flags |= FRIDA_RS_FLAG_GC_NEARBY;
      break;
    case FRIDA_RAA_ALLOC_PRESSURE:
      kind = FRIDA_RS_EVENT_ALLOC_PRESSURE;
      flags |= FRIDA_RS_FLAG_GC_NEARBY;
      break;
    case FRIDA_RAA_DLOPEN:
      kind = FRIDA_RS_EVENT_DYNAMIC_LOAD;
      flags |= FRIDA_RS_FLAG_DYNAMIC_LOAD;
      break;
    case FRIDA_RAA_WEB_ENTER:
      kind = FRIDA_RS_EVENT_WEB_ENTER;
      flags |= FRIDA_RS_FLAG_WEB_BOUNDARY;
      break;
    case FRIDA_RAA_WEB_EXIT:
      kind = FRIDA_RS_EVENT_WEB_EXIT;
      flags |= FRIDA_RS_FLAG_WEB_BOUNDARY;
      break;
    default:
      return FRIDA_RAA_ERR_OPERATION;
  }

  out->monotonic_ns = event->monotonic_ns;
  out->stream_id = event->stream_tag;
  out->peer_tag = event->peer_tag;
  out->pid = event->pid;
  out->tid = event->tid;
  out->descriptor = event->descriptor < 0 ? 0u : (uint32_t) event->descriptor;
  out->byte_count = event->byte_count;
  out->latency_ns = frida_raa_latency_ns(event->latency_us);
  out->flags = flags;
  out->kind = kind;
  out->gc_pressure_q16 = (uint16_t) (event->pressure_q16 > FRIDA_RS_Q16_ONE
      ? FRIDA_RS_Q16_ONE : event->pressure_q16);
  return FRIDA_RAA_OK;
}

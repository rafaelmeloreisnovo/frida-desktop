#ifndef FRIDA_RUNTIME_AIDED_ADAPTER_H
#define FRIDA_RUNTIME_AIDED_ADAPTER_H

#include <stdint.h>
#include "frida-runtime-stability-recorder.h"

#ifdef __cplusplus
extern "C" {
#endif

#define FRIDA_RAA_OK 0
#define FRIDA_RAA_ERR_NULL -1
#define FRIDA_RAA_ERR_OPERATION -2
#define FRIDA_RAA_ERR_DESCRIPTOR -3
#define FRIDA_RAA_ERR_TIME -4

enum frida_raa_operation {
  FRIDA_RAA_READ = 1,
  FRIDA_RAA_WRITE,
  FRIDA_RAA_SEND,
  FRIDA_RAA_RECV,
  FRIDA_RAA_CONNECT,
  FRIDA_RAA_IPC_READ,
  FRIDA_RAA_IPC_WRITE,
  FRIDA_RAA_GC_BEGIN,
  FRIDA_RAA_GC_END,
  FRIDA_RAA_ALLOC_PRESSURE,
  FRIDA_RAA_DLOPEN,
  FRIDA_RAA_WEB_ENTER,
  FRIDA_RAA_WEB_EXIT
};

struct frida_raa_event {
  uint64_t monotonic_ns;
  uint32_t pid;
  uint32_t tid;
  int32_t descriptor;
  uint32_t operation;
  uint32_t byte_count;
  uint32_t latency_us;
  uint32_t status_flags;
  uint32_t pressure_q16;
  uint64_t stream_tag;
  uint64_t peer_tag;
};

/*
 * Metadata-only adapter boundary. It normalizes authorized observations into
 * recorder inputs. It does not install hooks, capture payloads, bypass TLS,
 * authentication, pinning, or process isolation.
 */
int frida_raa_translate(const struct frida_raa_event *event,
                        struct frida_rs_input *out);

#ifdef __cplusplus
}
#endif

#endif

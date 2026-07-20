#ifndef FRIDA_RUNTIME_STABILITY_RECORDER_H
#define FRIDA_RUNTIME_STABILITY_RECORDER_H

#include <stddef.h>
#include <stdint.h>

#include "frida-debugger-class-a-autotune.h"

#define FRIDA_RS_Q16_ONE 65535u
#define FRIDA_RS_DEFAULT_DELTA_TRIGGER_Q16 11796u /* approximately 0.18 */
#define FRIDA_RS_EVENT_CAPACITY 256u
#define FRIDA_RS_SILICON_PROFILE_VERSION 1u

#define FRIDA_RS_ARCH_ARM32 0x00000001u
#define FRIDA_RS_ARCH_ARM64 0x00000002u
#define FRIDA_RS_ARCH_NEON  0x00000004u

#define FRIDA_RS_FLAG_IO_ERROR          0x00000001u
#define FRIDA_RS_FLAG_GC_NEARBY         0x00000002u
#define FRIDA_RS_FLAG_WEB_BOUNDARY      0x00000004u
#define FRIDA_RS_FLAG_IPC_BOUNDARY      0x00000008u
#define FRIDA_RS_FLAG_DYNAMIC_LOAD      0x00000010u
#define FRIDA_RS_FLAG_DIRECTION_CHANGE  0x00000020u
#define FRIDA_RS_FLAG_TRIGGERED         0x80000000u

#define FRIDA_RS_DECISION_STABLE        0u
#define FRIDA_RS_DECISION_OBSERVE       1u
#define FRIDA_RS_DECISION_DUMP          2u
#define FRIDA_RS_DECISION_FAILSAFE      3u

enum frida_rs_event_kind {
  FRIDA_RS_EVENT_NONE = 0,
  FRIDA_RS_EVENT_NET_READ = 1,
  FRIDA_RS_EVENT_NET_WRITE = 2,
  FRIDA_RS_EVENT_GC_BEGIN = 3,
  FRIDA_RS_EVENT_GC_END = 4,
  FRIDA_RS_EVENT_ALLOC_PRESSURE = 5,
  FRIDA_RS_EVENT_WEB_ENTER = 6,
  FRIDA_RS_EVENT_WEB_EXIT = 7,
  FRIDA_RS_EVENT_IPC_READ = 8,
  FRIDA_RS_EVENT_IPC_WRITE = 9,
  FRIDA_RS_EVENT_DYNAMIC_LOAD = 10
};

struct frida_rs_silicon_profile {
  uint32_t version;
  uint32_t arch_flags;
  uint32_t pointer_bits;
  uint32_t page_size;
  uint32_t cache_line_bytes;
  uint32_t hwcap_low;
  uint32_t hwcap_high;
  uint32_t implementation_id;
};

struct frida_rs_input {
  uint64_t monotonic_ns;
  uint64_t stream_id;
  uint64_t peer_tag;
  uint32_t pid;
  uint32_t tid;
  uint32_t descriptor;
  uint32_t byte_count;
  uint32_t latency_ns;
  uint32_t flags;
  uint16_t kind;
  uint16_t gc_pressure_q16;
};

struct frida_rs_record {
  uint64_t monotonic_ns;
  uint64_t stream_id;
  uint64_t peer_tag;
  uint64_t chain_hash;
  uint32_t pid;
  uint32_t tid;
  uint32_t descriptor;
  uint32_t byte_count;
  uint32_t latency_ns;
  uint32_t flags;
  uint16_t kind;
  uint16_t stability_q16;
  uint16_t baseline_q16;
  uint16_t delta_q16;
  uint16_t alternation_q16;
  uint16_t burst_q16;
  uint16_t gc_pressure_q16;
  uint16_t decision;
};

struct frida_rs_policy {
  uint16_t delta_trigger_q16;
  uint16_t release_delta_q16;
  uint16_t min_trigger_events;
  uint16_t max_dump_events;
  uint32_t allowed_event_mask;
  uint64_t expected_silicon_tag;
};

struct frida_rs_state {
  struct frida_rs_record records[FRIDA_RS_EVENT_CAPACITY];
  uint64_t silicon_tag;
  uint64_t chain_hash;
  uint64_t last_monotonic_ns;
  uint64_t last_stream_id;
  uint32_t write_index;
  uint32_t readable_count;
  uint32_t unstable_run;
  uint32_t dump_run;
  uint32_t last_direction;
  uint32_t initialized;
  uint16_t baseline_q16;
  uint16_t stability_q16;
  uint16_t alternation_q16;
  uint16_t burst_q16;
  uint16_t gc_pressure_q16;
  uint16_t last_delta_q16;
};

uint64_t frida_rs_silicon_tag(const struct frida_rs_silicon_profile *profile);
int frida_rs_init(struct frida_rs_state *state,
    const struct frida_rs_silicon_profile *profile,
    const struct frida_rs_policy *policy);
uint16_t frida_rs_observe(struct frida_rs_state *state,
    const struct frida_rs_policy *policy,
    const struct frida_rs_input *input);
size_t frida_rs_drain(struct frida_rs_state *state,
    struct frida_rs_record *output,
    size_t output_capacity);
void frida_rs_make_dca_signal(const struct frida_rs_state *state,
    uint32_t arch_flags,
    uint32_t cycle_budget,
    uint32_t last_route,
    struct frida_dca_signal *output);
void frida_rs_reset_epoch(struct frida_rs_state *state);

#endif

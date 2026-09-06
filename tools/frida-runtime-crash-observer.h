#ifndef FRIDA_RUNTIME_CRASH_OBSERVER_H
#define FRIDA_RUNTIME_CRASH_OBSERVER_H

#include <stddef.h>
#include <stdint.h>

#define FRIDA_RCO_SCHEMA_VERSION 1u
#define FRIDA_RCO_EVENT_CAPACITY 128u

#define FRIDA_RCO_SOURCE_FRIDA_NATIVE   0x00000001u
#define FRIDA_RCO_SOURCE_FRIDA_JAVA     0x00000002u
#define FRIDA_RCO_SOURCE_ADB_EVENTS     0x00000004u
#define FRIDA_RCO_SOURCE_ADB_CRASH      0x00000008u
#define FRIDA_RCO_SOURCE_EXIT_INFO      0x00000010u
#define FRIDA_RCO_SOURCE_APP_CALLBACK   0x00000020u

#define FRIDA_RCO_FLAG_FATAL            0x00000100u
#define FRIDA_RCO_FLAG_FOREGROUND       0x00000200u
#define FRIDA_RCO_FLAG_RENDERER         0x00000400u
#define FRIDA_RCO_FLAG_IME              0x00000800u
#define FRIDA_RCO_FLAG_LOW_MEMORY       0x00001000u
#define FRIDA_RCO_FLAG_PRIVILEGED_GAP   0x00002000u
#define FRIDA_RCO_FLAG_TRIGGERED        0x80000000u

enum frida_rco_event_kind {
  FRIDA_RCO_EVENT_NONE = 0,
  FRIDA_RCO_EVENT_JAVA_UNCAUGHT = 1,
  FRIDA_RCO_EVENT_NATIVE_EXCEPTION = 2,
  FRIDA_RCO_EVENT_ANR = 3,
  FRIDA_RCO_EVENT_PROCESS_EXIT = 4,
  FRIDA_RCO_EVENT_WEB_RENDERER_GONE = 5,
  FRIDA_RCO_EVENT_IME_PROCESS_EXIT = 6,
  FRIDA_RCO_EVENT_LOW_MEMORY_KILL = 7,
  FRIDA_RCO_EVENT_SYSTEM_WATCHDOG = 8,
  FRIDA_RCO_EVENT_UNKNOWN_FATAL = 9
};

/*
 * All *_tag values are caller-provided non-reversible identifiers.
 * No payload pointer, text buffer, key event, clipboard value, URL, header,
 * credential, exception message, or UI content is accepted by this API.
 */
struct frida_rco_input {
  uint64_t monotonic_ns;
  uint64_t package_tag;
  uint64_t process_tag;
  uint64_t correlation_id;
  uint64_t pc;
  uint64_t sp;
  uint64_t fault_address;
  uint32_t pid;
  uint32_t tid;
  uint32_t uid;
  uint32_t status;
  uint32_t reason;
  uint32_t flags;
  uint16_t kind;
  uint16_t reserved;
};

struct frida_rco_record {
  uint64_t monotonic_ns;
  uint64_t package_tag;
  uint64_t process_tag;
  uint64_t correlation_id;
  uint64_t pc;
  uint64_t sp;
  uint64_t fault_address;
  uint64_t chain_hash;
  uint32_t pid;
  uint32_t tid;
  uint32_t uid;
  uint32_t status;
  uint32_t reason;
  uint32_t flags;
  uint16_t kind;
  uint16_t schema_version;
};

struct frida_rco_state {
  struct frida_rco_record records[FRIDA_RCO_EVENT_CAPACITY];
  uint64_t chain_hash;
  uint64_t last_monotonic_ns;
  uint32_t write_index;
  uint32_t readable_count;
  uint32_t observed_count;
  uint32_t rejected_count;
};

void frida_rco_init(struct frida_rco_state *state);
int frida_rco_record_event(struct frida_rco_state *state,
    const struct frida_rco_input *input);
size_t frida_rco_drain(struct frida_rco_state *state,
    struct frida_rco_record *output,
    size_t output_capacity);
void frida_rco_reset_epoch(struct frida_rco_state *state);

#endif

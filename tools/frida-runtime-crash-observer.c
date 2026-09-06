/*
 * Frida runtime crash observer.
 *
 * Payload-blind, fixed-capacity, append-sequential crash metadata recorder.
 * The hot path uses no heap, no recursion, no syscalls and no hosted runtime.
 */

#include "frida-runtime-crash-observer.h"

#define FRIDA_RCO_FNV_OFFSET UINT64_C(1469598103934665603)
#define FRIDA_RCO_FNV_PRIME  UINT64_C(1099511628211)

static void
frida_rco_zero(void *memory, size_t size)
{
  uint8_t *cursor = (uint8_t *) memory;
  size_t index;

  for (index = 0u; index != size; index++)
    cursor[index] = 0u;
}

static uint64_t
frida_rco_hash_bytes(uint64_t hash, const void *data, size_t size)
{
  const uint8_t *bytes = (const uint8_t *) data;
  size_t index;

  for (index = 0u; index != size; index++) {
    hash ^= bytes[index];
    hash *= FRIDA_RCO_FNV_PRIME;
  }

  return hash;
}

static uint32_t
frida_rco_kind_valid(uint16_t kind)
{
  return kind >= FRIDA_RCO_EVENT_JAVA_UNCAUGHT &&
      kind <= FRIDA_RCO_EVENT_UNKNOWN_FATAL;
}

void
frida_rco_init(struct frida_rco_state *state)
{
  if (state == NULL)
    return;
  frida_rco_zero(state, sizeof(*state));
}

int
frida_rco_record_event(struct frida_rco_state *state,
    const struct frida_rco_input *input)
{
  struct frida_rco_record *record;
  uint64_t hash;

  if (state == NULL || input == NULL)
    return -1;
  if (!frida_rco_kind_valid(input->kind)) {
    state->rejected_count++;
    return -2;
  }
  if (input->monotonic_ns == 0u ||
      (state->last_monotonic_ns != 0u &&
       input->monotonic_ns < state->last_monotonic_ns)) {
    state->rejected_count++;
    return -3;
  }

  record = &state->records[state->write_index % FRIDA_RCO_EVENT_CAPACITY];
  frida_rco_zero(record, sizeof(*record));

  record->monotonic_ns = input->monotonic_ns;
  record->package_tag = input->package_tag;
  record->process_tag = input->process_tag;
  record->correlation_id = input->correlation_id;
  record->pc = input->pc;
  record->sp = input->sp;
  record->fault_address = input->fault_address;
  record->pid = input->pid;
  record->tid = input->tid;
  record->uid = input->uid;
  record->status = input->status;
  record->reason = input->reason;
  record->flags = input->flags | FRIDA_RCO_FLAG_TRIGGERED;
  record->kind = input->kind;
  record->schema_version = FRIDA_RCO_SCHEMA_VERSION;

  hash = state->chain_hash == 0u ? FRIDA_RCO_FNV_OFFSET : state->chain_hash;
  hash = frida_rco_hash_bytes(hash, record,
      offsetof(struct frida_rco_record, chain_hash));
  hash = frida_rco_hash_bytes(hash, &record->pid,
      sizeof(*record) - offsetof(struct frida_rco_record, pid));
  record->chain_hash = hash;

  state->chain_hash = hash;
  state->last_monotonic_ns = input->monotonic_ns;
  state->write_index = (state->write_index + 1u) % FRIDA_RCO_EVENT_CAPACITY;
  if (state->readable_count < FRIDA_RCO_EVENT_CAPACITY)
    state->readable_count++;
  state->observed_count++;

  return 0;
}

size_t
frida_rco_drain(struct frida_rco_state *state,
    struct frida_rco_record *output,
    size_t output_capacity)
{
  size_t count;
  size_t index;
  uint32_t oldest;

  if (state == NULL || output == NULL || output_capacity == 0u)
    return 0u;

  count = state->readable_count;
  if (count > output_capacity)
    count = output_capacity;
  oldest = (state->write_index + FRIDA_RCO_EVENT_CAPACITY -
      state->readable_count) % FRIDA_RCO_EVENT_CAPACITY;

  for (index = 0u; index != count; index++)
    output[index] = state->records[(oldest + index) % FRIDA_RCO_EVENT_CAPACITY];

  state->readable_count -= (uint32_t) count;
  return count;
}

void
frida_rco_reset_epoch(struct frida_rco_state *state)
{
  uint64_t chain_hash;
  uint32_t observed_count;
  uint32_t rejected_count;

  if (state == NULL)
    return;

  chain_hash = state->chain_hash;
  observed_count = state->observed_count;
  rejected_count = state->rejected_count;
  frida_rco_zero(state, sizeof(*state));
  state->chain_hash = chain_hash;
  state->observed_count = observed_count;
  state->rejected_count = rejected_count;
}

/*
 * Frida runtime stability recorder.
 *
 * This translation unit is intentionally payload-blind. It records only
 * caller-provided metadata after an instability run crosses the configured
 * delta threshold. The hot path uses fixed-capacity storage, no heap, no
 * recursion, no syscalls, and no hosted Frida layers.
 */

#include "frida-runtime-stability-recorder.h"

#define FRIDA_RS_FNV_OFFSET UINT64_C(1469598103934665603)
#define FRIDA_RS_FNV_PRIME  UINT64_C(1099511628211)
#define FRIDA_RS_BURST_FAST_NS UINT64_C(1000000)
#define FRIDA_RS_BURST_MEDIUM_NS UINT64_C(10000000)
#define FRIDA_RS_LATENCY_LIMIT_NS 5000000u

static void
frida_rs_zero(void *memory, size_t size)
{
  uint8_t *cursor = (uint8_t *) memory;
  size_t index;

  for (index = 0; index != size; index++)
    cursor[index] = 0u;
}

static uint64_t
frida_rs_hash_bytes(uint64_t hash, const void *data, size_t size)
{
  const uint8_t *bytes = (const uint8_t *) data;
  size_t index;

  for (index = 0; index != size; index++) {
    hash ^= bytes[index];
    hash *= FRIDA_RS_FNV_PRIME;
  }

  return hash;
}

static uint16_t
frida_rs_average_q16(uint16_t left, uint16_t right)
{
  return (uint16_t) (((uint32_t) left + (uint32_t) right) >> 1);
}

static uint16_t
frida_rs_smooth_q16(uint16_t current, uint16_t input, uint32_t shift)
{
  uint32_t retained;
  uint32_t incoming;

  if (shift == 0u)
    return input;

  retained = (uint32_t) current * ((1u << shift) - 1u);
  incoming = input;
  return (uint16_t) ((retained + incoming) >> shift);
}

static uint16_t
frida_rs_abs_delta_q16(uint16_t left, uint16_t right)
{
  return left >= right ? (uint16_t) (left - right) :
      (uint16_t) (right - left);
}

static uint16_t
frida_rs_latency_pressure_q16(uint32_t latency_ns)
{
  uint64_t scaled;

  if (latency_ns >= FRIDA_RS_LATENCY_LIMIT_NS)
    return FRIDA_RS_Q16_ONE;

  scaled = (uint64_t) latency_ns * FRIDA_RS_Q16_ONE;
  return (uint16_t) (scaled / FRIDA_RS_LATENCY_LIMIT_NS);
}

static uint16_t
frida_rs_direction(uint16_t kind)
{
  if (kind == FRIDA_RS_EVENT_NET_READ || kind == FRIDA_RS_EVENT_IPC_READ)
    return 1u;
  if (kind == FRIDA_RS_EVENT_NET_WRITE || kind == FRIDA_RS_EVENT_IPC_WRITE)
    return 2u;
  return 0u;
}

static uint16_t
frida_rs_burst_sample(uint64_t previous_ns, uint64_t current_ns)
{
  uint64_t interval;

  if (previous_ns == 0u || current_ns <= previous_ns)
    return 0u;

  interval = current_ns - previous_ns;
  if (interval <= FRIDA_RS_BURST_FAST_NS)
    return FRIDA_RS_Q16_ONE;
  if (interval <= FRIDA_RS_BURST_MEDIUM_NS)
    return 32768u;
  return 0u;
}

static uint16_t
frida_rs_flag_pressure_q16(uint32_t flags)
{
  uint32_t count = 0u;

  count += (flags & FRIDA_RS_FLAG_IO_ERROR) != 0u;
  count += (flags & FRIDA_RS_FLAG_WEB_BOUNDARY) != 0u;
  count += (flags & FRIDA_RS_FLAG_IPC_BOUNDARY) != 0u;
  count += (flags & FRIDA_RS_FLAG_DYNAMIC_LOAD) != 0u;

  if (count >= 4u)
    return FRIDA_RS_Q16_ONE;
  return (uint16_t) (count * 16384u);
}

static uint16_t
frida_rs_instability_q16(uint16_t alternation_q16,
    uint16_t burst_q16,
    uint16_t gc_pressure_q16,
    uint16_t latency_pressure_q16,
    uint16_t flag_pressure_q16)
{
  uint32_t ping_pong_q16 = frida_rs_average_q16(alternation_q16, burst_q16);
  uint32_t weighted = (2u * ping_pong_q16) +
      (2u * gc_pressure_q16) + latency_pressure_q16 +
      flag_pressure_q16;

  return (uint16_t) (weighted / 6u);
}

static uint32_t
frida_rs_event_allowed(const struct frida_rs_policy *policy, uint16_t kind)
{
  if (kind == FRIDA_RS_EVENT_NONE || kind >= 32u)
    return 0u;
  if (policy->allowed_event_mask == 0u)
    return 1u;
  return (policy->allowed_event_mask & (1u << kind)) != 0u;
}

static void
frida_rs_commit_record(struct frida_rs_state *state,
    const struct frida_rs_input *input,
    uint16_t decision)
{
  struct frida_rs_record *record =
      &state->records[state->write_index % FRIDA_RS_EVENT_CAPACITY];
  uint64_t hash;

  frida_rs_zero(record, sizeof(*record));
  record->monotonic_ns = input->monotonic_ns;
  record->stream_id = input->stream_id;
  record->peer_tag = input->peer_tag;
  record->pid = input->pid;
  record->tid = input->tid;
  record->descriptor = input->descriptor;
  record->byte_count = input->byte_count;
  record->latency_ns = input->latency_ns;
  record->flags = input->flags | FRIDA_RS_FLAG_TRIGGERED;
  record->kind = input->kind;
  record->stability_q16 = state->stability_q16;
  record->baseline_q16 = state->baseline_q16;
  record->delta_q16 = state->last_delta_q16;
  record->alternation_q16 = state->alternation_q16;
  record->burst_q16 = state->burst_q16;
  record->gc_pressure_q16 = state->gc_pressure_q16;
  record->decision = decision;

  hash = state->chain_hash == 0u ? FRIDA_RS_FNV_OFFSET : state->chain_hash;
  hash = frida_rs_hash_bytes(hash, record, offsetof(struct frida_rs_record,
      chain_hash));
  hash = frida_rs_hash_bytes(hash, &record->pid,
      sizeof(*record) - offsetof(struct frida_rs_record, pid));
  record->chain_hash = hash;
  state->chain_hash = hash;

  state->write_index = (state->write_index + 1u) % FRIDA_RS_EVENT_CAPACITY;
  if (state->readable_count < FRIDA_RS_EVENT_CAPACITY)
    state->readable_count++;
}

uint64_t
frida_rs_silicon_tag(const struct frida_rs_silicon_profile *profile)
{
  if (profile == NULL)
    return 0u;
  return frida_rs_hash_bytes(FRIDA_RS_FNV_OFFSET, profile, sizeof(*profile));
}

int
frida_rs_init(struct frida_rs_state *state,
    const struct frida_rs_silicon_profile *profile,
    const struct frida_rs_policy *policy)
{
  uint64_t tag;

  if (state == NULL || profile == NULL || policy == NULL)
    return -1;
  if (profile->version != FRIDA_RS_SILICON_PROFILE_VERSION)
    return -2;

  tag = frida_rs_silicon_tag(profile);
  if (policy->expected_silicon_tag != 0u &&
      policy->expected_silicon_tag != tag)
    return -3;

  frida_rs_zero(state, sizeof(*state));
  state->silicon_tag = tag;
  state->baseline_q16 = FRIDA_RS_Q16_ONE;
  state->stability_q16 = FRIDA_RS_Q16_ONE;
  state->initialized = 1u;
  return 0;
}

uint16_t
frida_rs_observe(struct frida_rs_state *state,
    const struct frida_rs_policy *policy,
    const struct frida_rs_input *input)
{
  uint16_t direction;
  uint16_t alternation_sample;
  uint16_t burst_sample;
  uint16_t gc_sample;
  uint16_t latency_pressure;
  uint16_t flag_pressure;
  uint16_t instability;
  uint16_t decision = FRIDA_RS_DECISION_STABLE;
  uint16_t delta_trigger;
  uint16_t release_delta;
  uint16_t min_events;
  uint16_t max_events;

  if (state == NULL || policy == NULL || input == NULL ||
      state->initialized == 0u)
    return FRIDA_RS_DECISION_FAILSAFE;
  if (!frida_rs_event_allowed(policy, input->kind))
    return FRIDA_RS_DECISION_STABLE;

  direction = frida_rs_direction(input->kind);
  alternation_sample = direction != 0u && state->last_direction != 0u &&
      direction != state->last_direction ? FRIDA_RS_Q16_ONE : 0u;
  burst_sample = frida_rs_burst_sample(state->last_monotonic_ns,
      input->monotonic_ns);
  gc_sample = input->gc_pressure_q16;
  if ((input->flags & FRIDA_RS_FLAG_GC_NEARBY) != 0u && gc_sample < 49152u)
    gc_sample = 49152u;
  latency_pressure = frida_rs_latency_pressure_q16(input->latency_ns);
  flag_pressure = frida_rs_flag_pressure_q16(input->flags);

  state->alternation_q16 = frida_rs_smooth_q16(state->alternation_q16,
      alternation_sample, 2u);
  state->burst_q16 = frida_rs_smooth_q16(state->burst_q16, burst_sample, 2u);
  state->gc_pressure_q16 = frida_rs_smooth_q16(state->gc_pressure_q16,
      gc_sample, 2u);

  instability = frida_rs_instability_q16(state->alternation_q16,
      state->burst_q16, state->gc_pressure_q16, latency_pressure,
      flag_pressure);
  state->stability_q16 = (uint16_t) (FRIDA_RS_Q16_ONE - instability);

  if (state->last_monotonic_ns == 0u)
    state->baseline_q16 = state->stability_q16;
  else
    state->baseline_q16 = frida_rs_smooth_q16(state->baseline_q16,
        state->stability_q16, 4u);
  state->last_delta_q16 = frida_rs_abs_delta_q16(state->stability_q16,
      state->baseline_q16);

  delta_trigger = policy->delta_trigger_q16 != 0u ?
      policy->delta_trigger_q16 : FRIDA_RS_DEFAULT_DELTA_TRIGGER_Q16;
  release_delta = policy->release_delta_q16 != 0u ?
      policy->release_delta_q16 : (uint16_t) (delta_trigger >> 1);
  min_events = policy->min_trigger_events != 0u ?
      policy->min_trigger_events : 2u;
  max_events = policy->max_dump_events != 0u ?
      policy->max_dump_events : FRIDA_RS_EVENT_CAPACITY;

  if (state->last_delta_q16 >= delta_trigger) {
    state->unstable_run++;
    decision = FRIDA_RS_DECISION_OBSERVE;
  } else {
    state->unstable_run = 0u;
    if (state->last_delta_q16 <= release_delta)
      state->dump_run = 0u;
  }

  if (state->unstable_run >= min_events && state->dump_run < max_events) {
    decision = FRIDA_RS_DECISION_DUMP;
    frida_rs_commit_record(state, input, decision);
    state->dump_run++;
  }

  if (direction != 0u)
    state->last_direction = direction;
  state->last_monotonic_ns = input->monotonic_ns;
  state->last_stream_id = input->stream_id;

  return decision;
}

size_t
frida_rs_drain(struct frida_rs_state *state,
    struct frida_rs_record *output,
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
  oldest = (state->write_index + FRIDA_RS_EVENT_CAPACITY -
      state->readable_count) % FRIDA_RS_EVENT_CAPACITY;

  for (index = 0u; index != count; index++)
    output[index] = state->records[(oldest + index) % FRIDA_RS_EVENT_CAPACITY];

  state->readable_count -= (uint32_t) count;
  return count;
}

void
frida_rs_make_dca_signal(const struct frida_rs_state *state,
    uint32_t arch_flags,
    uint32_t cycle_budget,
    uint32_t last_route,
    struct frida_dca_signal *output)
{
  if (state == NULL || output == NULL)
    return;

  frida_rs_zero(output, sizeof(*output));
  output->stability_q16 = state->stability_q16;
  output->accuracy_q16 = (uint16_t) (FRIDA_RS_Q16_ONE - state->last_delta_q16);
  output->friction_q16 = state->burst_q16;
  output->entropy_q16 = state->alternation_q16;
  output->overhead_q16 = state->gc_pressure_q16;
  output->cycle_budget = cycle_budget;
  output->last_route = last_route;

  if ((arch_flags & FRIDA_RS_ARCH_ARM32) != 0u)
    output->arch_flags |= FRIDA_DCA_ARCH_ARM32;
  if ((arch_flags & FRIDA_RS_ARCH_NEON) != 0u)
    output->arch_flags |= FRIDA_DCA_ARCH_NEON;
  if (state->last_delta_q16 >= FRIDA_RS_DEFAULT_DELTA_TRIGGER_Q16)
    output->fault_flags |= FRIDA_DCA_FAULT_UNSTABLE;
  if (state->gc_pressure_q16 >= 49152u)
    output->fault_flags |= FRIDA_DCA_FAULT_OVERHEAD;
}

void
frida_rs_reset_epoch(struct frida_rs_state *state)
{
  uint64_t silicon_tag;

  if (state == NULL)
    return;

  silicon_tag = state->silicon_tag;
  frida_rs_zero(state, sizeof(*state));
  state->silicon_tag = silicon_tag;
  state->baseline_q16 = FRIDA_RS_Q16_ONE;
  state->stability_q16 = FRIDA_RS_Q16_ONE;
  state->initialized = 1u;
}

#include "rafaelia_custody_cycle_l0.h"

static RafC32 raf_rotl32(RafC32 value, RafC32 bits) {
  return bits == 0u ? value : ((value << bits) | (value >> (32u - bits)));
}

RafC32 raf_custody_cycle_l0(const RafCustodyPlan *plan, RafCustodyResult *out) {
  RafC32 i, x, self_mask = 0u, peer_mask = 0u;
  if (out == (void *)0) return RAF_CUSTODY_REJECTED;
  for (i = 0u; i < 4u; i++) {
    out->event[i].before = out->event[i].after = 0u;
    out->event[i].changed_bits = 0u;
    out->event[i].operation_id = i;
  }
  out->output_word = out->self_gate_mask = out->peer_gate_mask = 0u;
  out->executed_operations = out->simulated_cost_units = 0u;
  out->fifth_state = 0u;
  out->status = RAF_CUSTODY_REJECTED;
  if (plan == (void *)0) return out->status;
  if (plan->expected_present != 1u) {
    out->status = RAF_CUSTODY_MISSING_EXPECTATION;
    return out->status;
  }
  if (plan->rotate_left > 31u || plan->max_operations < 3u ||
      plan->max_operations > 1024u) return out->status;
  /* Independent self and adjacent-peer checks; no fifth state from a flag. */
  for (i = 0u; i < 4u; i++) {
    RafC32 next = (i + 1u) & 3u;
    if (plan->signatures[i] != 0u &&
        plan->counters_after[i] > plan->counters_before[i]) self_mask |= 1u << i;
    if (plan->signatures[i] != 0u &&
        plan->signatures[i] == plan->signatures[next]) peer_mask |= 1u << i;
  }
  out->self_gate_mask = self_mask;
  out->peer_gate_mask = peer_mask;
  if (self_mask != 15u || peer_mask != 15u) return out->status;
  x = plan->input_word;
  out->event[0].after = out->event[0].changed_bits = x;
  out->event[1].before = x;
  x ^= plan->xor_mask;
  out->event[1].after = x;
  out->event[1].changed_bits = out->event[1].before ^ x;
  out->event[2].before = x;
  x = raf_rotl32(x, plan->rotate_left);
  out->event[2].after = x;
  out->event[2].changed_bits = out->event[2].before ^ x;
  out->event[3].before = x;
  x += plan->addition; /* defined u32 wraparound */
  out->event[3].after = x;
  out->event[3].changed_bits = out->event[3].before ^ x;
  out->output_word = x;
  out->executed_operations = out->simulated_cost_units = 3u;
  if (x != plan->expected_word) return out->status;
  out->fifth_state = 1u;
  out->status = RAF_CUSTODY_ACCEPTED;
  return out->status;
}

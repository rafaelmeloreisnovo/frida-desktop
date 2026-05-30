/*
 * Debugger Class A heuristic autotuning model.
 *
 * The core is freestanding-friendly: no heap, no recursion, no syscalls, no
 * runtime code generation, and no dependency on hosted Frida layers.  It models
 * a small route planner that can morph between generic, arm32/neon, cache-local,
 * and rollback paths using fixed-point reliability signals.
 */

#include "frida-debugger-class-a-autotune.h"

#define FRIDA_DCA_ALPHA_NUMERATOR 1u
#define FRIDA_DCA_ALPHA_DENOMINATOR 4u
#define FRIDA_DCA_MIN_STABILITY 32768u
#define FRIDA_DCA_MIN_ACCURACY 32768u
#define FRIDA_DCA_MAX_FRICTION 49152u
#define FRIDA_DCA_MAX_OVERHEAD 49152u
#define FRIDA_DCA_LOW_BUDGET 700u
#define FRIDA_DCA_ROUTE_COUNT 4u

static uint32_t
frida_dca_mask_if_nonzero(uint32_t value)
{
  return (uint32_t) (0u - ((value | (0u - value)) >> 31));
}

static uint32_t
frida_dca_mask_if_ge_u32(uint32_t left, uint32_t right)
{
  uint32_t diff = left - right;
  return (uint32_t) (0u - ((diff >> 31) ^ 1u));
}

static uint32_t
frida_dca_select_u32(uint32_t mask, uint32_t when_set, uint32_t when_clear)
{
  return (when_set & mask) | (when_clear & ~mask);
}

static uint16_t
frida_dca_select_u16(uint32_t mask, uint16_t when_set, uint16_t when_clear)
{
  return (uint16_t) frida_dca_select_u32(mask, when_set, when_clear);
}

static uint16_t
frida_dca_saturating_add_q16(uint32_t left, uint32_t right)
{
  uint32_t sum = left + right;
  uint32_t overflow_mask = frida_dca_mask_if_ge_u32(sum, FRIDA_DCA_Q16_ONE);
  return (uint16_t) frida_dca_select_u32(overflow_mask, FRIDA_DCA_Q16_ONE, sum);
}


static uint32_t
frida_dca_route_bit(uint32_t route)
{
  uint32_t route_mask = frida_dca_mask_if_ge_u32(FRIDA_DCA_ROUTE_COUNT - 1u,
      route);
  uint32_t shift = route & 3u;
  return (1u << shift) & route_mask;
}

static uint32_t
frida_dca_known_good_route(const struct frida_dca_risk_policy *policy)
{
  uint32_t route_mask = frida_dca_mask_if_ge_u32(FRIDA_DCA_ROUTE_COUNT - 1u,
      policy->known_good_route);
  return frida_dca_select_u32(route_mask, policy->known_good_route,
      FRIDA_DCA_ROUTE_GENERIC);
}

static uint16_t
frida_dca_q16_average(uint16_t left, uint16_t right)
{
  return (uint16_t) (((uint32_t) left + right) >> 1);
}

static uint16_t
frida_dca_q16_inverse(uint16_t value)
{
  return (uint16_t) (FRIDA_DCA_Q16_ONE - value);
}

static uint16_t
frida_dca_smooth_q16(uint16_t current_q16, uint16_t input_q16)
{
  uint32_t retained = (uint32_t) current_q16 *
      (FRIDA_DCA_ALPHA_DENOMINATOR - FRIDA_DCA_ALPHA_NUMERATOR);
  uint32_t incoming = (uint32_t) input_q16 * FRIDA_DCA_ALPHA_NUMERATOR;
  return (uint16_t) ((retained + incoming) / FRIDA_DCA_ALPHA_DENOMINATOR);
}

static uint16_t
frida_dca_route_score_generic(const struct frida_dca_signal *signal,
    uint16_t coherence_q16)
{
  uint16_t friction_relief_q16 = frida_dca_q16_inverse(signal->friction_q16);
  uint16_t overhead_relief_q16 = frida_dca_q16_inverse(signal->overhead_q16);
  uint16_t conservative_q16 = frida_dca_q16_average(coherence_q16,
      friction_relief_q16);
  return frida_dca_q16_average(conservative_q16, overhead_relief_q16);
}

static uint16_t
frida_dca_route_score_arm32_neon(const struct frida_dca_signal *signal,
    uint16_t coherence_q16)
{
  uint32_t arch_mask = frida_dca_mask_if_nonzero(signal->arch_flags &
      FRIDA_DCA_ARCH_ARM32);
  uint32_t neon_mask = frida_dca_mask_if_nonzero(signal->arch_flags &
      FRIDA_DCA_ARCH_NEON);
  uint16_t arch_bonus_q16 = frida_dca_select_u16(arch_mask & neon_mask,
      12288u, 0u);
  uint16_t base_q16 = frida_dca_q16_average(coherence_q16,
      frida_dca_q16_inverse(signal->overhead_q16));
  return frida_dca_saturating_add_q16(base_q16, arch_bonus_q16);
}

static uint16_t
frida_dca_route_score_cache_local(const struct frida_dca_signal *signal,
    uint16_t coherence_q16)
{
  uint32_t cache_mask = frida_dca_mask_if_nonzero(signal->arch_flags &
      FRIDA_DCA_ARCH_SMALL_CACHE);
  uint32_t budget_mask = frida_dca_mask_if_ge_u32(FRIDA_DCA_LOW_BUDGET,
      signal->cycle_budget);
  uint16_t cache_bonus_q16 = frida_dca_select_u16(cache_mask | budget_mask,
      8192u, 0u);
  uint16_t friction_relief_q16 = frida_dca_q16_inverse(signal->friction_q16);
  uint16_t base_q16 = frida_dca_q16_average(coherence_q16, friction_relief_q16);
  return frida_dca_saturating_add_q16(base_q16, cache_bonus_q16);
}

static uint16_t
frida_dca_route_score_rollback(const struct frida_dca_signal *signal,
    uint16_t coherence_q16)
{
  uint32_t fault_mask = frida_dca_mask_if_nonzero(signal->fault_flags);
  uint16_t fault_bonus_q16 = frida_dca_select_u16(fault_mask, 24576u, 0u);
  uint16_t entropy_relief_q16 = frida_dca_q16_inverse(signal->entropy_q16);
  uint16_t base_q16 = frida_dca_q16_average(entropy_relief_q16,
      frida_dca_q16_inverse(coherence_q16));
  return frida_dca_saturating_add_q16(base_q16, fault_bonus_q16);
}

static uint32_t
frida_dca_select_best_route(uint16_t score_generic_q16,
    uint16_t score_arm32_neon_q16,
    uint16_t score_cache_local_q16,
    uint16_t score_rollback_q16,
    uint16_t * best_score_q16)
{
  uint32_t route = FRIDA_DCA_ROUTE_GENERIC;
  uint16_t best = score_generic_q16;
  uint32_t mask;

  mask = frida_dca_mask_if_ge_u32(score_arm32_neon_q16, best + 1u);
  route = frida_dca_select_u32(mask, FRIDA_DCA_ROUTE_ARM32_NEON, route);
  best = frida_dca_select_u16(mask, score_arm32_neon_q16, best);

  mask = frida_dca_mask_if_ge_u32(score_cache_local_q16, best + 1u);
  route = frida_dca_select_u32(mask, FRIDA_DCA_ROUTE_CACHE_LOCAL, route);
  best = frida_dca_select_u16(mask, score_cache_local_q16, best);

  mask = frida_dca_mask_if_ge_u32(score_rollback_q16, best + 1u);
  route = frida_dca_select_u32(mask, FRIDA_DCA_ROUTE_ROLLBACK, route);
  best = frida_dca_select_u16(mask, score_rollback_q16, best);

  *best_score_q16 = best;
  return route;
}

static uint16_t
frida_dca_mitigation_mask(const struct frida_dca_signal *signal)
{
  uint32_t unstable_mask = frida_dca_mask_if_ge_u32(FRIDA_DCA_MIN_STABILITY,
      signal->stability_q16);
  uint32_t inaccurate_mask = frida_dca_mask_if_ge_u32(FRIDA_DCA_MIN_ACCURACY,
      signal->accuracy_q16);
  uint32_t friction_mask = frida_dca_mask_if_ge_u32(signal->friction_q16,
      FRIDA_DCA_MAX_FRICTION);
  uint32_t overhead_mask = frida_dca_mask_if_ge_u32(signal->overhead_q16,
      FRIDA_DCA_MAX_OVERHEAD);
  uint32_t mask = 0u;

  mask |= unstable_mask & FRIDA_DCA_FAULT_UNSTABLE;
  mask |= inaccurate_mask & FRIDA_DCA_FAULT_INACCURATE;
  mask |= friction_mask & FRIDA_DCA_FAULT_FRICTION;
  mask |= overhead_mask & FRIDA_DCA_FAULT_OVERHEAD;
  mask |= signal->fault_flags & 0xffffu;

  return (uint16_t) mask;
}

uint16_t
frida_dca_coherence_q16(const struct frida_dca_signal *signal)
{
  uint16_t stable_accuracy_q16 = frida_dca_q16_average(signal->stability_q16,
      signal->accuracy_q16);
  uint16_t low_friction_q16 = frida_dca_q16_inverse(signal->friction_q16);
  uint16_t low_overhead_q16 = frida_dca_q16_inverse(signal->overhead_q16);
  uint16_t runtime_q16 = frida_dca_q16_average(low_friction_q16,
      low_overhead_q16);
  uint16_t input_q16 = frida_dca_q16_average(stable_accuracy_q16, runtime_q16);

  return frida_dca_smooth_q16(stable_accuracy_q16, input_q16);
}

struct frida_dca_decision
frida_dca_plan(const struct frida_dca_signal *signal)
{
  uint16_t coherence_q16 = frida_dca_coherence_q16(signal);
  uint16_t score_generic_q16 = frida_dca_route_score_generic(signal,
      coherence_q16);
  uint16_t score_arm32_neon_q16 = frida_dca_route_score_arm32_neon(signal,
      coherence_q16);
  uint16_t score_cache_local_q16 = frida_dca_route_score_cache_local(signal,
      coherence_q16);
  uint16_t score_rollback_q16 = frida_dca_route_score_rollback(signal,
      coherence_q16);
  uint16_t best_score_q16;
  uint32_t route = frida_dca_select_best_route(score_generic_q16,
      score_arm32_neon_q16, score_cache_local_q16, score_rollback_q16,
      &best_score_q16);
  uint16_t mitigation_mask = frida_dca_mitigation_mask(signal);
  uint32_t mitigation_nonzero_mask = frida_dca_mask_if_nonzero(mitigation_mask);
  uint32_t changed_mask = frida_dca_mask_if_nonzero(route ^ signal->last_route);
  struct frida_dca_decision decision;

  decision.route = route;
  decision.flags = (mitigation_nonzero_mask & FRIDA_DCA_DECISION_FAILSAFE) |
      (mitigation_nonzero_mask & FRIDA_DCA_DECISION_FAILOVER) |
      (changed_mask & FRIDA_DCA_DECISION_MORPHED);
  decision.confidence_q16 = best_score_q16;
  decision.rollback_token = (uint16_t) (((signal->last_route & 0xffu) << 8) |
      (route & 0xffu));
  decision.mitigation_mask = mitigation_mask;

  return decision;
}

struct frida_dca_decision
frida_dca_failover(const struct frida_dca_signal *signal,
    struct frida_dca_decision previous)
{
  struct frida_dca_decision decision = frida_dca_plan(signal);
  uint32_t previous_mask = frida_dca_mask_if_nonzero(previous.flags &
      FRIDA_DCA_DECISION_ROLLBACK);

  decision.route = frida_dca_select_u32(previous_mask, previous.route,
      decision.route);
  decision.flags |= FRIDA_DCA_DECISION_FAILOVER;
  decision.rollback_token ^= previous.rollback_token;

  return decision;
}

struct frida_dca_decision
frida_dca_rollback(struct frida_dca_decision previous, uint32_t known_good_route)
{
  uint32_t route_mask = frida_dca_mask_if_ge_u32(FRIDA_DCA_ROUTE_COUNT - 1u,
      known_good_route);
  uint32_t route = frida_dca_select_u32(route_mask, known_good_route,
      FRIDA_DCA_ROUTE_GENERIC);

  previous.route = route;
  previous.flags |= FRIDA_DCA_DECISION_ROLLBACK;
  previous.confidence_q16 = frida_dca_smooth_q16(previous.confidence_q16,
      FRIDA_DCA_Q16_ONE);
  previous.rollback_token ^= (uint16_t) (0xA500u | (route & 0xffu));
  return previous;
}


struct frida_dca_mitigation
frida_dca_mitigate(const struct frida_dca_signal *signal,
    const struct frida_dca_risk_policy *policy,
    struct frida_dca_decision previous)
{
  struct frida_dca_mitigation result;
  struct frida_dca_decision planned = frida_dca_plan(signal);
  uint32_t unstable_mask = frida_dca_mask_if_ge_u32(policy->min_stability_q16,
      signal->stability_q16 + 1u);
  uint32_t inaccurate_mask = frida_dca_mask_if_ge_u32(policy->min_accuracy_q16,
      signal->accuracy_q16 + 1u);
  uint32_t friction_mask = frida_dca_mask_if_ge_u32(signal->friction_q16,
      policy->max_friction_q16 + 1u);
  uint32_t entropy_mask = frida_dca_mask_if_ge_u32(signal->entropy_q16,
      policy->max_entropy_q16 + 1u);
  uint32_t overhead_mask = frida_dca_mask_if_ge_u32(signal->overhead_q16,
      policy->max_overhead_q16 + 1u);
  uint32_t confidence_mask = frida_dca_mask_if_ge_u32(
      policy->min_confidence_q16, planned.confidence_q16 + 1u);
  uint32_t allowed_bit = frida_dca_route_bit(planned.route) &
      policy->allowed_routes_mask;
  uint32_t disallowed_mask = ~frida_dca_mask_if_nonzero(allowed_bit);
  uint32_t risk_mask = 0u;
  uint32_t active_risk_mask;
  uint32_t safe_route = frida_dca_known_good_route(policy);
  uint16_t rollback_token = (uint16_t) (previous.rollback_token ^
      planned.rollback_token ^ (0x5A00u | (safe_route & 0xffu)));

  risk_mask |= unstable_mask & FRIDA_DCA_FAULT_UNSTABLE;
  risk_mask |= inaccurate_mask & FRIDA_DCA_FAULT_INACCURATE;
  risk_mask |= friction_mask & FRIDA_DCA_FAULT_FRICTION;
  risk_mask |= entropy_mask & FRIDA_DCA_FAULT_ENTROPY;
  risk_mask |= overhead_mask & FRIDA_DCA_FAULT_OVERHEAD;
  risk_mask |= confidence_mask & FRIDA_DCA_FAULT_LOW_CONFIDENCE;
  risk_mask |= disallowed_mask & FRIDA_DCA_FAULT_DISALLOWED_ROUTE;
  risk_mask |= signal->fault_flags;
  active_risk_mask = frida_dca_mask_if_nonzero(risk_mask);

  result.decision = planned;
  result.decision.route = frida_dca_select_u32(active_risk_mask, safe_route,
      planned.route);
  result.decision.flags = planned.flags |
      (active_risk_mask & (FRIDA_DCA_DECISION_FAILSAFE |
          FRIDA_DCA_DECISION_FAILOVER | FRIDA_DCA_DECISION_ROLLBACK));
  result.decision.confidence_q16 = frida_dca_select_u16(active_risk_mask,
      frida_dca_smooth_q16(planned.confidence_q16, FRIDA_DCA_Q16_ONE),
      planned.confidence_q16);
  result.decision.rollback_token = frida_dca_select_u16(active_risk_mask,
      rollback_token, planned.rollback_token);
  result.decision.mitigation_mask = (uint16_t) (planned.mitigation_mask |
      (risk_mask & 0xffffu));
  result.risk_mask = risk_mask;
  result.applied_flags = result.decision.flags &
      (FRIDA_DCA_DECISION_FAILSAFE | FRIDA_DCA_DECISION_FAILOVER |
          FRIDA_DCA_DECISION_ROLLBACK);

  return result;
}

#ifdef FRIDA_DCA_AUTOTUNE_SELFTEST
#include <stdio.h>

static int
frida_dca_expect_u32(const char * label, uint32_t actual, uint32_t expected)
{
  if (actual == expected)
    return 0;

  printf("FAIL %s: got %lu expected %lu\n", label,
      (unsigned long) actual, (unsigned long) expected);
  return 1;
}

int
main(void)
{
  struct frida_dca_signal stable_signal;
  struct frida_dca_signal fault_signal;
  struct frida_dca_decision stable_decision;
  struct frida_dca_decision failover_decision;
  struct frida_dca_decision rollback_decision;
  struct frida_dca_risk_policy strict_policy;
  struct frida_dca_mitigation mitigation;
  int failures = 0;

  stable_signal.stability_q16 = 62000u;
  stable_signal.accuracy_q16 = 61000u;
  stable_signal.friction_q16 = 9000u;
  stable_signal.entropy_q16 = 12000u;
  stable_signal.overhead_q16 = 10000u;
  stable_signal.fault_flags = 0u;
  stable_signal.arch_flags = FRIDA_DCA_ARCH_ARM32 | FRIDA_DCA_ARCH_NEON;
  stable_signal.cycle_budget = 1600u;
  stable_signal.last_route = FRIDA_DCA_ROUTE_GENERIC;

  fault_signal.stability_q16 = 18000u;
  fault_signal.accuracy_q16 = 24000u;
  fault_signal.friction_q16 = 62000u;
  fault_signal.entropy_q16 = 58000u;
  fault_signal.overhead_q16 = 60000u;
  fault_signal.fault_flags = FRIDA_DCA_FAULT_UNSTABLE;
  fault_signal.arch_flags = FRIDA_DCA_ARCH_SMALL_CACHE;
  fault_signal.cycle_budget = 320u;
  fault_signal.last_route = FRIDA_DCA_ROUTE_ARM32_NEON;

  strict_policy.min_stability_q16 = 32768u;
  strict_policy.min_accuracy_q16 = 32768u;
  strict_policy.max_friction_q16 = 49152u;
  strict_policy.max_entropy_q16 = 49152u;
  strict_policy.max_overhead_q16 = 49152u;
  strict_policy.min_confidence_q16 = 50000u;
  strict_policy.allowed_routes_mask = 1u << FRIDA_DCA_ROUTE_GENERIC;
  strict_policy.known_good_route = FRIDA_DCA_ROUTE_GENERIC;

  stable_decision = frida_dca_plan(&stable_signal);
  failover_decision = frida_dca_failover(&fault_signal, stable_decision);
  rollback_decision = frida_dca_rollback(failover_decision,
      FRIDA_DCA_ROUTE_GENERIC);
  mitigation = frida_dca_mitigate(&fault_signal, &strict_policy,
      stable_decision);

  failures += frida_dca_expect_u32("stable route", stable_decision.route,
      FRIDA_DCA_ROUTE_ARM32_NEON);
  failures += frida_dca_expect_u32("stable flags", stable_decision.flags,
      FRIDA_DCA_DECISION_MORPHED);
  failures += frida_dca_expect_u32("failover route", failover_decision.route,
      FRIDA_DCA_ROUTE_ROLLBACK);
  failures += frida_dca_expect_u32("failover flag",
      failover_decision.flags & FRIDA_DCA_DECISION_FAILOVER,
      FRIDA_DCA_DECISION_FAILOVER);
  failures += frida_dca_expect_u32("rollback route", rollback_decision.route,
      FRIDA_DCA_ROUTE_GENERIC);
  failures += frida_dca_expect_u32("rollback flag",
      rollback_decision.flags & FRIDA_DCA_DECISION_ROLLBACK,
      FRIDA_DCA_DECISION_ROLLBACK);
  failures += frida_dca_expect_u32("mitigation route",
      mitigation.decision.route, FRIDA_DCA_ROUTE_GENERIC);
  failures += frida_dca_expect_u32("mitigation applied",
      mitigation.applied_flags, FRIDA_DCA_DECISION_FAILSAFE |
      FRIDA_DCA_DECISION_FAILOVER | FRIDA_DCA_DECISION_ROLLBACK);
  failures += frida_dca_expect_u32("mitigation risks",
      mitigation.risk_mask & (FRIDA_DCA_FAULT_UNSTABLE |
      FRIDA_DCA_FAULT_INACCURATE | FRIDA_DCA_FAULT_FRICTION |
      FRIDA_DCA_FAULT_OVERHEAD | FRIDA_DCA_FAULT_ENTROPY |
      FRIDA_DCA_FAULT_DISALLOWED_ROUTE),
      FRIDA_DCA_FAULT_UNSTABLE | FRIDA_DCA_FAULT_INACCURATE |
      FRIDA_DCA_FAULT_FRICTION | FRIDA_DCA_FAULT_OVERHEAD |
      FRIDA_DCA_FAULT_ENTROPY | FRIDA_DCA_FAULT_DISALLOWED_ROUTE);

  if (failures != 0)
    return 1;

  printf("PASS: Debugger Class A autotune route=%lu failover=%lu rollback=%lu\n",
      (unsigned long) stable_decision.route,
      (unsigned long) failover_decision.route,
      (unsigned long) rollback_decision.route);
  return 0;
}
#endif

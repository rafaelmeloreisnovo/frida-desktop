#ifndef FRIDA_DEBUGGER_CLASS_A_AUTOTUNE_H
#define FRIDA_DEBUGGER_CLASS_A_AUTOTUNE_H

#include <stdint.h>

#define FRIDA_DCA_Q16_ONE 65535u
#define FRIDA_DCA_ROUTE_GENERIC 0u
#define FRIDA_DCA_ROUTE_ARM32_NEON 1u
#define FRIDA_DCA_ROUTE_CACHE_LOCAL 2u
#define FRIDA_DCA_ROUTE_ROLLBACK 3u
#define FRIDA_DCA_ARCH_ARM32 0x00000001u
#define FRIDA_DCA_ARCH_NEON 0x00000002u
#define FRIDA_DCA_ARCH_SMALL_CACHE 0x00000004u
#define FRIDA_DCA_FAULT_UNSTABLE 0x00000001u
#define FRIDA_DCA_FAULT_INACCURATE 0x00000002u
#define FRIDA_DCA_FAULT_FRICTION 0x00000004u
#define FRIDA_DCA_FAULT_OVERHEAD 0x00000008u
#define FRIDA_DCA_FAULT_ENTROPY 0x00000010u
#define FRIDA_DCA_FAULT_LOW_CONFIDENCE 0x00000020u
#define FRIDA_DCA_FAULT_DISALLOWED_ROUTE 0x00000040u
#define FRIDA_DCA_DECISION_FAILSAFE 0x00000001u
#define FRIDA_DCA_DECISION_FAILOVER 0x00000002u
#define FRIDA_DCA_DECISION_ROLLBACK 0x00000004u
#define FRIDA_DCA_DECISION_MORPHED 0x00000008u

struct frida_dca_signal {
  uint16_t stability_q16;
  uint16_t accuracy_q16;
  uint16_t friction_q16;
  uint16_t entropy_q16;
  uint16_t overhead_q16;
  uint32_t fault_flags;
  uint32_t arch_flags;
  uint32_t cycle_budget;
  uint32_t last_route;
};

struct frida_dca_decision {
  uint32_t route;
  uint32_t flags;
  uint16_t confidence_q16;
  uint16_t rollback_token;
  uint16_t mitigation_mask;
};

struct frida_dca_risk_policy {
  uint16_t min_stability_q16;
  uint16_t min_accuracy_q16;
  uint16_t max_friction_q16;
  uint16_t max_entropy_q16;
  uint16_t max_overhead_q16;
  uint16_t min_confidence_q16;
  uint32_t allowed_routes_mask;
  uint32_t known_good_route;
};

struct frida_dca_mitigation {
  struct frida_dca_decision decision;
  uint32_t risk_mask;
  uint32_t applied_flags;
};

uint16_t frida_dca_coherence_q16(const struct frida_dca_signal *signal);
struct frida_dca_decision frida_dca_plan(const struct frida_dca_signal *signal);
struct frida_dca_decision frida_dca_failover(const struct frida_dca_signal *signal,
    struct frida_dca_decision previous);
struct frida_dca_decision frida_dca_rollback(struct frida_dca_decision previous,
    uint32_t known_good_route);
struct frida_dca_mitigation frida_dca_mitigate(const struct frida_dca_signal *signal,
    const struct frida_dca_risk_policy *policy,
    struct frida_dca_decision previous);

#endif

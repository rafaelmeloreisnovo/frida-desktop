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

uint16_t frida_dca_coherence_q16(const struct frida_dca_signal *signal);
struct frida_dca_decision frida_dca_plan(const struct frida_dca_signal *signal);
struct frida_dca_decision frida_dca_failover(const struct frida_dca_signal *signal,
    struct frida_dca_decision previous);
struct frida_dca_decision frida_dca_rollback(struct frida_dca_decision previous,
    uint32_t known_good_route);

#endif

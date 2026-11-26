#ifndef RAFAELIA_CUSTODY_CYCLE_L0_H
#define RAFAELIA_CUSTODY_CYCLE_L0_H
/* New project-specific kernel: no libc, heap, syscalls, clock or JNI. */
typedef unsigned int RafC32;
typedef unsigned long long RafC64;
_Static_assert(sizeof(RafC32) == 4, "u32");
_Static_assert(sizeof(RafC64) == 8, "u64");
#define RAF_CUSTODY_ORGANS 4u
#define RAF_CUSTODY_ACCEPTED 0u
#define RAF_CUSTODY_REJECTED 1u
#define RAF_CUSTODY_MISSING_EXPECTATION 2u
typedef struct RafCustodyPlan {
 RafC32 input_word, xor_mask, rotate_left, addition;
 RafC32 expected_word, expected_present, max_operations;
 RafC32 signatures[4];
 RafC64 counters_before[4], counters_after[4];
} RafCustodyPlan;
typedef struct RafCustodyEvent {
 RafC32 before, after, changed_bits, operation_id;
} RafCustodyEvent;
typedef struct RafCustodyResult {
 RafCustodyEvent event[4];
 RafC32 output_word, self_gate_mask, peer_gate_mask;
 RafC32 executed_operations, simulated_cost_units;
 RafC32 fifth_state, status;
} RafCustodyResult;
RafC32 raf_custody_cycle_l0(const RafCustodyPlan *plan, RafCustodyResult *result);
#endif

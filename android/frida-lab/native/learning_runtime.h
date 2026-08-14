#ifndef RAFAELIA_FRIDA_LEARNING_RUNTIME_H
#define RAFAELIA_FRIDA_LEARNING_RUNTIME_H

#include <stdint.h>

#include "learning_store.h"
#include "neon4096_core.h"

#ifdef __cplusplus
extern "C" {
#endif

#define RAFAELIA_RUNTIME_VALIDATION_SETS 256u
#define RAFAELIA_RUNTIME_VALIDATION_WAYS 4u
#define RAFAELIA_RUNTIME_VALIDATION_ENTRIES \
    (RAFAELIA_RUNTIME_VALIDATION_SETS * RAFAELIA_RUNTIME_VALIDATION_WAYS)

#define RAFAELIA_RUNTIME_FLAG_ACTIVE_POLICY_DISABLED (1u << 0)
#define RAFAELIA_RUNTIME_FLAG_VALIDATION_FROZEN_MODEL (1u << 1)
#define RAFAELIA_RUNTIME_FLAG_VALIDATION_PERSISTENCE_TOKEN_VAZIO (1u << 2)

typedef enum RafaeliaLearningRuntimeMode {
    RAFAELIA_RUNTIME_OFF = 0,
    RAFAELIA_RUNTIME_OBSERVE = 1,
    RAFAELIA_RUNTIME_LEARN_SHADOW = 2,
    RAFAELIA_RUNTIME_PREDICT_SHADOW = 3,
    RAFAELIA_RUNTIME_VALIDATE_SHADOW = 4,
    RAFAELIA_RUNTIME_FROZEN = 5
} RafaeliaLearningRuntimeMode;

typedef struct RafaeliaLearningRuntimeSnapshotV1 {
    uint32_t abi_version;
    uint32_t logical_mode;
    RafaeliaLearningSnapshotV1 store;
    RafaeliaNeon4096RuntimeV1 neon4096;
    uint64_t validation_observations;
    uint64_t validation_predictions;
    uint64_t validation_correct;
    uint64_t validation_incorrect;
    uint64_t validation_prediction_misses;
    uint32_t validation_error_ppm;
    uint16_t validation_confidence_q16;
    uint16_t reserved16;
    uint32_t validation_contexts_used;
    uint32_t validation_candidate_contexts;
    uint32_t flags;
    uint32_t reserved32;
} RafaeliaLearningRuntimeSnapshotV1;

int rafaelia_learning_runtime_init(const char *store_path);
int rafaelia_learning_runtime_set_mode(uint32_t logical_mode);
int rafaelia_learning_runtime_get_mode(void);
int rafaelia_learning_runtime_observe(uint64_t context_hash,
                                      uint32_t candidate_id,
                                      uint32_t event_type,
                                      uint64_t cost_ns,
                                      int64_t memory_delta,
                                      uint64_t aux_hash);
int rafaelia_learning_runtime_snapshot(RafaeliaLearningRuntimeSnapshotV1 *snapshot_out);
int rafaelia_learning_runtime_flush(void);
int rafaelia_learning_runtime_reset_volatile(void);
int rafaelia_learning_runtime_close(void);

#ifdef __cplusplus
}
#endif

#endif /* RAFAELIA_FRIDA_LEARNING_RUNTIME_H */

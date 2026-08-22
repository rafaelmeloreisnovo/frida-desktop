#include "learning_runtime.h"

#include <limits.h>
#include <stdatomic.h>
#include <string.h>

typedef struct ValidationEntry {
    uint64_t context_hash;
    uint64_t last_observation;
    uint32_t predictions;
    uint32_t correct;
    uint32_t incorrect;
    uint8_t used;
    uint8_t reserved[7];
} ValidationEntry;

typedef struct RuntimeState {
    uint8_t initialized;
    uint8_t reserved8[3];
    uint32_t logical_mode;
    ValidationEntry validation[RAFAELIA_RUNTIME_VALIDATION_ENTRIES];
    uint32_t validation_contexts_used;
    uint32_t reserved32;
    uint64_t validation_observations;
    uint64_t validation_predictions;
    uint64_t validation_correct;
    uint64_t validation_incorrect;
    uint64_t validation_prediction_misses;
    RafaeliaNeon4096RuntimeV1 neon4096;
} RuntimeState;

static RuntimeState g_runtime;
static atomic_flag g_runtime_lock = ATOMIC_FLAG_INIT;

static void runtime_lock(void) {
    while (atomic_flag_test_and_set_explicit(&g_runtime_lock, memory_order_acquire)) {
    }
}

static void runtime_unlock(void) {
    atomic_flag_clear_explicit(&g_runtime_lock, memory_order_release);
}

static uint32_t validation_set_index(uint64_t context_hash) {
    uint64_t mixed = context_hash ^ (context_hash >> 33) ^ (context_hash >> 17);
    return (uint32_t)mixed & (RAFAELIA_RUNTIME_VALIDATION_SETS - 1u);
}

static void reset_validation_locked(void) {
    memset(g_runtime.validation, 0, sizeof(g_runtime.validation));
    g_runtime.validation_contexts_used = 0u;
    g_runtime.validation_observations = 0u;
    g_runtime.validation_predictions = 0u;
    g_runtime.validation_correct = 0u;
    g_runtime.validation_incorrect = 0u;
    g_runtime.validation_prediction_misses = 0u;
}

static ValidationEntry *validation_entry_locked(uint64_t context_hash) {
    uint32_t set = validation_set_index(context_hash);
    uint32_t base = set * RAFAELIA_RUNTIME_VALIDATION_WAYS;
    ValidationEntry *unused = NULL;
    ValidationEntry *victim = NULL;

    for (uint32_t way = 0u; way < RAFAELIA_RUNTIME_VALIDATION_WAYS; ++way) {
        ValidationEntry *entry = &g_runtime.validation[base + way];
        if (entry->used && entry->context_hash == context_hash) return entry;
        if (!entry->used && !unused) unused = entry;
        if (!victim || entry->predictions < victim->predictions ||
            (entry->predictions == victim->predictions &&
             entry->last_observation < victim->last_observation)) {
            victim = entry;
        }
    }

    ValidationEntry *dst = unused ? unused : victim;
    if (!dst) return NULL;
    if (!dst->used) g_runtime.validation_contexts_used += 1u;
    memset(dst, 0, sizeof(*dst));
    dst->used = 1u;
    dst->context_hash = context_hash;
    return dst;
}

static uint32_t count_validation_candidates_locked(
        const RafaeliaLearningSnapshotV1 *store_snapshot) {
    int resources_ok =
        store_snapshot->overhead_p99_ns <= UINT64_C(250000) &&
        store_snapshot->memory_high_water_bytes <= UINT64_C(4) * 1024u * 1024u;
    if (!resources_ok) return 0u;

    uint32_t eligible = 0u;
    for (uint32_t i = 0u; i < RAFAELIA_RUNTIME_VALIDATION_ENTRIES; ++i) {
        const ValidationEntry *entry = &g_runtime.validation[i];
        if (!entry->used || entry->predictions < RAFAELIA_LEARNING_DEFAULT_MIN_SUPPORT)
            continue;
        uint64_t error_ppm = (uint64_t)entry->incorrect * UINT64_C(1000000) /
                             entry->predictions;
        uint64_t confidence_q16 = (uint64_t)entry->correct * UINT64_C(65535) /
                                  entry->predictions;
        if (error_ppm <= RAFAELIA_LEARNING_DEFAULT_MAX_ERROR_PPM &&
            confidence_q16 >= RAFAELIA_LEARNING_DEFAULT_CONFIDENCE_Q16)
            eligible += 1u;
    }
    return eligible;
}

int rafaelia_learning_runtime_init(const char *store_path) {
    if (!store_path || store_path[0] == '\0') return RAFAELIA_LEARNING_STATUS_ERR_ARG;
    runtime_lock();
    if (g_runtime.initialized) {
        runtime_unlock();
        return RAFAELIA_LEARNING_STATUS_ERR_STATE;
    }

    memset(&g_runtime, 0, sizeof(g_runtime));
    int rc = rafaelia_learning_init(store_path, NULL);
    if (rc != RAFAELIA_LEARNING_STATUS_OK) {
        runtime_unlock();
        return rc;
    }

    rc = rafaelia_neon4096_runtime_probe(&g_runtime.neon4096);
    if (rc != RAFAELIA_NEON4096_STATUS_OK) {
        (void)rafaelia_learning_close();
        runtime_unlock();
        return RAFAELIA_LEARNING_STATUS_ERR_STATE;
    }

    g_runtime.logical_mode = RAFAELIA_RUNTIME_OFF;
    g_runtime.initialized = 1u;
    runtime_unlock();
    return RAFAELIA_LEARNING_STATUS_OK;
}

int rafaelia_learning_runtime_set_mode(uint32_t logical_mode) {
    if (logical_mode > RAFAELIA_RUNTIME_FROZEN)
        return RAFAELIA_LEARNING_STATUS_ERR_ARG;

    runtime_lock();
    if (!g_runtime.initialized) {
        runtime_unlock();
        return RAFAELIA_LEARNING_STATUS_ERR_STATE;
    }

    int rc;
    if (logical_mode == RAFAELIA_RUNTIME_VALIDATE_SHADOW) {
        rc = rafaelia_learning_flush();
        if (rc == RAFAELIA_LEARNING_STATUS_OK)
            rc = rafaelia_learning_set_mode(RAFAELIA_LEARNING_FROZEN);
        if (rc == RAFAELIA_LEARNING_STATUS_OK &&
            g_runtime.logical_mode != RAFAELIA_RUNTIME_VALIDATE_SHADOW)
            reset_validation_locked();
    } else if (logical_mode == RAFAELIA_RUNTIME_FROZEN) {
        rc = rafaelia_learning_set_mode(RAFAELIA_LEARNING_FROZEN);
    } else {
        rc = rafaelia_learning_set_mode(logical_mode);
    }

    if (rc == RAFAELIA_LEARNING_STATUS_OK) g_runtime.logical_mode = logical_mode;
    runtime_unlock();
    return rc;
}

int rafaelia_learning_runtime_get_mode(void) {
    runtime_lock();
    int mode = g_runtime.initialized
        ? (int)g_runtime.logical_mode
        : RAFAELIA_LEARNING_STATUS_ERR_STATE;
    runtime_unlock();
    return mode;
}

int rafaelia_learning_runtime_observe(uint64_t context_hash,
                                      uint32_t candidate_id,
                                      uint32_t event_type,
                                      uint64_t cost_ns,
                                      int64_t memory_delta,
                                      uint64_t aux_hash) {
    runtime_lock();
    if (!g_runtime.initialized || g_runtime.logical_mode == RAFAELIA_RUNTIME_OFF ||
        g_runtime.logical_mode == RAFAELIA_RUNTIME_FROZEN) {
        runtime_unlock();
        return RAFAELIA_LEARNING_STATUS_ERR_STATE;
    }

    if (g_runtime.logical_mode != RAFAELIA_RUNTIME_VALIDATE_SHADOW) {
        int rc = rafaelia_learning_observe(
            context_hash, candidate_id, event_type, cost_ns, memory_delta, aux_hash);
        runtime_unlock();
        return rc;
    }

    (void)event_type;
    (void)cost_ns;
    (void)memory_delta;
    (void)aux_hash;

    g_runtime.validation_observations += 1u;
    uint32_t predicted = 0u;
    uint32_t support = 0u;
    uint16_t confidence = 0u;
    int rc = rafaelia_learning_predict(
        context_hash, &predicted, &confidence, &support);
    (void)confidence;
    (void)support;

    if (rc == RAFAELIA_LEARNING_STATUS_ERR_CAPACITY) {
        g_runtime.validation_prediction_misses += 1u;
        runtime_unlock();
        return RAFAELIA_LEARNING_STATUS_OK;
    }
    if (rc != RAFAELIA_LEARNING_STATUS_OK) {
        runtime_unlock();
        return rc;
    }

    ValidationEntry *entry = validation_entry_locked(context_hash);
    if (!entry) {
        runtime_unlock();
        return RAFAELIA_LEARNING_STATUS_ERR_CAPACITY;
    }

    entry->last_observation = g_runtime.validation_observations;
    if (entry->predictions != UINT32_MAX) entry->predictions += 1u;
    g_runtime.validation_predictions += 1u;
    if (predicted == candidate_id) {
        if (entry->correct != UINT32_MAX) entry->correct += 1u;
        g_runtime.validation_correct += 1u;
    } else {
        if (entry->incorrect != UINT32_MAX) entry->incorrect += 1u;
        g_runtime.validation_incorrect += 1u;
    }

    runtime_unlock();
    return RAFAELIA_LEARNING_STATUS_OK;
}

int rafaelia_learning_runtime_snapshot(RafaeliaLearningRuntimeSnapshotV1 *snapshot_out) {
    if (!snapshot_out) return RAFAELIA_LEARNING_STATUS_ERR_ARG;
    runtime_lock();
    if (!g_runtime.initialized) {
        runtime_unlock();
        return RAFAELIA_LEARNING_STATUS_ERR_STATE;
    }

    memset(snapshot_out, 0, sizeof(*snapshot_out));
    snapshot_out->abi_version = 1u;
    snapshot_out->logical_mode = g_runtime.logical_mode;
    int rc = rafaelia_learning_snapshot(&snapshot_out->store);
    if (rc != RAFAELIA_LEARNING_STATUS_OK) {
        runtime_unlock();
        return rc;
    }
    snapshot_out->neon4096 = g_runtime.neon4096;
    snapshot_out->validation_observations = g_runtime.validation_observations;
    snapshot_out->validation_predictions = g_runtime.validation_predictions;
    snapshot_out->validation_correct = g_runtime.validation_correct;
    snapshot_out->validation_incorrect = g_runtime.validation_incorrect;
    snapshot_out->validation_prediction_misses = g_runtime.validation_prediction_misses;
    snapshot_out->validation_contexts_used = g_runtime.validation_contexts_used;
    snapshot_out->validation_candidate_contexts =
        count_validation_candidates_locked(&snapshot_out->store);

    if (g_runtime.validation_predictions != 0u) {
        uint64_t error_ppm = g_runtime.validation_incorrect * UINT64_C(1000000) /
                             g_runtime.validation_predictions;
        uint64_t confidence_q16 = g_runtime.validation_correct * UINT64_C(65535) /
                                  g_runtime.validation_predictions;
        snapshot_out->validation_error_ppm =
            error_ppm > UINT32_MAX ? UINT32_MAX : (uint32_t)error_ppm;
        snapshot_out->validation_confidence_q16 =
            (uint16_t)(confidence_q16 > 65535u ? 65535u : confidence_q16);
    }

    snapshot_out->flags = RAFAELIA_RUNTIME_FLAG_ACTIVE_POLICY_DISABLED |
                          RAFAELIA_RUNTIME_FLAG_VALIDATION_PERSISTENCE_TOKEN_VAZIO;
    if (g_runtime.logical_mode == RAFAELIA_RUNTIME_VALIDATE_SHADOW)
        snapshot_out->flags |= RAFAELIA_RUNTIME_FLAG_VALIDATION_FROZEN_MODEL;

    runtime_unlock();
    return RAFAELIA_LEARNING_STATUS_OK;
}

int rafaelia_learning_runtime_flush(void) {
    runtime_lock();
    if (!g_runtime.initialized) {
        runtime_unlock();
        return RAFAELIA_LEARNING_STATUS_ERR_STATE;
    }
    int rc = rafaelia_learning_flush();
    runtime_unlock();
    return rc;
}

int rafaelia_learning_runtime_reset_volatile(void) {
    runtime_lock();
    if (!g_runtime.initialized ||
        (g_runtime.logical_mode != RAFAELIA_RUNTIME_OFF &&
         g_runtime.logical_mode != RAFAELIA_RUNTIME_FROZEN)) {
        runtime_unlock();
        return RAFAELIA_LEARNING_STATUS_ERR_STATE;
    }
    int rc = rafaelia_learning_reset_volatile();
    if (rc == RAFAELIA_LEARNING_STATUS_OK) reset_validation_locked();
    runtime_unlock();
    return rc;
}

int rafaelia_learning_runtime_close(void) {
    runtime_lock();
    if (!g_runtime.initialized) {
        runtime_unlock();
        return RAFAELIA_LEARNING_STATUS_ERR_STATE;
    }
    int rc = rafaelia_learning_close();
    memset(&g_runtime, 0, sizeof(g_runtime));
    runtime_unlock();
    return rc;
}

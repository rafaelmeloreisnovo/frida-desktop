#ifndef RAFAELIA_FRIDA_LEARNING_STORE_H
#define RAFAELIA_FRIDA_LEARNING_STORE_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define RAFAELIA_RFL_MAGIC UINT64_C(0x314C465241464152) /* "RAFAFRL1" LE bytes */
#define RAFAELIA_RFL_VERSION 1u
#define RAFAELIA_RFL_HEADER_BYTES 64u
#define RAFAELIA_RFL_RECORD_BYTES 64u
#define RAFAELIA_RFL_SLAB_BYTES 4096u
#define RAFAELIA_RFL_RECORDS_PER_SLAB \
    (RAFAELIA_RFL_SLAB_BYTES / RAFAELIA_RFL_RECORD_BYTES)

#define RAFAELIA_LEARNING_PREDICTOR_SETS 256u
#define RAFAELIA_LEARNING_PREDICTOR_WAYS 4u
#define RAFAELIA_LEARNING_PREDICTOR_ENTRIES \
    (RAFAELIA_LEARNING_PREDICTOR_SETS * RAFAELIA_LEARNING_PREDICTOR_WAYS)

#define RAFAELIA_LEARNING_DEFAULT_MIN_SUPPORT 4096u
#define RAFAELIA_LEARNING_DEFAULT_MAX_ERROR_PPM 1000u
#define RAFAELIA_LEARNING_DEFAULT_CONFIDENCE_Q16 65469u /* ~= 99.9% */

#define RAFAELIA_RFL_FLAG_PREDICTION_VALID (1u << 0)
#define RAFAELIA_RFL_FLAG_PREDICTION_CORRECT (1u << 1)
#define RAFAELIA_RFL_FLAG_LEARNING_UPDATE (1u << 2)
#define RAFAELIA_RFL_FLAG_VALIDATION_SAMPLE (1u << 3)
#define RAFAELIA_RFL_FLAG_MODE_SHIFT 8u
#define RAFAELIA_RFL_FLAG_MODE_MASK (7u << RAFAELIA_RFL_FLAG_MODE_SHIFT)

#define RAFAELIA_LEARNING_SNAPSHOT_RECOVERED_TAIL (1u << 0)
#define RAFAELIA_LEARNING_SNAPSHOT_PROMOTION_DISABLED (1u << 1)

typedef enum RafaeliaLearningMode {
    RAFAELIA_LEARNING_OFF = 0,
    RAFAELIA_LEARNING_OBSERVE = 1,
    RAFAELIA_LEARNING_LEARN_SHADOW = 2,
    RAFAELIA_LEARNING_PREDICT_SHADOW = 3,
    RAFAELIA_LEARNING_VALIDATE_SHADOW = 4,
    RAFAELIA_LEARNING_FROZEN = 5
} RafaeliaLearningMode;

typedef enum RafaeliaLearningStatus {
    RAFAELIA_LEARNING_STATUS_OK = 0,
    RAFAELIA_LEARNING_STATUS_ERR_ARG = -1,
    RAFAELIA_LEARNING_STATUS_ERR_IO = -2,
    RAFAELIA_LEARNING_STATUS_ERR_FORMAT = -3,
    RAFAELIA_LEARNING_STATUS_ERR_CRC = -4,
    RAFAELIA_LEARNING_STATUS_ERR_STATE = -5,
    RAFAELIA_LEARNING_STATUS_ERR_CAPACITY = -6
} RafaeliaLearningStatus;

#if defined(__GNUC__) || defined(__clang__)
#define RAFAELIA_PACKED __attribute__((packed))
#else
#define RAFAELIA_PACKED
#endif

typedef struct RAFAELIA_PACKED RafaeliaRflHeaderV1 {
    uint64_t magic;
    uint32_t version;
    uint32_t header_bytes;
    uint32_t record_bytes;
    uint32_t flags;
    uint64_t created_monotonic_ns;
    uint64_t epoch;
    uint64_t records_committed;
    uint64_t checkpoint_id;
    uint32_t header_crc32c;
    uint32_t reserved;
} RafaeliaRflHeaderV1;

typedef struct RAFAELIA_PACKED RafaeliaRflRecordV1 {
    uint64_t sequence;
    uint64_t monotonic_ns;
    uint64_t context_hash;
    uint32_t event_type;
    uint32_t candidate_id;
    uint32_t predicted_id;
    uint32_t prediction_support;
    uint32_t cost_ns_q;
    int32_t memory_delta_q;
    uint32_t aux_hash32;
    uint16_t confidence_q16;
    uint16_t error_q16;
    uint32_t flags;
    uint32_t crc32c;
} RafaeliaRflRecordV1;

typedef struct RafaeliaLearningSnapshotV1 {
    uint32_t abi_version;
    uint32_t mode;
    uint64_t epoch;
    uint64_t observations;
    uint64_t predictions;
    uint64_t correct_predictions;
    uint64_t incorrect_predictions;
    uint64_t validation_predictions;
    uint64_t validation_correct_predictions;
    uint64_t validation_incorrect_predictions;
    uint64_t dropped_observations;
    uint64_t records_committed;
    uint64_t store_bytes;
    uint64_t memory_high_water_bytes;
    uint64_t overhead_p50_ns;
    uint64_t overhead_p95_ns;
    uint64_t overhead_p99_ns;
    uint32_t predictor_entries_used;
    uint32_t eligible_contexts;
    uint32_t error_ppm;
    uint32_t validation_error_ppm;
    uint16_t global_confidence_q16;
    uint16_t validation_accuracy_q16;
    uint16_t slab_records_used;
    uint16_t reserved16;
    uint32_t flags;
} RafaeliaLearningSnapshotV1;

typedef struct RafaeliaLearningConfigV1 {
    uint32_t abi_version;
    uint32_t min_support;
    uint32_t max_error_ppm;
    uint16_t confidence_floor_q16;
    uint16_t reserved16;
    uint64_t overhead_budget_p99_ns;
    uint64_t memory_budget_bytes;
    uint32_t flags;
    uint32_t reserved32;
} RafaeliaLearningConfigV1;

#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 201112L
_Static_assert(sizeof(RafaeliaRflHeaderV1) == RAFAELIA_RFL_HEADER_BYTES,
               "RFL V1 header ABI must be exactly 64 bytes");
_Static_assert(sizeof(RafaeliaRflRecordV1) == RAFAELIA_RFL_RECORD_BYTES,
               "RFL V1 record ABI must be exactly 64 bytes");
_Static_assert(RAFAELIA_RFL_RECORDS_PER_SLAB == 64u,
               "RFL V1 slab must contain exactly 64 records");
#endif

int rafaelia_learning_init(const char *store_path,
                           const RafaeliaLearningConfigV1 *config);
int rafaelia_learning_set_mode(uint32_t mode);
int rafaelia_learning_get_mode(void);

/*
 * Observe one bounded event. In LEARN/PREDICT shadow modes the predictor may
 * update after scoring. In VALIDATE_SHADOW the predictor is read-only: the
 * actual outcome is recorded/scored but cannot change predictor state.
 */
int rafaelia_learning_observe(uint64_t context_hash,
                              uint32_t candidate_id,
                              uint32_t event_type,
                              uint64_t cost_ns,
                              int64_t memory_delta,
                              uint64_t aux_hash);

int rafaelia_learning_predict(uint64_t context_hash,
                              uint32_t *candidate_out,
                              uint16_t *confidence_q16_out,
                              uint32_t *support_out);

int rafaelia_learning_snapshot(RafaeliaLearningSnapshotV1 *snapshot_out);
int rafaelia_learning_flush(void);
int rafaelia_learning_freeze(void);
int rafaelia_learning_reset_volatile(void);
int rafaelia_learning_close(void);

#ifdef __cplusplus
}
#endif

#endif /* RAFAELIA_FRIDA_LEARNING_STORE_H */

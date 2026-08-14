#define _POSIX_C_SOURCE 200809L
#include "learning_store.h"

#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdatomic.h>
#include <stddef.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#if defined(__BYTE_ORDER__) && (__BYTE_ORDER__ != __ORDER_LITTLE_ENDIAN__)
#error "RFL V1 currently supports little-endian targets only"
#endif

#define RFL_LATENCY_SAMPLES 256u
#define RFL_AUX_FOLD(x) ((uint32_t)((x) ^ ((x) >> 32)))

typedef struct PredictorEntry {
    uint64_t context_hash;
    uint64_t last_sequence;
    uint64_t ewma_cost_ns;
    uint32_t candidate_id;
    uint32_t count;
    uint8_t used;
    uint8_t reserved[7];
} PredictorEntry;

typedef struct LearningState {
    int fd;
    uint8_t initialized;
    uint8_t recovered_tail;
    uint16_t reserved16;
    uint32_t mode;
    RafaeliaLearningConfigV1 config;
    RafaeliaRflHeaderV1 header;
    PredictorEntry predictor[RAFAELIA_LEARNING_PREDICTOR_ENTRIES];
    RafaeliaRflRecordV1 slab[RAFAELIA_RFL_RECORDS_PER_SLAB];
    uint32_t slab_used;
    uint32_t predictor_entries_used;
    uint64_t next_sequence;
    uint64_t observations;
    uint64_t predictions;
    uint64_t correct_predictions;
    uint64_t incorrect_predictions;
    uint64_t dropped_observations;
    int64_t tracked_memory_bytes;
    uint64_t memory_high_water_bytes;
    uint64_t latency_samples[RFL_LATENCY_SAMPLES];
    uint32_t latency_count;
    uint32_t latency_cursor;
} LearningState;

static LearningState g_state = { .fd = -1 };
static atomic_flag g_lock = ATOMIC_FLAG_INIT;

static void rfl_lock(void) {
    while (atomic_flag_test_and_set_explicit(&g_lock, memory_order_acquire)) {
    }
}

static void rfl_unlock(void) {
    atomic_flag_clear_explicit(&g_lock, memory_order_release);
}

static uint64_t rfl_monotonic_ns(void) {
    struct timespec ts;
    if (clock_gettime(CLOCK_MONOTONIC, &ts) != 0) return 0u;
    return (uint64_t)ts.tv_sec * UINT64_C(1000000000) + (uint64_t)ts.tv_nsec;
}

static uint32_t rfl_crc32c(const void *data, size_t size) {
    const uint8_t *p = (const uint8_t *)data;
    uint32_t crc = UINT32_C(0xffffffff);
    for (size_t i = 0; i < size; ++i) {
        crc ^= p[i];
        for (uint32_t bit = 0; bit < 8u; ++bit) {
            uint32_t mask = (uint32_t)-(int32_t)(crc & 1u);
            crc = (crc >> 1) ^ (UINT32_C(0x82f63b78) & mask);
        }
    }
    return ~crc;
}

static uint32_t rfl_header_crc(const RafaeliaRflHeaderV1 *header) {
    RafaeliaRflHeaderV1 copy;
    memcpy(&copy, header, sizeof(copy));
    copy.header_crc32c = 0u;
    return rfl_crc32c(&copy, sizeof(copy));
}

static uint32_t rfl_record_crc(const RafaeliaRflRecordV1 *record) {
    RafaeliaRflRecordV1 copy;
    memcpy(&copy, record, sizeof(copy));
    copy.crc32c = 0u;
    return rfl_crc32c(&copy, sizeof(copy));
}

static int rfl_write_full_at(int fd, const void *data, size_t size, off_t offset) {
    const uint8_t *p = (const uint8_t *)data;
    size_t done = 0u;
    while (done < size) {
        ssize_t n = pwrite(fd, p + done, size - done, offset + (off_t)done);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) return RAFAELIA_LEARNING_STATUS_ERR_IO;
        done += (size_t)n;
    }
    return RAFAELIA_LEARNING_STATUS_OK;
}

static int rfl_read_full_at(int fd, void *data, size_t size, off_t offset) {
    uint8_t *p = (uint8_t *)data;
    size_t done = 0u;
    while (done < size) {
        ssize_t n = pread(fd, p + done, size - done, offset + (off_t)done);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) return RAFAELIA_LEARNING_STATUS_ERR_IO;
        done += (size_t)n;
    }
    return RAFAELIA_LEARNING_STATUS_OK;
}

static void rfl_default_config(RafaeliaLearningConfigV1 *out) {
    memset(out, 0, sizeof(*out));
    out->abi_version = 1u;
    out->min_support = RAFAELIA_LEARNING_DEFAULT_MIN_SUPPORT;
    out->max_error_ppm = RAFAELIA_LEARNING_DEFAULT_MAX_ERROR_PPM;
    out->confidence_floor_q16 = RAFAELIA_LEARNING_DEFAULT_CONFIDENCE_Q16;
    out->overhead_budget_p99_ns = UINT64_C(250000);
    out->memory_budget_bytes = UINT64_C(4) * 1024u * 1024u;
}

static int rfl_validate_config(const RafaeliaLearningConfigV1 *config) {
    if (!config || config->abi_version != 1u || config->min_support == 0u)
        return RAFAELIA_LEARNING_STATUS_ERR_ARG;
    if (config->max_error_ppm > 1000000u)
        return RAFAELIA_LEARNING_STATUS_ERR_ARG;
    return RAFAELIA_LEARNING_STATUS_OK;
}

static uint32_t rfl_set_index(uint64_t context_hash) {
    uint64_t mixed = context_hash ^ (context_hash >> 33) ^ (context_hash >> 17);
    return (uint32_t)mixed & (RAFAELIA_LEARNING_PREDICTOR_SETS - 1u);
}

static int rfl_predict_locked(uint64_t context_hash,
                              uint32_t *candidate_out,
                              uint16_t *confidence_q16_out,
                              uint32_t *support_out) {
    uint32_t set = rfl_set_index(context_hash);
    uint32_t base = set * RAFAELIA_LEARNING_PREDICTOR_WAYS;
    uint64_t total = 0u;
    uint32_t best_count = 0u;
    uint32_t best_candidate = 0u;

    for (uint32_t way = 0u; way < RAFAELIA_LEARNING_PREDICTOR_WAYS; ++way) {
        PredictorEntry *entry = &g_state.predictor[base + way];
        if (!entry->used || entry->context_hash != context_hash) continue;
        total += entry->count;
        if (entry->count > best_count ||
            (entry->count == best_count && entry->candidate_id < best_candidate)) {
            best_count = entry->count;
            best_candidate = entry->candidate_id;
        }
    }

    if (total == 0u || best_count == 0u) return 0;
    if (candidate_out) *candidate_out = best_candidate;
    if (support_out) *support_out = total > UINT32_MAX ? UINT32_MAX : (uint32_t)total;
    if (confidence_q16_out) {
        uint64_t q = ((uint64_t)best_count * UINT64_C(65535)) / total;
        *confidence_q16_out = (uint16_t)(q > 65535u ? 65535u : q);
    }
    return 1;
}

static void rfl_update_predictor_locked(uint64_t context_hash,
                                        uint32_t candidate_id,
                                        uint64_t sequence,
                                        uint64_t cost_ns) {
    uint32_t set = rfl_set_index(context_hash);
    uint32_t base = set * RAFAELIA_LEARNING_PREDICTOR_WAYS;
    PredictorEntry *unused = NULL;
    PredictorEntry *victim = NULL;

    for (uint32_t way = 0u; way < RAFAELIA_LEARNING_PREDICTOR_WAYS; ++way) {
        PredictorEntry *entry = &g_state.predictor[base + way];
        if (entry->used && entry->context_hash == context_hash &&
            entry->candidate_id == candidate_id) {
            if (entry->count != UINT32_MAX) entry->count += 1u;
            entry->last_sequence = sequence;
            if (entry->ewma_cost_ns == 0u) entry->ewma_cost_ns = cost_ns;
            else entry->ewma_cost_ns = (entry->ewma_cost_ns * 7u + cost_ns) / 8u;
            return;
        }
        if (!entry->used && !unused) unused = entry;
        if (!victim || entry->count < victim->count ||
            (entry->count == victim->count && entry->last_sequence < victim->last_sequence)) {
            victim = entry;
        }
    }

    PredictorEntry *dst = unused ? unused : victim;
    if (!dst) return;
    if (!dst->used) g_state.predictor_entries_used += 1u;
    memset(dst, 0, sizeof(*dst));
    dst->used = 1u;
    dst->context_hash = context_hash;
    dst->candidate_id = candidate_id;
    dst->count = 1u;
    dst->last_sequence = sequence;
    dst->ewma_cost_ns = cost_ns;
}

static void rfl_record_latency_locked(uint64_t elapsed_ns) {
    g_state.latency_samples[g_state.latency_cursor] = elapsed_ns;
    g_state.latency_cursor = (g_state.latency_cursor + 1u) % RFL_LATENCY_SAMPLES;
    if (g_state.latency_count < RFL_LATENCY_SAMPLES) g_state.latency_count += 1u;
}

static uint64_t rfl_percentile_locked(uint32_t numerator, uint32_t denominator) {
    uint64_t values[RFL_LATENCY_SAMPLES];
    uint32_t n = g_state.latency_count;
    if (n == 0u) return 0u;
    for (uint32_t i = 0u; i < n; ++i) values[i] = g_state.latency_samples[i];
    for (uint32_t i = 1u; i < n; ++i) {
        uint64_t key = values[i];
        uint32_t j = i;
        while (j > 0u && values[j - 1u] > key) {
            values[j] = values[j - 1u];
            --j;
        }
        values[j] = key;
    }
    uint64_t rank = ((uint64_t)n * numerator + denominator - 1u) / denominator;
    if (rank == 0u) rank = 1u;
    if (rank > n) rank = n;
    return values[rank - 1u];
}

static int rfl_write_header_locked(void) {
    g_state.header.magic = RAFAELIA_RFL_MAGIC;
    g_state.header.version = RAFAELIA_RFL_VERSION;
    g_state.header.header_bytes = RAFAELIA_RFL_HEADER_BYTES;
    g_state.header.record_bytes = RAFAELIA_RFL_RECORD_BYTES;
    g_state.header.header_crc32c = 0u;
    g_state.header.header_crc32c = rfl_header_crc(&g_state.header);
    return rfl_write_full_at(g_state.fd, &g_state.header, sizeof(g_state.header), 0);
}

static int rfl_flush_slab_locked(int durable) {
    if (g_state.slab_used != 0u) {
        off_t offset = (off_t)RAFAELIA_RFL_HEADER_BYTES +
                       (off_t)(g_state.header.records_committed * RAFAELIA_RFL_RECORD_BYTES);
        size_t bytes = (size_t)g_state.slab_used * RAFAELIA_RFL_RECORD_BYTES;
        int rc = rfl_write_full_at(g_state.fd, g_state.slab, bytes, offset);
        if (rc != RAFAELIA_LEARNING_STATUS_OK) return rc;
        g_state.header.records_committed += g_state.slab_used;
        g_state.slab_used = 0u;
    }
    off_t exact_size = (off_t)RAFAELIA_RFL_HEADER_BYTES +
                       (off_t)(g_state.header.records_committed * RAFAELIA_RFL_RECORD_BYTES);
    if (ftruncate(g_state.fd, exact_size) != 0) return RAFAELIA_LEARNING_STATUS_ERR_IO;
    int rc = rfl_write_header_locked();
    if (rc != RAFAELIA_LEARNING_STATUS_OK) return rc;
    if (durable && fdatasync(g_state.fd) != 0) return RAFAELIA_LEARNING_STATUS_ERR_IO;
    return RAFAELIA_LEARNING_STATUS_OK;
}

static void rfl_replay_record_locked(const RafaeliaRflRecordV1 *record) {
    g_state.observations += 1u;
    if (record->flags & RAFAELIA_RFL_FLAG_PREDICTION_VALID) {
        g_state.predictions += 1u;
        if (record->flags & RAFAELIA_RFL_FLAG_PREDICTION_CORRECT)
            g_state.correct_predictions += 1u;
        else
            g_state.incorrect_predictions += 1u;
    }
    if (record->flags & RAFAELIA_RFL_FLAG_LEARNING_UPDATE) {
        rfl_update_predictor_locked(record->context_hash,
                                    record->candidate_id,
                                    record->sequence,
                                    record->cost_ns_q);
    }
    if (record->sequence >= g_state.next_sequence) g_state.next_sequence = record->sequence + 1u;
    g_state.tracked_memory_bytes += record->memory_delta_q;
    if (g_state.tracked_memory_bytes < 0) g_state.tracked_memory_bytes = 0;
    if ((uint64_t)g_state.tracked_memory_bytes > g_state.memory_high_water_bytes)
        g_state.memory_high_water_bytes = (uint64_t)g_state.tracked_memory_bytes;
}

static int rfl_replay_locked(off_t file_size) {
    if (file_size < (off_t)RAFAELIA_RFL_HEADER_BYTES)
        return RAFAELIA_LEARNING_STATUS_ERR_FORMAT;
    off_t payload = file_size - (off_t)RAFAELIA_RFL_HEADER_BYTES;
    uint64_t full_records = (uint64_t)payload / RAFAELIA_RFL_RECORD_BYTES;
    if ((uint64_t)payload % RAFAELIA_RFL_RECORD_BYTES) g_state.recovered_tail = 1u;

    uint8_t block[RAFAELIA_RFL_SLAB_BYTES];
    uint64_t valid = 0u;
    while (valid < full_records) {
        uint64_t remaining = full_records - valid;
        uint32_t batch_records = remaining > RAFAELIA_RFL_RECORDS_PER_SLAB
            ? RAFAELIA_RFL_RECORDS_PER_SLAB : (uint32_t)remaining;
        size_t bytes = (size_t)batch_records * RAFAELIA_RFL_RECORD_BYTES;
        off_t offset = (off_t)RAFAELIA_RFL_HEADER_BYTES +
                       (off_t)(valid * RAFAELIA_RFL_RECORD_BYTES);
        int rc = rfl_read_full_at(g_state.fd, block, bytes, offset);
        if (rc != RAFAELIA_LEARNING_STATUS_OK) return rc;

        for (uint32_t i = 0u; i < batch_records; ++i) {
            RafaeliaRflRecordV1 record;
            memcpy(&record, block + (size_t)i * RAFAELIA_RFL_RECORD_BYTES, sizeof(record));
            uint32_t stored_crc = record.crc32c;
            if (stored_crc != rfl_record_crc(&record)) {
                g_state.recovered_tail = 1u;
                g_state.header.records_committed = valid + i;
                return RAFAELIA_LEARNING_STATUS_OK;
            }
            rfl_replay_record_locked(&record);
        }
        valid += batch_records;
    }
    g_state.header.records_committed = valid;
    return RAFAELIA_LEARNING_STATUS_OK;
}

int rafaelia_learning_init(const char *store_path,
                           const RafaeliaLearningConfigV1 *config) {
    if (!store_path || store_path[0] == '\0') return RAFAELIA_LEARNING_STATUS_ERR_ARG;
    rfl_lock();
    if (g_state.initialized) {
        rfl_unlock();
        return RAFAELIA_LEARNING_STATUS_ERR_STATE;
    }

    memset(&g_state, 0, sizeof(g_state));
    g_state.fd = -1;
    rfl_default_config(&g_state.config);
    if (config) g_state.config = *config;
    int rc = rfl_validate_config(&g_state.config);
    if (rc != RAFAELIA_LEARNING_STATUS_OK) {
        rfl_unlock();
        return rc;
    }

    int fd = open(store_path, O_RDWR | O_CREAT | O_CLOEXEC, 0600);
    if (fd < 0) {
        rfl_unlock();
        return RAFAELIA_LEARNING_STATUS_ERR_IO;
    }
    g_state.fd = fd;

    struct stat st;
    if (fstat(fd, &st) != 0) {
        close(fd);
        g_state.fd = -1;
        rfl_unlock();
        return RAFAELIA_LEARNING_STATUS_ERR_IO;
    }

    if (st.st_size == 0) {
        memset(&g_state.header, 0, sizeof(g_state.header));
        g_state.header.magic = RAFAELIA_RFL_MAGIC;
        g_state.header.version = RAFAELIA_RFL_VERSION;
        g_state.header.header_bytes = RAFAELIA_RFL_HEADER_BYTES;
        g_state.header.record_bytes = RAFAELIA_RFL_RECORD_BYTES;
        g_state.header.created_monotonic_ns = rfl_monotonic_ns();
        g_state.header.epoch = 1u;
        g_state.header.records_committed = 0u;
        rc = rfl_write_header_locked();
        if (rc == RAFAELIA_LEARNING_STATUS_OK && fdatasync(fd) != 0)
            rc = RAFAELIA_LEARNING_STATUS_ERR_IO;
    } else {
        rc = rfl_read_full_at(fd, &g_state.header, sizeof(g_state.header), 0);
        if (rc == RAFAELIA_LEARNING_STATUS_OK) {
            uint32_t stored_crc = g_state.header.header_crc32c;
            if (g_state.header.magic != RAFAELIA_RFL_MAGIC ||
                g_state.header.version != RAFAELIA_RFL_VERSION ||
                g_state.header.header_bytes != RAFAELIA_RFL_HEADER_BYTES ||
                g_state.header.record_bytes != RAFAELIA_RFL_RECORD_BYTES)
                rc = RAFAELIA_LEARNING_STATUS_ERR_FORMAT;
            else if (stored_crc != rfl_header_crc(&g_state.header))
                rc = RAFAELIA_LEARNING_STATUS_ERR_CRC;
        }
        if (rc == RAFAELIA_LEARNING_STATUS_OK) rc = rfl_replay_locked(st.st_size);
    }

    if (rc != RAFAELIA_LEARNING_STATUS_OK) {
        close(fd);
        g_state.fd = -1;
        rfl_unlock();
        return rc;
    }

    g_state.mode = RAFAELIA_LEARNING_OFF;
    if (g_state.next_sequence == 0u) g_state.next_sequence = g_state.header.records_committed + 1u;
    g_state.initialized = 1u;
    rfl_unlock();
    return RAFAELIA_LEARNING_STATUS_OK;
}

int rafaelia_learning_set_mode(uint32_t mode) {
    if (mode > RAFAELIA_LEARNING_FROZEN) return RAFAELIA_LEARNING_STATUS_ERR_ARG;
    rfl_lock();
    if (!g_state.initialized) {
        rfl_unlock();
        return RAFAELIA_LEARNING_STATUS_ERR_STATE;
    }
    if (mode == RAFAELIA_LEARNING_OFF || mode == RAFAELIA_LEARNING_FROZEN) {
        int rc = rfl_flush_slab_locked(1);
        if (rc != RAFAELIA_LEARNING_STATUS_OK) {
            rfl_unlock();
            return rc;
        }
    }
    if (g_state.mode != mode) g_state.header.epoch += 1u;
    g_state.mode = mode;
    rfl_unlock();
    return RAFAELIA_LEARNING_STATUS_OK;
}

int rafaelia_learning_get_mode(void) {
    rfl_lock();
    int mode = g_state.initialized ? (int)g_state.mode : RAFAELIA_LEARNING_STATUS_ERR_STATE;
    rfl_unlock();
    return mode;
}

int rafaelia_learning_predict(uint64_t context_hash,
                              uint32_t *candidate_out,
                              uint16_t *confidence_q16_out,
                              uint32_t *support_out) {
    if (!candidate_out || !confidence_q16_out || !support_out)
        return RAFAELIA_LEARNING_STATUS_ERR_ARG;
    rfl_lock();
    if (!g_state.initialized ||
        (g_state.mode != RAFAELIA_LEARNING_LEARN_SHADOW &&
         g_state.mode != RAFAELIA_LEARNING_PREDICT_SHADOW &&
         g_state.mode != RAFAELIA_LEARNING_FROZEN)) {
        rfl_unlock();
        return RAFAELIA_LEARNING_STATUS_ERR_STATE;
    }
    int found = rfl_predict_locked(context_hash, candidate_out, confidence_q16_out, support_out);
    rfl_unlock();
    return found ? RAFAELIA_LEARNING_STATUS_OK : RAFAELIA_LEARNING_STATUS_ERR_CAPACITY;
}

int rafaelia_learning_observe(uint64_t context_hash,
                              uint32_t candidate_id,
                              uint32_t event_type,
                              uint64_t cost_ns,
                              int64_t memory_delta,
                              uint64_t aux_hash) {
    uint64_t started = rfl_monotonic_ns();
    rfl_lock();
    if (!g_state.initialized || g_state.mode == RAFAELIA_LEARNING_OFF ||
        g_state.mode == RAFAELIA_LEARNING_FROZEN) {
        rfl_unlock();
        return RAFAELIA_LEARNING_STATUS_ERR_STATE;
    }

    uint32_t predicted = 0u;
    uint32_t support = 0u;
    uint16_t confidence = 0u;
    int prediction_valid = 0;
    uint32_t flags = (g_state.mode << RAFAELIA_RFL_FLAG_MODE_SHIFT) & RAFAELIA_RFL_FLAG_MODE_MASK;

    if (g_state.mode == RAFAELIA_LEARNING_LEARN_SHADOW ||
        g_state.mode == RAFAELIA_LEARNING_PREDICT_SHADOW) {
        prediction_valid = rfl_predict_locked(context_hash, &predicted, &confidence, &support);
        if (prediction_valid) {
            flags |= RAFAELIA_RFL_FLAG_PREDICTION_VALID;
            g_state.predictions += 1u;
            if (predicted == candidate_id) {
                flags |= RAFAELIA_RFL_FLAG_PREDICTION_CORRECT;
                g_state.correct_predictions += 1u;
            } else {
                g_state.incorrect_predictions += 1u;
            }
        }
    }

    uint64_t sequence = g_state.next_sequence++;
    if (g_state.mode == RAFAELIA_LEARNING_LEARN_SHADOW ||
        g_state.mode == RAFAELIA_LEARNING_PREDICT_SHADOW) {
        flags |= RAFAELIA_RFL_FLAG_LEARNING_UPDATE;
        rfl_update_predictor_locked(context_hash, candidate_id, sequence, cost_ns);
    }

    RafaeliaRflRecordV1 record;
    memset(&record, 0, sizeof(record));
    record.sequence = sequence;
    record.monotonic_ns = started;
    record.context_hash = context_hash;
    record.event_type = event_type;
    record.candidate_id = candidate_id;
    record.predicted_id = predicted;
    record.prediction_support = support;
    record.cost_ns_q = cost_ns > UINT32_MAX ? UINT32_MAX : (uint32_t)cost_ns;
    if (memory_delta > INT32_MAX) record.memory_delta_q = INT32_MAX;
    else if (memory_delta < INT32_MIN) record.memory_delta_q = INT32_MIN;
    else record.memory_delta_q = (int32_t)memory_delta;
    record.aux_hash32 = RFL_AUX_FOLD(aux_hash);
    record.confidence_q16 = confidence;
    record.error_q16 = prediction_valid ? (uint16_t)(65535u - confidence) : 65535u;
    record.flags = flags;
    record.crc32c = rfl_record_crc(&record);

    if (g_state.slab_used >= RAFAELIA_RFL_RECORDS_PER_SLAB) {
        g_state.dropped_observations += 1u;
        rfl_unlock();
        return RAFAELIA_LEARNING_STATUS_ERR_CAPACITY;
    }
    g_state.slab[g_state.slab_used++] = record;
    g_state.observations += 1u;

    if (memory_delta > 0 && g_state.tracked_memory_bytes > INT64_MAX - memory_delta)
        g_state.tracked_memory_bytes = INT64_MAX;
    else if (memory_delta == INT64_MIN)
        g_state.tracked_memory_bytes = 0;
    else if (memory_delta < 0 && g_state.tracked_memory_bytes < -memory_delta)
        g_state.tracked_memory_bytes = 0;
    else
        g_state.tracked_memory_bytes += memory_delta;
    if (g_state.tracked_memory_bytes < 0) g_state.tracked_memory_bytes = 0;
    if ((uint64_t)g_state.tracked_memory_bytes > g_state.memory_high_water_bytes)
        g_state.memory_high_water_bytes = (uint64_t)g_state.tracked_memory_bytes;

    int rc = RAFAELIA_LEARNING_STATUS_OK;
    if (g_state.slab_used == RAFAELIA_RFL_RECORDS_PER_SLAB) {
        rc = rfl_flush_slab_locked(0);
        if (rc != RAFAELIA_LEARNING_STATUS_OK) g_state.dropped_observations += 1u;
    }

    uint64_t ended = rfl_monotonic_ns();
    if (ended >= started) rfl_record_latency_locked(ended - started);
    rfl_unlock();
    return rc;
}

int rafaelia_learning_snapshot(RafaeliaLearningSnapshotV1 *snapshot_out) {
    if (!snapshot_out) return RAFAELIA_LEARNING_STATUS_ERR_ARG;
    rfl_lock();
    if (!g_state.initialized) {
        rfl_unlock();
        return RAFAELIA_LEARNING_STATUS_ERR_STATE;
    }
    memset(snapshot_out, 0, sizeof(*snapshot_out));
    snapshot_out->abi_version = 1u;
    snapshot_out->mode = g_state.mode;
    snapshot_out->epoch = g_state.header.epoch;
    snapshot_out->observations = g_state.observations;
    snapshot_out->predictions = g_state.predictions;
    snapshot_out->correct_predictions = g_state.correct_predictions;
    snapshot_out->incorrect_predictions = g_state.incorrect_predictions;
    snapshot_out->dropped_observations = g_state.dropped_observations;
    snapshot_out->records_committed = g_state.header.records_committed;
    snapshot_out->store_bytes = RAFAELIA_RFL_HEADER_BYTES +
        (g_state.header.records_committed + g_state.slab_used) * RAFAELIA_RFL_RECORD_BYTES;
    snapshot_out->memory_high_water_bytes = g_state.memory_high_water_bytes;
    snapshot_out->overhead_p50_ns = rfl_percentile_locked(50u, 100u);
    snapshot_out->overhead_p95_ns = rfl_percentile_locked(95u, 100u);
    snapshot_out->overhead_p99_ns = rfl_percentile_locked(99u, 100u);
    snapshot_out->predictor_entries_used = g_state.predictor_entries_used;
    snapshot_out->eligible_contexts = 0u; /* Phase 3 governs promotion eligibility. */
    if (g_state.predictions != 0u) {
        uint64_t errors = g_state.incorrect_predictions;
        uint64_t ppm = errors * UINT64_C(1000000) / g_state.predictions;
        snapshot_out->error_ppm = ppm > UINT32_MAX ? UINT32_MAX : (uint32_t)ppm;
        uint64_t confidence = g_state.correct_predictions * UINT64_C(65535) / g_state.predictions;
        snapshot_out->global_confidence_q16 = (uint16_t)(confidence > 65535u ? 65535u : confidence);
    }
    snapshot_out->slab_records_used = (uint16_t)g_state.slab_used;
    snapshot_out->flags = RAFAELIA_LEARNING_SNAPSHOT_PROMOTION_DISABLED;
    if (g_state.recovered_tail) snapshot_out->flags |= RAFAELIA_LEARNING_SNAPSHOT_RECOVERED_TAIL;
    rfl_unlock();
    return RAFAELIA_LEARNING_STATUS_OK;
}

int rafaelia_learning_flush(void) {
    rfl_lock();
    if (!g_state.initialized) {
        rfl_unlock();
        return RAFAELIA_LEARNING_STATUS_ERR_STATE;
    }
    int rc = rfl_flush_slab_locked(1);
    rfl_unlock();
    return rc;
}

int rafaelia_learning_freeze(void) {
    rfl_lock();
    if (!g_state.initialized) {
        rfl_unlock();
        return RAFAELIA_LEARNING_STATUS_ERR_STATE;
    }
    int rc = rfl_flush_slab_locked(1);
    if (rc == RAFAELIA_LEARNING_STATUS_OK) {
        g_state.mode = RAFAELIA_LEARNING_FROZEN;
        g_state.header.epoch += 1u;
        rc = rfl_write_header_locked();
        if (rc == RAFAELIA_LEARNING_STATUS_OK && fdatasync(g_state.fd) != 0)
            rc = RAFAELIA_LEARNING_STATUS_ERR_IO;
    }
    rfl_unlock();
    return rc;
}

int rafaelia_learning_reset_volatile(void) {
    rfl_lock();
    if (!g_state.initialized ||
        (g_state.mode != RAFAELIA_LEARNING_OFF && g_state.mode != RAFAELIA_LEARNING_FROZEN)) {
        rfl_unlock();
        return RAFAELIA_LEARNING_STATUS_ERR_STATE;
    }
    memset(g_state.predictor, 0, sizeof(g_state.predictor));
    g_state.predictor_entries_used = 0u;
    g_state.predictions = 0u;
    g_state.correct_predictions = 0u;
    g_state.incorrect_predictions = 0u;
    g_state.latency_count = 0u;
    g_state.latency_cursor = 0u;
    g_state.header.epoch += 1u;
    rfl_unlock();
    return RAFAELIA_LEARNING_STATUS_OK;
}

int rafaelia_learning_close(void) {
    rfl_lock();
    if (!g_state.initialized) {
        rfl_unlock();
        return RAFAELIA_LEARNING_STATUS_ERR_STATE;
    }
    int rc = rfl_flush_slab_locked(1);
    int fd = g_state.fd;
    if (close(fd) != 0 && rc == RAFAELIA_LEARNING_STATUS_OK)
        rc = RAFAELIA_LEARNING_STATUS_ERR_IO;
    memset(&g_state, 0, sizeof(g_state));
    g_state.fd = -1;
    rfl_unlock();
    return rc;
}

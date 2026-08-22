#include <jni.h>
#include <stdint.h>
#include <stdio.h>

#include "learning_store.h"
#include "neon4096_core.h"
#include "learning_runtime.h"

/*
 * The standalone lab workflow intentionally builds one source translation unit.
 * Keep the native modules amalgamated here until they graduate to a canonical
 * Android/native source manifest. The modules remain separately self-tested.
 */
#include "learning_store.c"
#include "neon4096_core.c"
#include "learning_runtime.c"

__attribute__((visibility("default")))
const char *rafaelia_elf_probe_identity(void) {
    return "RAFAELIA_ELF_PROBE_V2_RFL_NEON4096_VALIDATE";
}

__attribute__((visibility("default")))
uint32_t rafaelia_elf_probe_abi_word(void) {
#if defined(__aarch64__)
    return 0xA6417002u;
#elif defined(__arm__)
    return 0xA3270002u;
#else
    return 0u;
#endif
}

static const char *learning_mode_name(uint32_t mode) {
    switch (mode) {
        case RAFAELIA_RUNTIME_OFF: return "OFF";
        case RAFAELIA_RUNTIME_OBSERVE: return "OBSERVE";
        case RAFAELIA_RUNTIME_LEARN_SHADOW: return "LEARN_SHADOW";
        case RAFAELIA_RUNTIME_PREDICT_SHADOW: return "PREDICT_SHADOW";
        case RAFAELIA_RUNTIME_VALIDATE_SHADOW: return "VALIDATE_SHADOW";
        case RAFAELIA_RUNTIME_FROZEN: return "FROZEN";
        default: return "UNKNOWN";
    }
}

JNIEXPORT jint JNICALL
Java_io_rafaelia_fridalab_MainActivity_nativeLearningInit(
        JNIEnv *env, jclass clazz, jstring path) {
    (void)clazz;
    if (!path) return RAFAELIA_LEARNING_STATUS_ERR_ARG;
    const char *utf = (*env)->GetStringUTFChars(env, path, NULL);
    if (!utf) return RAFAELIA_LEARNING_STATUS_ERR_ARG;
    int rc = rafaelia_learning_runtime_init(utf);
    (*env)->ReleaseStringUTFChars(env, path, utf);
    return rc;
}

JNIEXPORT jint JNICALL
Java_io_rafaelia_fridalab_MainActivity_nativeLearningSetMode(
        JNIEnv *env, jclass clazz, jint mode) {
    (void)env;
    (void)clazz;
    return rafaelia_learning_runtime_set_mode((uint32_t)mode);
}

JNIEXPORT jint JNICALL
Java_io_rafaelia_fridalab_MainActivity_nativeLearningFlush(
        JNIEnv *env, jclass clazz) {
    (void)env;
    (void)clazz;
    return rafaelia_learning_runtime_flush();
}

JNIEXPORT jint JNICALL
Java_io_rafaelia_fridalab_MainActivity_nativeLearningResetVolatile(
        JNIEnv *env, jclass clazz) {
    (void)env;
    (void)clazz;
    return rafaelia_learning_runtime_reset_volatile();
}

JNIEXPORT jint JNICALL
Java_io_rafaelia_fridalab_MainActivity_learningObserve(
        JNIEnv *env,
        jclass clazz,
        jlong context_hash,
        jint candidate_id,
        jint event_type,
        jlong cost_ns,
        jlong memory_delta,
        jlong aux_hash) {
    (void)env;
    (void)clazz;
    return rafaelia_learning_runtime_observe(
        (uint64_t)context_hash,
        (uint32_t)candidate_id,
        (uint32_t)event_type,
        cost_ns < 0 ? 0u : (uint64_t)cost_ns,
        (int64_t)memory_delta,
        (uint64_t)aux_hash);
}

JNIEXPORT jstring JNICALL
Java_io_rafaelia_fridalab_MainActivity_nativeLearningSnapshot(
        JNIEnv *env, jclass clazz, jboolean verbose) {
    (void)clazz;
    RafaeliaLearningRuntimeSnapshotV1 runtime;
    int rc = rafaelia_learning_runtime_snapshot(&runtime);
    char text[4096];

    if (rc != RAFAELIA_LEARNING_STATUS_OK) {
        snprintf(text, sizeof(text), "Learning runtime: ERROR rc=%d", rc);
        return (*env)->NewStringUTF(env, text);
    }

    const RafaeliaLearningSnapshotV1 *snapshot = &runtime.store;
    uint64_t confidence_bp = snapshot->predictions == 0u
        ? 0u
        : ((uint64_t)snapshot->global_confidence_q16 * 10000u) / 65535u;
    uint64_t validation_confidence_bp = runtime.validation_predictions == 0u
        ? 0u
        : ((uint64_t)runtime.validation_confidence_q16 * 10000u) / 65535u;

    if (!verbose) {
        snprintf(text, sizeof(text),
                 "Learning: %s | train obs=%llu pred=%llu err=%u ppm | validate pred=%llu err=%u ppm | NEON4096=%s/%uB | GPU=TOKEN_VAZIO | store=%llu B",
                 learning_mode_name(runtime.logical_mode),
                 (unsigned long long)snapshot->observations,
                 (unsigned long long)snapshot->predictions,
                 snapshot->error_ppm,
                 (unsigned long long)runtime.validation_predictions,
                 runtime.validation_error_ppm,
                 rafaelia_neon4096_backend_name(runtime.neon4096.backend),
                 runtime.neon4096.observed_page_size,
                 (unsigned long long)snapshot->store_bytes);
    } else {
        snprintf(text, sizeof(text),
                 "Learning runtime\n"
                 "  logical mode: %s\n"
                 "  RFL epoch: %llu\n"
                 "  training observations: %llu\n"
                 "  training predictions: %llu\n"
                 "  training correct/incorrect: %llu / %llu\n"
                 "  training error: %u ppm\n"
                 "  training confidence: %s%llu.%02llu%%\n"
                 "  predictor entries: %u/%u\n"
                 "  RFL committed records: %llu\n"
                 "  RFL slab: %u/%u records\n"
                 "  RFL store bytes: %llu\n"
                 "  tracked memory high-water: %llu B\n"
                 "  learning overhead p50/p95/p99: %llu / %llu / %llu ns\n"
                 "\n"
                 "VALIDATE_SHADOW\n"
                 "  model frozen: %s\n"
                 "  observations: %llu\n"
                 "  predictions: %llu\n"
                 "  correct/incorrect: %llu / %llu\n"
                 "  prediction misses: %llu\n"
                 "  error: %u ppm\n"
                 "  confidence: %s%llu.%02llu%%\n"
                 "  validation contexts: %u/%u\n"
                 "  candidate contexts after accuracy/support gates: %u\n"
                 "  validation persistence: TOKEN_VAZIO\n"
                 "  automatic ACTIVE policy: DISABLED\n"
                 "\n"
                 "NEON4096/3 V1\n"
                 "  contract: 4096 B = 64 B control + 3 x 1344 B\n"
                 "  alternate partition: 8 x 512 B microblocks\n"
                 "  cache geometry: 64 x 64 B lines; 21 lines/region\n"
                 "  SIMD geometry: 256 x 128-bit vectors; 84 vectors/region\n"
                 "  observed OS page: %u B (%s)\n"
                 "  compiled backend: %s\n"
                 "  default CPU route: %s\n"
                 "  CRC32C: HOT + BUFFER + STORAGE + PAGE\n"
                 "  SIMD fold selftest: %s\n"
                 "  selftest page CRC32C: 0x%08x\n"
                 "  GPU compute backend: TOKEN_VAZIO / not promoted\n"
                 "  GPU routing rule: only after measured backend + total-cost evidence\n"
                 "\n"
                 "RFL recovered tail: %s",
                 learning_mode_name(runtime.logical_mode),
                 (unsigned long long)snapshot->epoch,
                 (unsigned long long)snapshot->observations,
                 (unsigned long long)snapshot->predictions,
                 (unsigned long long)snapshot->correct_predictions,
                 (unsigned long long)snapshot->incorrect_predictions,
                 snapshot->error_ppm,
                 snapshot->predictions == 0u ? "INSUFFICIENT_EVIDENCE / " : "",
                 (unsigned long long)(confidence_bp / 100u),
                 (unsigned long long)(confidence_bp % 100u),
                 snapshot->predictor_entries_used,
                 RAFAELIA_LEARNING_PREDICTOR_ENTRIES,
                 (unsigned long long)snapshot->records_committed,
                 snapshot->slab_records_used,
                 RAFAELIA_RFL_RECORDS_PER_SLAB,
                 (unsigned long long)snapshot->store_bytes,
                 (unsigned long long)snapshot->memory_high_water_bytes,
                 (unsigned long long)snapshot->overhead_p50_ns,
                 (unsigned long long)snapshot->overhead_p95_ns,
                 (unsigned long long)snapshot->overhead_p99_ns,
                 (runtime.flags & RAFAELIA_RUNTIME_FLAG_VALIDATION_FROZEN_MODEL) ? "YES" : "NO",
                 (unsigned long long)runtime.validation_observations,
                 (unsigned long long)runtime.validation_predictions,
                 (unsigned long long)runtime.validation_correct,
                 (unsigned long long)runtime.validation_incorrect,
                 (unsigned long long)runtime.validation_prediction_misses,
                 runtime.validation_error_ppm,
                 runtime.validation_predictions == 0u ? "INSUFFICIENT_EVIDENCE / " : "",
                 (unsigned long long)(validation_confidence_bp / 100u),
                 (unsigned long long)(validation_confidence_bp % 100u),
                 runtime.validation_contexts_used,
                 RAFAELIA_RUNTIME_VALIDATION_ENTRIES,
                 runtime.validation_candidate_contexts,
                 runtime.neon4096.observed_page_size,
                 (runtime.neon4096.flags & RAFAELIA_NEON4096_FLAG_PAGE_SIZE_MATCH) ? "MATCH_4096" : "OBSERVED_MISMATCH",
                 rafaelia_neon4096_backend_name(runtime.neon4096.backend),
                 rafaelia_neon4096_route_name(runtime.neon4096.default_route),
                 (runtime.neon4096.flags & RAFAELIA_NEON4096_FLAG_SELFTEST_PASS) ? "PASS" : "FAIL",
                 runtime.neon4096.selftest_crc32c,
                 (snapshot->flags & RAFAELIA_LEARNING_SNAPSHOT_RECOVERED_TAIL) ? "YES" : "NO");
    }

    return (*env)->NewStringUTF(env, text);
}

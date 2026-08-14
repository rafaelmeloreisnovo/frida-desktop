#include <jni.h>
#include <stdint.h>
#include <stdio.h>

#include "learning_store.h"

/*
 * The standalone lab workflow intentionally builds one source translation unit.
 * Keep the learning implementation amalgamated here until it graduates to the
 * repository's canonical Android/native source manifest.
 */
#include "learning_store.c"

__attribute__((visibility("default")))
const char *rafaelia_elf_probe_identity(void) {
    return "RAFAELIA_ELF_PROBE_V1_RFL_SHADOW";
}

__attribute__((visibility("default")))
uint32_t rafaelia_elf_probe_abi_word(void) {
#if defined(__aarch64__)
    return 0xA6417001u;
#elif defined(__arm__)
    return 0xA3270001u;
#else
    return 0u;
#endif
}

static const char *learning_mode_name(uint32_t mode) {
    switch (mode) {
        case RAFAELIA_LEARNING_OFF: return "OFF";
        case RAFAELIA_LEARNING_OBSERVE: return "OBSERVE";
        case RAFAELIA_LEARNING_LEARN_SHADOW: return "LEARN_SHADOW";
        case RAFAELIA_LEARNING_PREDICT_SHADOW: return "PREDICT_SHADOW";
        case RAFAELIA_LEARNING_FROZEN: return "FROZEN";
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
    int rc = rafaelia_learning_init(utf, NULL);
    (*env)->ReleaseStringUTFChars(env, path, utf);
    return rc;
}

JNIEXPORT jint JNICALL
Java_io_rafaelia_fridalab_MainActivity_nativeLearningSetMode(
        JNIEnv *env, jclass clazz, jint mode) {
    (void)env;
    (void)clazz;
    return rafaelia_learning_set_mode((uint32_t)mode);
}

JNIEXPORT jint JNICALL
Java_io_rafaelia_fridalab_MainActivity_nativeLearningFlush(
        JNIEnv *env, jclass clazz) {
    (void)env;
    (void)clazz;
    return rafaelia_learning_flush();
}

JNIEXPORT jint JNICALL
Java_io_rafaelia_fridalab_MainActivity_nativeLearningResetVolatile(
        JNIEnv *env, jclass clazz) {
    (void)env;
    (void)clazz;
    return rafaelia_learning_reset_volatile();
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
    return rafaelia_learning_observe(
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
    RafaeliaLearningSnapshotV1 snapshot;
    int rc = rafaelia_learning_snapshot(&snapshot);
    char text[1536];

    if (rc != RAFAELIA_LEARNING_STATUS_OK) {
        snprintf(text, sizeof(text), "Learning core: ERROR rc=%d", rc);
        return (*env)->NewStringUTF(env, text);
    }

    uint64_t confidence_bp = snapshot.predictions == 0u
        ? 0u
        : ((uint64_t)snapshot.global_confidence_q16 * 10000u) / 65535u;

    if (!verbose) {
        snprintf(text, sizeof(text),
                 "Learning: %s | obs=%llu | pred=%llu | error=%u ppm | confidence=%s%llu.%02llu%% | store=%llu B",
                 learning_mode_name(snapshot.mode),
                 (unsigned long long)snapshot.observations,
                 (unsigned long long)snapshot.predictions,
                 snapshot.error_ppm,
                 snapshot.predictions == 0u ? "INSUFFICIENT_EVIDENCE / " : "",
                 (unsigned long long)(confidence_bp / 100u),
                 (unsigned long long)(confidence_bp % 100u),
                 (unsigned long long)snapshot.store_bytes);
    } else {
        snprintf(text, sizeof(text),
                 "Learning core\n"
                 "  mode: %s\n"
                 "  epoch: %llu\n"
                 "  observations: %llu\n"
                 "  predictions: %llu\n"
                 "  correct: %llu\n"
                 "  incorrect: %llu\n"
                 "  dropped: %llu\n"
                 "  error: %u ppm\n"
                 "  confidence: %s%llu.%02llu%%\n"
                 "  predictor entries: %u/%u\n"
                 "  RFL committed records: %llu\n"
                 "  slab: %u/%u records\n"
                 "  store bytes: %llu\n"
                 "  tracked memory high-water: %llu B\n"
                 "  learning overhead p50/p95/p99: %llu / %llu / %llu ns\n"
                 "  eligible contexts: %u (promotion disabled in V1)\n"
                 "  recovered tail: %s",
                 learning_mode_name(snapshot.mode),
                 (unsigned long long)snapshot.epoch,
                 (unsigned long long)snapshot.observations,
                 (unsigned long long)snapshot.predictions,
                 (unsigned long long)snapshot.correct_predictions,
                 (unsigned long long)snapshot.incorrect_predictions,
                 (unsigned long long)snapshot.dropped_observations,
                 snapshot.error_ppm,
                 snapshot.predictions == 0u ? "INSUFFICIENT_EVIDENCE / " : "",
                 (unsigned long long)(confidence_bp / 100u),
                 (unsigned long long)(confidence_bp % 100u),
                 snapshot.predictor_entries_used,
                 RAFAELIA_LEARNING_PREDICTOR_ENTRIES,
                 (unsigned long long)snapshot.records_committed,
                 snapshot.slab_records_used,
                 RAFAELIA_RFL_RECORDS_PER_SLAB,
                 (unsigned long long)snapshot.store_bytes,
                 (unsigned long long)snapshot.memory_high_water_bytes,
                 (unsigned long long)snapshot.overhead_p50_ns,
                 (unsigned long long)snapshot.overhead_p95_ns,
                 (unsigned long long)snapshot.overhead_p99_ns,
                 snapshot.eligible_contexts,
                 (snapshot.flags & RAFAELIA_LEARNING_SNAPSHOT_RECOVERED_TAIL) ? "YES" : "NO");
    }

    return (*env)->NewStringUTF(env, text);
}

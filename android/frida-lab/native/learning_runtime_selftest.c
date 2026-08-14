#define _POSIX_C_SOURCE 200809L
#include "learning_runtime.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static void must(int condition, const char *message) {
    if (!condition) {
        fprintf(stderr, "RUNTIME SELFTEST FAIL: %s\n", message);
        exit(1);
    }
}

int main(void) {
    must(sizeof(RafaeliaNeon4096ControlV1) == 64u, "NEON4096 control is 64 B");
    must(sizeof(RafaeliaNeon4096PageV1) == 4096u, "NEON4096 page is 4096 B");
    must(RAFAELIA_NEON4096_REGION_BYTES == 1344u, "one-third region is 1344 B");
    must(RAFAELIA_NEON4096_CACHE_LINES_PER_PAGE == 64u, "64 cache lines per page");
    must(RAFAELIA_NEON4096_VECTORS_PER_PAGE == 256u, "256 SIMD vectors per page");
    must(RAFAELIA_NEON4096_MICROBLOCKS_PER_PAGE == 8u, "8 microblocks per page");

    RafaeliaNeon4096RuntimeV1 probe;
    must(rafaelia_neon4096_runtime_probe(&probe) == 0, "NEON4096 runtime probe");
    must(probe.page_contract_verified == 1u, "NEON4096 selftest verified");
    must((probe.flags & RAFAELIA_NEON4096_FLAG_SELFTEST_PASS) != 0u,
         "NEON4096 selftest flag");
    must(probe.observed_page_size > 0u, "runtime page size observed");
    must(probe.gpu_backend_observed == 0u, "GPU remains unclaimed without backend");

    RafaeliaNeon4096PageV1 page;
    memset(&page, 0, sizeof(page));
    for (uint32_t i = 0u; i < RAFAELIA_NEON4096_PAYLOAD_BYTES; ++i)
        page.hot_l1[i] = (uint8_t)((i * 29u + 7u) & 0xffu);
    must(rafaelia_neon4096_seal(
             &page, 42u, RAFAELIA_NEON4096_PAYLOAD_BYTES,
             probe.default_route) == 0,
         "seal deterministic page");
    must(rafaelia_neon4096_verify(&page) == 0, "verify deterministic page");
    page.buffer_l2[31] ^= 0x80u;
    must(rafaelia_neon4096_verify(&page) == RAFAELIA_NEON4096_STATUS_ERR_CRC,
         "corruption rejected");

    char path[] = "/tmp/rafaelia-runtime-selftest-XXXXXX";
    int tmp = mkstemp(path);
    must(tmp >= 0, "mkstemp");
    must(close(tmp) == 0, "close seed file");
    must(unlink(path) == 0, "remove seed file");

    must(rafaelia_learning_runtime_init(path) == 0, "runtime init");
    must(rafaelia_learning_runtime_set_mode(RAFAELIA_RUNTIME_LEARN_SHADOW) == 0,
         "enter learn shadow");

    const uint64_t context = UINT64_C(0x0f1e2d3c4b5a6978);
    for (uint32_t i = 0u; i < 128u; ++i) {
        must(rafaelia_learning_runtime_observe(
                 context, 3u, 9u, 900u + i, 0,
                 UINT64_C(0x1122334400000000) | i) == 0,
             "train stable context");
    }

    uint32_t predicted = 0u;
    uint32_t support_before = 0u;
    uint16_t confidence = 0u;
    must(rafaelia_learning_predict(
             context, &predicted, &confidence, &support_before) == 0,
         "predict trained context");
    must(predicted == 3u, "trained candidate");
    must(support_before == 128u, "training support before validation");

    must(rafaelia_learning_runtime_set_mode(RAFAELIA_RUNTIME_VALIDATE_SHADOW) == 0,
         "enter validate shadow");
    for (uint32_t i = 0u; i < 64u; ++i) {
        must(rafaelia_learning_runtime_observe(
                 context, 3u, 9u, 1000u + i, 0,
                 UINT64_C(0x5566778800000000) | i) == 0,
             "validate unseen sample");
    }

    RafaeliaLearningRuntimeSnapshotV1 snapshot;
    must(rafaelia_learning_runtime_snapshot(&snapshot) == 0, "runtime snapshot");
    must(snapshot.logical_mode == RAFAELIA_RUNTIME_VALIDATE_SHADOW,
         "logical validate mode visible");
    must(snapshot.validation_observations == 64u, "64 validation observations");
    must(snapshot.validation_predictions == 64u, "64 validation predictions");
    must(snapshot.validation_correct == 64u, "64 correct validation predictions");
    must(snapshot.validation_incorrect == 0u, "zero validation errors");
    must(snapshot.validation_error_ppm == 0u, "validation error 0 ppm");
    must(snapshot.validation_confidence_q16 == 65535u, "validation confidence full");
    must(snapshot.validation_candidate_contexts == 0u,
         "support gate not bypassed by tiny validation window");
    must((snapshot.flags & RAFAELIA_RUNTIME_FLAG_ACTIVE_POLICY_DISABLED) != 0u,
         "automatic active policy disabled");
    must((snapshot.flags & RAFAELIA_RUNTIME_FLAG_VALIDATION_FROZEN_MODEL) != 0u,
         "validation model frozen");
    must((snapshot.flags & RAFAELIA_RUNTIME_FLAG_VALIDATION_PERSISTENCE_TOKEN_VAZIO) != 0u,
         "validation persistence gap explicit");

    uint32_t support_after = 0u;
    predicted = 0u;
    confidence = 0u;
    must(rafaelia_learning_predict(
             context, &predicted, &confidence, &support_after) == 0,
         "predict after validation");
    must(support_after == support_before,
         "validation does not train or alter predictor support");

    must(rafaelia_learning_runtime_set_mode(RAFAELIA_RUNTIME_FROZEN) == 0,
         "freeze runtime");
    must(rafaelia_learning_runtime_close() == 0, "runtime close");
    must(unlink(path) == 0, "cleanup store");

    printf("NEON4096_RUNTIME_SELFTEST_OK page=4096 thirds=1344x3 validation=FROZEN support_unchanged=PASS gpu=TOKEN_VAZIO promotion=DISABLED\n");
    return 0;
}

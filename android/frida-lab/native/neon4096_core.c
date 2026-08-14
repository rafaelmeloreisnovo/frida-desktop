#define _POSIX_C_SOURCE 200809L
#include "neon4096_core.h"

#include <string.h>
#include <unistd.h>

#if defined(__ARM_NEON) || defined(__ARM_NEON__) || defined(__aarch64__)
#include <arm_neon.h>
#define RAFAELIA_NEON4096_HAS_NEON 1
#else
#define RAFAELIA_NEON4096_HAS_NEON 0
#endif

static uint32_t n4k_crc32c_update(uint32_t crc, const void *data, size_t size) {
    const uint8_t *p = (const uint8_t *)data;
    for (size_t i = 0u; i < size; ++i) {
        crc ^= p[i];
        for (uint32_t bit = 0u; bit < 8u; ++bit) {
            uint32_t mask = (uint32_t)-(int32_t)(crc & 1u);
            crc = (crc >> 1) ^ (UINT32_C(0x82f63b78) & mask);
        }
    }
    return crc;
}

uint32_t rafaelia_neon4096_crc32c(const void *data, size_t size) {
    if (!data && size != 0u) return 0u;
    return ~n4k_crc32c_update(UINT32_C(0xffffffff), data, size);
}

static void n4k_fold128_scalar(const uint8_t *data, size_t size, uint8_t out[16]) {
    memset(out, 0, 16u);
    for (size_t i = 0u; i < size; ++i) out[i & 15u] ^= data[i];
}

void rafaelia_neon4096_fold128(const void *data, size_t size, uint8_t out[16]) {
    const uint8_t *p = (const uint8_t *)data;
    if (!out) return;
    if (!p && size != 0u) {
        memset(out, 0, 16u);
        return;
    }

#if RAFAELIA_NEON4096_HAS_NEON
    uint8x16_t acc = vdupq_n_u8(0u);
    size_t i = 0u;
    for (; i + 16u <= size; i += 16u) {
        acc = veorq_u8(acc, vld1q_u8(p + i));
    }
    vst1q_u8(out, acc);
    for (; i < size; ++i) out[i & 15u] ^= p[i];
#else
    n4k_fold128_scalar(p, size, out);
#endif
}

uint32_t rafaelia_neon4096_backend(void) {
#if RAFAELIA_NEON4096_HAS_NEON
    return RAFAELIA_NEON4096_BACKEND_NEON128;
#else
    return RAFAELIA_NEON4096_BACKEND_SCALAR;
#endif
}

const char *rafaelia_neon4096_backend_name(uint32_t backend) {
    switch (backend) {
        case RAFAELIA_NEON4096_BACKEND_NEON128: return "NEON128";
        case RAFAELIA_NEON4096_BACKEND_SCALAR: return "SCALAR";
        default: return "UNKNOWN";
    }
}

const char *rafaelia_neon4096_route_name(uint32_t route) {
    switch (route) {
        case RAFAELIA_NEON4096_ROUTE_CPU_SCALAR: return "CPU_SCALAR";
        case RAFAELIA_NEON4096_ROUTE_CPU_NEON: return "CPU_NEON";
        case RAFAELIA_NEON4096_ROUTE_GPU_SHADOW: return "GPU_SHADOW";
        case RAFAELIA_NEON4096_ROUTE_STORAGE: return "STORAGE";
        default: return "UNKNOWN";
    }
}

static uint32_t n4k_page_crc32c(const RafaeliaNeon4096PageV1 *page) {
    RafaeliaNeon4096ControlV1 control;
    memcpy(&control, &page->control, sizeof(control));
    control.crc32c_page = 0u;

    uint32_t crc = UINT32_C(0xffffffff);
    crc = n4k_crc32c_update(crc, &control, sizeof(control));
    crc = n4k_crc32c_update(crc, page->hot_l1, sizeof(page->hot_l1));
    crc = n4k_crc32c_update(crc, page->buffer_l2, sizeof(page->buffer_l2));
    crc = n4k_crc32c_update(crc, page->storage, sizeof(page->storage));
    return ~crc;
}

int rafaelia_neon4096_seal(RafaeliaNeon4096PageV1 *page,
                           uint64_t sequence,
                           uint32_t payload_bytes,
                           uint32_t owner_route) {
    if (!page || payload_bytes > RAFAELIA_NEON4096_PAYLOAD_BYTES ||
        owner_route > RAFAELIA_NEON4096_ROUTE_STORAGE)
        return RAFAELIA_NEON4096_STATUS_ERR_ARG;

    page->control.magic = RAFAELIA_NEON4096_MAGIC;
    page->control.version = RAFAELIA_NEON4096_VERSION;
    page->control.flags = 0u;
#if RAFAELIA_NEON4096_HAS_NEON
    page->control.flags |= RAFAELIA_NEON4096_FLAG_NEON_COMPILED;
#endif
    page->control.sequence = sequence;
    page->control.payload_bytes = payload_bytes;
    page->control.owner_route = owner_route;
    page->control.crc32c_hot = rafaelia_neon4096_crc32c(
        page->hot_l1, sizeof(page->hot_l1));
    page->control.crc32c_buffer = rafaelia_neon4096_crc32c(
        page->buffer_l2, sizeof(page->buffer_l2));
    page->control.crc32c_storage = rafaelia_neon4096_crc32c(
        page->storage, sizeof(page->storage));
    rafaelia_neon4096_fold128(
        page->hot_l1, RAFAELIA_NEON4096_PAYLOAD_BYTES,
        page->control.simd_fold128);
    page->control.crc32c_page = 0u;
    page->control.crc32c_page = n4k_page_crc32c(page);
    return RAFAELIA_NEON4096_STATUS_OK;
}

int rafaelia_neon4096_verify(const RafaeliaNeon4096PageV1 *page) {
    if (!page) return RAFAELIA_NEON4096_STATUS_ERR_ARG;
    if (page->control.magic != RAFAELIA_NEON4096_MAGIC ||
        page->control.version != RAFAELIA_NEON4096_VERSION ||
        page->control.payload_bytes > RAFAELIA_NEON4096_PAYLOAD_BYTES ||
        page->control.owner_route > RAFAELIA_NEON4096_ROUTE_STORAGE)
        return RAFAELIA_NEON4096_STATUS_ERR_CONTRACT;

    if (page->control.crc32c_hot != rafaelia_neon4096_crc32c(
            page->hot_l1, sizeof(page->hot_l1)) ||
        page->control.crc32c_buffer != rafaelia_neon4096_crc32c(
            page->buffer_l2, sizeof(page->buffer_l2)) ||
        page->control.crc32c_storage != rafaelia_neon4096_crc32c(
            page->storage, sizeof(page->storage)) ||
        page->control.crc32c_page != n4k_page_crc32c(page))
        return RAFAELIA_NEON4096_STATUS_ERR_CRC;

    uint8_t fold[16];
    rafaelia_neon4096_fold128(
        page->hot_l1, RAFAELIA_NEON4096_PAYLOAD_BYTES, fold);
    if (memcmp(fold, page->control.simd_fold128, sizeof(fold)) != 0)
        return RAFAELIA_NEON4096_STATUS_ERR_CRC;

    return RAFAELIA_NEON4096_STATUS_OK;
}

int rafaelia_neon4096_runtime_probe(RafaeliaNeon4096RuntimeV1 *snapshot_out) {
    if (!snapshot_out) return RAFAELIA_NEON4096_STATUS_ERR_ARG;
    memset(snapshot_out, 0, sizeof(*snapshot_out));
    snapshot_out->abi_version = 1u;
    snapshot_out->cache_line_bytes = RAFAELIA_NEON4096_CACHE_LINE_BYTES;
    snapshot_out->simd_vector_bytes = RAFAELIA_NEON4096_VECTOR_BYTES;
    snapshot_out->backend = rafaelia_neon4096_backend();
    snapshot_out->default_route = snapshot_out->backend == RAFAELIA_NEON4096_BACKEND_NEON128
        ? RAFAELIA_NEON4096_ROUTE_CPU_NEON
        : RAFAELIA_NEON4096_ROUTE_CPU_SCALAR;

    long observed_page = sysconf(_SC_PAGESIZE);
    if (observed_page > 0 && (unsigned long)observed_page <= UINT32_MAX)
        snapshot_out->observed_page_size = (uint32_t)observed_page;
    if (snapshot_out->observed_page_size == RAFAELIA_NEON4096_PAGE_BYTES)
        snapshot_out->flags |= RAFAELIA_NEON4096_FLAG_PAGE_SIZE_MATCH;
#if RAFAELIA_NEON4096_HAS_NEON
    snapshot_out->flags |= RAFAELIA_NEON4096_FLAG_NEON_COMPILED;
#endif

    RafaeliaNeon4096PageV1 page;
    memset(&page, 0, sizeof(page));
    uint8_t *payload = page.hot_l1;
    for (uint32_t i = 0u; i < RAFAELIA_NEON4096_PAYLOAD_BYTES; ++i)
        payload[i] = (uint8_t)((i * 17u + 3u) & 0xffu);

    int rc = rafaelia_neon4096_seal(
        &page, UINT64_C(1), RAFAELIA_NEON4096_PAYLOAD_BYTES,
        snapshot_out->default_route);
    if (rc != RAFAELIA_NEON4096_STATUS_OK) return rc;
    rc = rafaelia_neon4096_verify(&page);
    if (rc != RAFAELIA_NEON4096_STATUS_OK) return rc;

    uint8_t original = page.hot_l1[17];
    page.hot_l1[17] ^= 1u;
    if (rafaelia_neon4096_verify(&page) != RAFAELIA_NEON4096_STATUS_ERR_CRC)
        return RAFAELIA_NEON4096_STATUS_ERR_CONTRACT;
    page.hot_l1[17] = original;
    rc = rafaelia_neon4096_seal(
        &page, UINT64_C(1), RAFAELIA_NEON4096_PAYLOAD_BYTES,
        snapshot_out->default_route);
    if (rc != RAFAELIA_NEON4096_STATUS_OK ||
        rafaelia_neon4096_verify(&page) != RAFAELIA_NEON4096_STATUS_OK)
        return RAFAELIA_NEON4096_STATUS_ERR_CONTRACT;

    snapshot_out->page_contract_verified = 1u;
    snapshot_out->flags |= RAFAELIA_NEON4096_FLAG_SELFTEST_PASS;
    snapshot_out->selftest_crc32c = page.control.crc32c_page;
    memcpy(snapshot_out->selftest_fold128,
           page.control.simd_fold128,
           sizeof(snapshot_out->selftest_fold128));

    /* No Android GPU compute backend is claimed or enabled in V1. */
    snapshot_out->gpu_backend_observed = 0u;
    return RAFAELIA_NEON4096_STATUS_OK;
}

#ifndef RAFAELIA_FRIDA_NEON4096_CORE_H
#define RAFAELIA_FRIDA_NEON4096_CORE_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define RAFAELIA_NEON4096_MAGIC UINT64_C(0x314B344E41464152) /* "RAFAN4K1" LE */
#define RAFAELIA_NEON4096_VERSION 1u
#define RAFAELIA_NEON4096_PAGE_BYTES 4096u
#define RAFAELIA_NEON4096_CONTROL_BYTES 64u
#define RAFAELIA_NEON4096_REGION_BYTES 1344u
#define RAFAELIA_NEON4096_PAYLOAD_BYTES (RAFAELIA_NEON4096_REGION_BYTES * 3u)
#define RAFAELIA_NEON4096_CACHE_LINE_BYTES 64u
#define RAFAELIA_NEON4096_VECTOR_BYTES 16u
#define RAFAELIA_NEON4096_MICROBLOCK_BYTES 512u
#define RAFAELIA_NEON4096_CACHE_LINES_PER_PAGE \
    (RAFAELIA_NEON4096_PAGE_BYTES / RAFAELIA_NEON4096_CACHE_LINE_BYTES)
#define RAFAELIA_NEON4096_VECTORS_PER_PAGE \
    (RAFAELIA_NEON4096_PAGE_BYTES / RAFAELIA_NEON4096_VECTOR_BYTES)
#define RAFAELIA_NEON4096_CACHE_LINES_PER_REGION \
    (RAFAELIA_NEON4096_REGION_BYTES / RAFAELIA_NEON4096_CACHE_LINE_BYTES)
#define RAFAELIA_NEON4096_VECTORS_PER_REGION \
    (RAFAELIA_NEON4096_REGION_BYTES / RAFAELIA_NEON4096_VECTOR_BYTES)
#define RAFAELIA_NEON4096_MICROBLOCKS_PER_PAGE \
    (RAFAELIA_NEON4096_PAGE_BYTES / RAFAELIA_NEON4096_MICROBLOCK_BYTES)

#define RAFAELIA_NEON4096_FLAG_PAGE_SIZE_MATCH (1u << 0)
#define RAFAELIA_NEON4096_FLAG_NEON_COMPILED (1u << 1)
#define RAFAELIA_NEON4096_FLAG_SELFTEST_PASS (1u << 2)
#define RAFAELIA_NEON4096_FLAG_GPU_BACKEND_OBSERVED (1u << 3)

#define RAFAELIA_NEON4096_STATUS_OK 0
#define RAFAELIA_NEON4096_STATUS_ERR_ARG -1
#define RAFAELIA_NEON4096_STATUS_ERR_CONTRACT -2
#define RAFAELIA_NEON4096_STATUS_ERR_CRC -3

typedef enum RafaeliaNeon4096Backend {
    RAFAELIA_NEON4096_BACKEND_SCALAR = 0,
    RAFAELIA_NEON4096_BACKEND_NEON128 = 1
} RafaeliaNeon4096Backend;

typedef enum RafaeliaNeon4096Route {
    RAFAELIA_NEON4096_ROUTE_CPU_SCALAR = 0,
    RAFAELIA_NEON4096_ROUTE_CPU_NEON = 1,
    RAFAELIA_NEON4096_ROUTE_GPU_SHADOW = 2,
    RAFAELIA_NEON4096_ROUTE_STORAGE = 3
} RafaeliaNeon4096Route;

typedef struct RafaeliaNeon4096ControlV1 {
    uint64_t magic;
    uint32_t version;
    uint32_t flags;
    uint64_t sequence;
    uint32_t payload_bytes;
    uint32_t owner_route;
    uint32_t crc32c_hot;
    uint32_t crc32c_buffer;
    uint32_t crc32c_storage;
    uint32_t crc32c_page;
    uint8_t simd_fold128[16];
} RafaeliaNeon4096ControlV1;

#if defined(__GNUC__) || defined(__clang__)
#define RAFAELIA_ALIGN64 __attribute__((aligned(64)))
#else
#define RAFAELIA_ALIGN64
#endif

typedef struct RAFAELIA_ALIGN64 RafaeliaNeon4096PageV1 {
    RafaeliaNeon4096ControlV1 control;
    uint8_t hot_l1[RAFAELIA_NEON4096_REGION_BYTES];
    uint8_t buffer_l2[RAFAELIA_NEON4096_REGION_BYTES];
    uint8_t storage[RAFAELIA_NEON4096_REGION_BYTES];
} RafaeliaNeon4096PageV1;

typedef struct RafaeliaNeon4096RuntimeV1 {
    uint32_t abi_version;
    uint32_t observed_page_size;
    uint32_t cache_line_bytes;
    uint32_t simd_vector_bytes;
    uint32_t backend;
    uint32_t default_route;
    uint32_t page_contract_verified;
    uint32_t gpu_backend_observed;
    uint32_t flags;
    uint32_t selftest_crc32c;
    uint8_t selftest_fold128[16];
} RafaeliaNeon4096RuntimeV1;

#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 201112L
_Static_assert(sizeof(RafaeliaNeon4096ControlV1) == RAFAELIA_NEON4096_CONTROL_BYTES,
               "NEON4096 control ABI must be exactly 64 bytes");
_Static_assert(sizeof(RafaeliaNeon4096PageV1) == RAFAELIA_NEON4096_PAGE_BYTES,
               "NEON4096 page ABI must be exactly 4096 bytes");
_Static_assert(RAFAELIA_NEON4096_PAYLOAD_BYTES == 4032u,
               "NEON4096 payload must be 4032 bytes");
_Static_assert(RAFAELIA_NEON4096_CACHE_LINES_PER_PAGE == 64u,
               "NEON4096 page must be 64 cache lines");
_Static_assert(RAFAELIA_NEON4096_VECTORS_PER_PAGE == 256u,
               "NEON4096 page must be 256 128-bit vectors");
_Static_assert(RAFAELIA_NEON4096_CACHE_LINES_PER_REGION == 21u,
               "Each one-third region must be 21 cache lines");
_Static_assert(RAFAELIA_NEON4096_VECTORS_PER_REGION == 84u,
               "Each one-third region must be 84 128-bit vectors");
_Static_assert(RAFAELIA_NEON4096_MICROBLOCKS_PER_PAGE == 8u,
               "NEON4096 page must be 8 x 512-byte microblocks");
#endif

uint32_t rafaelia_neon4096_backend(void);
const char *rafaelia_neon4096_backend_name(uint32_t backend);
const char *rafaelia_neon4096_route_name(uint32_t route);

uint32_t rafaelia_neon4096_crc32c(const void *data, size_t size);
void rafaelia_neon4096_fold128(const void *data, size_t size, uint8_t out[16]);

int rafaelia_neon4096_seal(RafaeliaNeon4096PageV1 *page,
                           uint64_t sequence,
                           uint32_t payload_bytes,
                           uint32_t owner_route);
int rafaelia_neon4096_verify(const RafaeliaNeon4096PageV1 *page);
int rafaelia_neon4096_runtime_probe(RafaeliaNeon4096RuntimeV1 *snapshot_out);

#ifdef __cplusplus
}
#endif

#endif /* RAFAELIA_FRIDA_NEON4096_CORE_H */

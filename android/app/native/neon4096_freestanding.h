#ifndef RAFAELIA_NEON4096_FREESTANDING_H
#define RAFAELIA_NEON4096_FREESTANDING_H

#define RAFAELIA_NEON4096_FS_PAGE_BYTES 4096u
#define RAFAELIA_NEON4096_FS_VECTOR_BITS 128u
#define RAFAELIA_NEON4096_FS_U8_LANES 16u
#define RAFAELIA_NEON4096_FS_VECTORS_PER_PAGE 256u
#define RAFAELIA_NEON4096_FS_STREAMS 3u

#ifdef __cplusplus
extern "C" {
#endif

void rafaelia_neon4096_stage4096_armv7(void *dst4096, const void *src4096);
void rafaelia_neon4096_xor3_4096_armv7(void *dst4096,
                                      const void *src0_4096,
                                      const void *src1_4096,
                                      const void *src2_4096);

#ifdef __cplusplus
}
#endif

#endif /* RAFAELIA_NEON4096_FREESTANDING_H */

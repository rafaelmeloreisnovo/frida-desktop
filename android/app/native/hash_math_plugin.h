#ifndef RAFAELIA_HASH_MATH_PLUGIN_H
#define RAFAELIA_HASH_MATH_PLUGIN_H

#define RAFAELIA_HASH_MATH_PLUGIN_DISABLED 0u
#define RAFAELIA_HASH_MATH_PLUGIN_ENABLED  1u

#define RAFAELIA_HASH_HOST_NONE   0u
#define RAFAELIA_HASH_HOST_MD5    1u
#define RAFAELIA_HASH_HOST_SHA2   2u
#define RAFAELIA_HASH_HOST_BLAKE3 3u

#define RAFAELIA_HASH_PLUGIN_PAGE_BYTES 4096u
#define RAFAELIA_HASH_PLUGIN_U32_WORDS  1024u
#define RAFAELIA_HASH_PLUGIN_STREAMS    3u
#define RAFAELIA_HASH_PLUGIN_ARM32_LANES_U8_PER_NEON 16u
#define RAFAELIA_HASH_PLUGIN_ARM64_LANES_U8_PER_NEON 16u
#define RAFAELIA_HASH_PLUGIN_ARM64_SOFTWARE_STAGE_U8 32u

#ifdef __cplusplus
extern "C" {
#endif

#if !defined(RAFAELIA_HASH_MATH_PLUGIN_STATE)
#define RAFAELIA_HASH_MATH_PLUGIN_STATE RAFAELIA_HASH_MATH_PLUGIN_ENABLED
#endif

#if RAFAELIA_HASH_MATH_PLUGIN_STATE == RAFAELIA_HASH_MATH_PLUGIN_ENABLED
void rafaelia_hash_math_plugin_4096(void *, const void *, const void *, const void *);
void rafaelia_hash_math_plugin_4096_armv7(void *, const void *, const void *, const void *);
void rafaelia_hash_math_plugin_4096_aarch64(void *, const void *, const void *, const void *);
#endif

#ifdef __cplusplus
}
#endif

#endif /* RAFAELIA_HASH_MATH_PLUGIN_H */

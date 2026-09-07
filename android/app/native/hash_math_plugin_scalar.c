#include "hash_math_plugin.h"

#if RAFAELIA_HASH_MATH_PLUGIN_STATE == RAFAELIA_HASH_MATH_PLUGIN_ENABLED

#if defined(__GNUC__) || defined(__clang__)
#define RAFAELIA_HIDDEN __attribute__((visibility("hidden")))
#else
#define RAFAELIA_HIDDEN
#endif

RAFAELIA_HIDDEN void
rafaelia_hash_math_plugin_4096(void *d0, const void *s0, const void *s1, const void *s2)
{
  unsigned int *d = (unsigned int *) d0;
  const unsigned int *a = (const unsigned int *) s0;
  const unsigned int *b = (const unsigned int *) s1;
  const unsigned int *c = (const unsigned int *) s2;
  unsigned int i = 0u;

  while (i != RAFAELIA_HASH_PLUGIN_U32_WORDS) {
    d[i + 0u] = a[i + 0u] ^ b[i + 0u] ^ c[i + 0u];
    d[i + 1u] = a[i + 1u] ^ b[i + 1u] ^ c[i + 1u];
    d[i + 2u] = a[i + 2u] ^ b[i + 2u] ^ c[i + 2u];
    d[i + 3u] = a[i + 3u] ^ b[i + 3u] ^ c[i + 3u];
    d[i + 4u] = a[i + 4u] ^ b[i + 4u] ^ c[i + 4u];
    d[i + 5u] = a[i + 5u] ^ b[i + 5u] ^ c[i + 5u];
    d[i + 6u] = a[i + 6u] ^ b[i + 6u] ^ c[i + 6u];
    d[i + 7u] = a[i + 7u] ^ b[i + 7u] ^ c[i + 7u];
    i += 8u;
  }
}

#endif

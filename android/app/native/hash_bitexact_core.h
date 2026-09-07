#ifndef RAFAELIA_HASH_BITEXACT_CORE_H
#define RAFAELIA_HASH_BITEXACT_CORE_H

/* Strict freestanding bit-exact algebra layer.
 * No allocator, libc, syscall, global state, runtime dispatch or external call.
 * Unsigned wraparound is the required modulo-2^w arithmetic.
 */

typedef unsigned char rafaelia_u8;
typedef unsigned int rafaelia_u32;
typedef unsigned long long rafaelia_u64;

#if defined(__STDC_VERSION__) && __STDC_VERSION__ >= 201112L
_Static_assert(sizeof(rafaelia_u8) == 1, "rafaelia_u8 must be one byte");
_Static_assert(sizeof(rafaelia_u32) == 4, "rafaelia_u32 must be 32 bits");
_Static_assert(sizeof(rafaelia_u64) == 8, "rafaelia_u64 must be 64 bits");
#endif

#if defined(__GNUC__) || defined(__clang__)
#define RAFAELIA_FORCE_INLINE static __inline__ __attribute__((always_inline))
#else
#define RAFAELIA_FORCE_INLINE static inline
#endif

RAFAELIA_FORCE_INLINE rafaelia_u32 rafaelia_add32(rafaelia_u32 a, rafaelia_u32 b) { return a + b; }
RAFAELIA_FORCE_INLINE rafaelia_u64 rafaelia_add64(rafaelia_u64 a, rafaelia_u64 b) { return a + b; }
RAFAELIA_FORCE_INLINE rafaelia_u32 rafaelia_xor32(rafaelia_u32 a, rafaelia_u32 b) { return a ^ b; }
RAFAELIA_FORCE_INLINE rafaelia_u64 rafaelia_xor64(rafaelia_u64 a, rafaelia_u64 b) { return a ^ b; }
RAFAELIA_FORCE_INLINE rafaelia_u32 rafaelia_or32(rafaelia_u32 a, rafaelia_u32 b) { return a | b; }
RAFAELIA_FORCE_INLINE rafaelia_u64 rafaelia_or64(rafaelia_u64 a, rafaelia_u64 b) { return a | b; }
RAFAELIA_FORCE_INLINE rafaelia_u32 rafaelia_and32(rafaelia_u32 a, rafaelia_u32 b) { return a & b; }
RAFAELIA_FORCE_INLINE rafaelia_u64 rafaelia_and64(rafaelia_u64 a, rafaelia_u64 b) { return a & b; }
RAFAELIA_FORCE_INLINE rafaelia_u32 rafaelia_shr32(rafaelia_u32 a, unsigned int n) { return a >> (n & 31u); }
RAFAELIA_FORCE_INLINE rafaelia_u64 rafaelia_shr64(rafaelia_u64 a, unsigned int n) { return a >> (n & 63u); }
RAFAELIA_FORCE_INLINE rafaelia_u32 rafaelia_not32(rafaelia_u32 a) { return ~a; }
RAFAELIA_FORCE_INLINE rafaelia_u64 rafaelia_not64(rafaelia_u64 a) { return ~a; }

RAFAELIA_FORCE_INLINE rafaelia_u32 rafaelia_rotl32(rafaelia_u32 x, unsigned int n)
{
  n &= 31u;
  return (x << n) | (x >> ((0u - n) & 31u));
}

RAFAELIA_FORCE_INLINE rafaelia_u32 rafaelia_rotr32(rafaelia_u32 x, unsigned int n)
{
  n &= 31u;
  return (x >> n) | (x << ((0u - n) & 31u));
}

RAFAELIA_FORCE_INLINE rafaelia_u64 rafaelia_rotl64(rafaelia_u64 x, unsigned int n)
{
  n &= 63u;
  return (x << n) | (x >> ((0u - n) & 63u));
}

RAFAELIA_FORCE_INLINE rafaelia_u64 rafaelia_rotr64(rafaelia_u64 x, unsigned int n)
{
  n &= 63u;
  return (x >> n) | (x << ((0u - n) & 63u));
}

RAFAELIA_FORCE_INLINE rafaelia_u32 rafaelia_load32_le(const void *p0)
{
  const rafaelia_u8 *p = (const rafaelia_u8 *)p0;
  return ((rafaelia_u32)p[0]) |
         ((rafaelia_u32)p[1] << 8) |
         ((rafaelia_u32)p[2] << 16) |
         ((rafaelia_u32)p[3] << 24);
}

RAFAELIA_FORCE_INLINE rafaelia_u32 rafaelia_load32_be(const void *p0)
{
  const rafaelia_u8 *p = (const rafaelia_u8 *)p0;
  return ((rafaelia_u32)p[0] << 24) |
         ((rafaelia_u32)p[1] << 16) |
         ((rafaelia_u32)p[2] << 8) |
         ((rafaelia_u32)p[3]);
}

RAFAELIA_FORCE_INLINE void rafaelia_store32_le(void *p0, rafaelia_u32 x)
{
  rafaelia_u8 *p = (rafaelia_u8 *)p0;
  p[0] = (rafaelia_u8)x;
  p[1] = (rafaelia_u8)(x >> 8);
  p[2] = (rafaelia_u8)(x >> 16);
  p[3] = (rafaelia_u8)(x >> 24);
}

RAFAELIA_FORCE_INLINE void rafaelia_store32_be(void *p0, rafaelia_u32 x)
{
  rafaelia_u8 *p = (rafaelia_u8 *)p0;
  p[0] = (rafaelia_u8)(x >> 24);
  p[1] = (rafaelia_u8)(x >> 16);
  p[2] = (rafaelia_u8)(x >> 8);
  p[3] = (rafaelia_u8)x;
}

#define RAFAELIA_ADD32_3(a,b,c) rafaelia_add32(rafaelia_add32((a),(b)),(c))
#define RAFAELIA_ADD32_4(a,b,c,d) rafaelia_add32(RAFAELIA_ADD32_3((a),(b),(c)),(d))
#define RAFAELIA_ADD32_5(a,b,c,d,e) rafaelia_add32(RAFAELIA_ADD32_4((a),(b),(c),(d)),(e))

#endif /* RAFAELIA_HASH_BITEXACT_CORE_H */

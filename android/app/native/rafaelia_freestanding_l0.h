#ifndef RAFAELIA_FRIDA_FREESTANDING_L0_H
#define RAFAELIA_FRIDA_FREESTANDING_L0_H

typedef unsigned char RafaeliaL0U8;
typedef unsigned short RafaeliaL0U16;
typedef unsigned int RafaeliaL0U32;
typedef unsigned long long RafaeliaL0U64;
typedef __SIZE_TYPE__ RafaeliaL0Size;

_Static_assert(sizeof(RafaeliaL0U8) == 1, "RafaeliaL0U8 must be 8-bit");
_Static_assert(sizeof(RafaeliaL0U16) == 2, "RafaeliaL0U16 must be 16-bit");
_Static_assert(sizeof(RafaeliaL0U32) == 4, "RafaeliaL0U32 must be 32-bit");
_Static_assert(sizeof(RafaeliaL0U64) == 8, "RafaeliaL0U64 must be 64-bit");

#define RAFAELIA_L0_U32_MAX ((RafaeliaL0U32)~(RafaeliaL0U32)0u)
#define RAFAELIA_L0_U64_MAX ((RafaeliaL0U64)~(RafaeliaL0U64)0ull)

typedef struct RafaeliaL0SpinLock {
    volatile RafaeliaL0U8 value;
} RafaeliaL0SpinLock;

#define RAFAELIA_L0_SPINLOCK_INIT { 0u }

void rafaelia_l0_zero(void *dst, RafaeliaL0Size size);
RafaeliaL0U32 rafaelia_l0_saturating_inc_u32(RafaeliaL0U32 value);
RafaeliaL0U32 rafaelia_l0_ratio_ppm(RafaeliaL0U64 numerator, RafaeliaL0U64 denominator);
RafaeliaL0U16 rafaelia_l0_ratio_q16(RafaeliaL0U64 numerator, RafaeliaL0U64 denominator);
RafaeliaL0U32 rafaelia_l0_crc32c(const void *src, RafaeliaL0Size size);
void rafaelia_l0_lock(RafaeliaL0SpinLock *lock);
void rafaelia_l0_unlock(RafaeliaL0SpinLock *lock);
RafaeliaL0U32 rafaelia_l0_entry(void);

#endif

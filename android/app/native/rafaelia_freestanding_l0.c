#include "rafaelia_freestanding_l0.h"

void rafaelia_l0_zero(void *dst, RafaeliaL0Size size) {
    RafaeliaL0U8 *out = (RafaeliaL0U8 *)dst;
    RafaeliaL0Size i = 0u;
    while (i < size) {
        out[i] = 0u;
        i += 1u;
    }
}

RafaeliaL0U32 rafaelia_l0_saturating_inc_u32(RafaeliaL0U32 value) {
    return value == RAFAELIA_L0_U32_MAX ? value : value + 1u;
}

RafaeliaL0U32 rafaelia_l0_ratio_ppm(RafaeliaL0U64 numerator, RafaeliaL0U64 denominator) {
    if (denominator == 0u) return 0u;
    if (numerator >= denominator) return 1000000u;
    return (RafaeliaL0U32)((numerator * 1000000ull) / denominator);
}

RafaeliaL0U16 rafaelia_l0_ratio_q16(RafaeliaL0U64 numerator, RafaeliaL0U64 denominator) {
    if (denominator == 0u) return 0u;
    if (numerator >= denominator) return 65535u;
    return (RafaeliaL0U16)((numerator * 65535ull) / denominator);
}

RafaeliaL0U32 rafaelia_l0_crc32c(const void *src, RafaeliaL0Size size) {
    const RafaeliaL0U8 *in = (const RafaeliaL0U8 *)src;
    RafaeliaL0U32 crc = 0xffffffffu;
    RafaeliaL0Size i = 0u;
    while (i < size) {
        RafaeliaL0U32 x = crc ^ (RafaeliaL0U32)in[i];
        RafaeliaL0U32 bit = 0u;
        while (bit < 8u) {
            RafaeliaL0U32 mask = (RafaeliaL0U32)0u - (x & 1u);
            x = (x >> 1u) ^ (0x82f63b78u & mask);
            bit += 1u;
        }
        crc = x;
        i += 1u;
    }
    return ~crc;
}

void rafaelia_l0_lock(RafaeliaL0SpinLock *lock) {
    while (__atomic_test_and_set(&lock->value, __ATOMIC_ACQUIRE)) {
    }
}

void rafaelia_l0_unlock(RafaeliaL0SpinLock *lock) {
    __atomic_clear(&lock->value, __ATOMIC_RELEASE);
}

RafaeliaL0U32 rafaelia_l0_entry(void) {
    static const RafaeliaL0U8 vector[9] = { '1','2','3','4','5','6','7','8','9' };
    return rafaelia_l0_crc32c(vector, 9u);
}

#include "rafaelia_freestanding_l0.h"

int main(void) {
    static const RafaeliaL0U8 vector[9] = { '1','2','3','4','5','6','7','8','9' };
    RafaeliaL0U8 buf[16];
    RafaeliaL0SpinLock lock = RAFAELIA_L0_SPINLOCK_INIT;
    RafaeliaL0U32 i = 0u;
    while (i < 16u) { buf[i] = 0xa5u; i += 1u; }
    rafaelia_l0_zero(buf, 16u);
    i = 0u;
    while (i < 16u) { if (buf[i] != 0u) return 1; i += 1u; }
    if (rafaelia_l0_crc32c(vector, 9u) != 0xe3069283u) return 2;
    if (rafaelia_l0_saturating_inc_u32(41u) != 42u) return 3;
    if (rafaelia_l0_saturating_inc_u32(RAFAELIA_L0_U32_MAX) != RAFAELIA_L0_U32_MAX) return 4;
    if (rafaelia_l0_ratio_ppm(1u, 4u) != 250000u) return 5;
    if (rafaelia_l0_ratio_ppm(1u, 3u) != 333333u) return 6;
    if (rafaelia_l0_ratio_q16(2u, 3u) != 43690u) return 7;
    if (rafaelia_l0_ratio_q16(1u, 1u) != 65535u) return 8;
    if (rafaelia_l0_ratio_ppm(RAFAELIA_L0_U64_MAX - 1u,
                              RAFAELIA_L0_U64_MAX) != 999999u) return 9;
    rafaelia_l0_lock(&lock);
    if (lock.value == 0u) return 10;
    rafaelia_l0_unlock(&lock);
    if (lock.value != 0u) return 11;
    return 0;
}

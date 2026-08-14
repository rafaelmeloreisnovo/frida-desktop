#include <stdint.h>

__attribute__((visibility("default")))
const char *rafaelia_elf_probe_identity(void) {
    return "RAFAELIA_ELF_PROBE_V1";
}

__attribute__((visibility("default")))
uint32_t rafaelia_elf_probe_abi_word(void) {
#if defined(__aarch64__)
    return 0xA6417001u;
#elif defined(__arm__)
    return 0xA3270001u;
#else
    return 0u;
#endif
}

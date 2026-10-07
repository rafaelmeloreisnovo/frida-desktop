# FRIDA Lab ARMv7 JNI L0 link hotfix — receipt 2026-10-07

State: IMPLEMENTED_UNTESTED_CI. Physical re-test: TOKEN_VAZIO.

## Input observation
RAFAELIA_FRIDA_LAB_RECEIPT_V1 schema 1.1 reported Android 10 armeabi-v7a dlopen FAIL: missing rafaelia_l0_lock in librafaelia-probe.so. Frida Gadget independently LOADED. Learning NOT_INITIALIZED; learning mutations DISABLED; ACTIVE DISABLED; claim_allowed=false.

## Source falsifier
The Android JNI probe built elf_probe.c as one translation unit. It included learning_runtime.c, which calls rafaelia_l0_lock/zero/unlock and ratio helpers, but omitted rafaelia_freestanding_l0.c, where those functions are defined.

## Proposed correction
On branch hotfix/frida-lab-l0-symbol-resolution-20261007:
- Include existing authorial rafaelia_freestanding_l0.c in the JNI probe.
- Require --no-undefined during native linking of ARMv7 and AArch64 shared probes.
- Preserve readelf ABI symbol tables and reject undefined rafaelia_l0_ symbols.

## Gates
G0 source patch readback: PASS at 27643e95f4d624845c1cc9873adae2dac75d0d22.
G1 provenance workflow #37685887467: SUCCESS, source-level only.
G2 dedicated Android APK/ELF/DEX exact-head: PENDING at first dispatch; do not promote without final readback.
G3 source ELF in APK and exact-byte physical re-test: TOKEN_VAZIO.
G4 learning policy: remain OFF, no automatic ACTIVE or persistent mutation until independently authorized.

Original physical receipt does not contain the exact APK SHA-256 and cannot establish that installed bytes matched any later CI head. Build tool dependencies do not imply runtime freestanding; upstream Frida remains third-party. Whole-repository freestanding claim remains TOKEN_VAZIO.

ROLLBACK: close draft PR #80 or revert the branch commits. Do not rewrite original FAIL evidence.

SOURCE != ARTIFACT != EXECUTION != EVIDENCE != CLAIM.

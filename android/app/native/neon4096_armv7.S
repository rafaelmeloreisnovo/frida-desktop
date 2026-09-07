.syntax unified
.arch armv7-a
.fpu neon
.arm
.text
.p2align 4

/*
 * Strict ARMv7-A/NEON hot path.
 *
 * Contract:
 * - no allocator, libc, atomics, syscalls, TLS, GOT/PLT, or external calls;
 * - fixed 4096-byte pages;
 * - branchless data path; the only conditional branch is fixed-count loop control;
 * - numeric local labels only; two hidden ABI symbols;
 * - 128-bit NEON vectors; 16 x u8 lanes per vector operation;
 * - xor3 consumes three independent source streams into one caller-provided buffer;
 * - 256 bytes per fixed loop iteration; prefetch cadence remains 128 bytes.
 *
 * This file intentionally does not claim physical throughput or bandwidth.
 * Those remain TOKEN_VAZIO until measured on the target ARM32 device.
 */

.global rafaelia_neon4096_stage4096_armv7
.hidden rafaelia_neon4096_stage4096_armv7
.type rafaelia_neon4096_stage4096_armv7, %function
rafaelia_neon4096_stage4096_armv7:
    mov     r12, #16
1:
    pld     [r1, #256]
    .rept 4
    vld1.8  {d0-d3}, [r1]!
    vst1.8  {d0-d3}, [r0]!
    .endr
    pld     [r1, #256]
    .rept 4
    vld1.8  {d0-d3}, [r1]!
    vst1.8  {d0-d3}, [r0]!
    .endr
    subs    r12, r12, #1
    bne     1b
    bx      lr
.size rafaelia_neon4096_stage4096_armv7, .-rafaelia_neon4096_stage4096_armv7

.p2align 4
.global rafaelia_neon4096_xor3_4096_armv7
.hidden rafaelia_neon4096_xor3_4096_armv7
.type rafaelia_neon4096_xor3_4096_armv7, %function
rafaelia_neon4096_xor3_4096_armv7:
    mov     r12, #16
2:
    pld     [r1, #256]
    pld     [r2, #256]
    pld     [r3, #256]
    .rept 4
    vld1.8  {d0-d3},  [r1]!
    vld1.8  {d4-d7},  [r2]!
    vld1.8  {d8-d11}, [r3]!
    veor    q0, q0, q2
    veor    q1, q1, q3
    veor    q0, q0, q4
    veor    q1, q1, q5
    vst1.8  {d0-d3}, [r0]!
    .endr
    pld     [r1, #256]
    pld     [r2, #256]
    pld     [r3, #256]
    .rept 4
    vld1.8  {d0-d3},  [r1]!
    vld1.8  {d4-d7},  [r2]!
    vld1.8  {d8-d11}, [r3]!
    veor    q0, q0, q2
    veor    q1, q1, q3
    veor    q0, q0, q4
    veor    q1, q1, q5
    vst1.8  {d0-d3}, [r0]!
    .endr
    subs    r12, r12, #1
    bne     2b
    bx      lr
.size rafaelia_neon4096_xor3_4096_armv7, .-rafaelia_neon4096_xor3_4096_armv7

.section .note.GNU-stack,"",%progbits

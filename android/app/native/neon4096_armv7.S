.syntax unified
.arch armv7-a
.fpu neon
.arm
.text
.p2align 4

#ifndef RAFAELIA_NEON4096_FULL_UNROLL
#define RAFAELIA_NEON4096_FULL_UNROLL 0
#endif

/*
 * Strict ARMv7-A/NEON hot path.
 *
 * Contract:
 * - no allocator, libc, atomics, syscalls, TLS, GOT/PLT, or external calls;
 * - fixed 4096-byte pages;
 * - same two hidden ABI symbols in baseline and full-unroll specializations;
 * - 128-bit NEON vectors; 16 x u8 lanes per vector operation;
 * - xor3 consumes three independent source streams into one caller-provided buffer;
 * - caller owns storage; this leaf owns no heap, GC, shadow buffer or runtime scheduler;
 * - prefetch remains an explicit cache hint only; no cache-miss/bandwidth claim is inferred.
 *
 * RAFAELIA_NEON4096_FULL_UNROLL=0 preserves the measured baseline geometry:
 * 16 fixed loop iterations x 256 bytes = 4096 bytes.
 *
 * RAFAELIA_NEON4096_FULL_UNROLL=1 expands those 16 iterations at assembly time.
 * The full-unroll data path has no runtime loop-control branch. It is a candidate
 * specialization only because lower branch overhead can trade against a larger
 * instruction-cache footprint. Physical promotion therefore requires device evidence.
 */

.global rafaelia_neon4096_stage4096_armv7
.hidden rafaelia_neon4096_stage4096_armv7
.type rafaelia_neon4096_stage4096_armv7, %function
rafaelia_neon4096_stage4096_armv7:
#if RAFAELIA_NEON4096_FULL_UNROLL
    .rept 16
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
    .endr
#else
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
#endif
    bx      lr
.size rafaelia_neon4096_stage4096_armv7, .-rafaelia_neon4096_stage4096_armv7

.p2align 4
.global rafaelia_neon4096_xor3_4096_armv7
.hidden rafaelia_neon4096_xor3_4096_armv7
.type rafaelia_neon4096_xor3_4096_armv7, %function
rafaelia_neon4096_xor3_4096_armv7:
#if RAFAELIA_NEON4096_FULL_UNROLL
    .rept 16
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
    .endr
#else
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
#endif
    bx      lr
.size rafaelia_neon4096_xor3_4096_armv7, .-rafaelia_neon4096_xor3_4096_armv7

.section .note.GNU-stack,"",%progbits

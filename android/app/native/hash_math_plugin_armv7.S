.syntax unified
.arch armv7-a
.fpu neon
.arm
.text
.p2align 4

/*
 * RAFAELIA-authored orchestration kernel.
 * It is NOT MD5, SHA-2, BLAKE, BLAKE2, or BLAKE3.
 * It may be invoked as an opt-in sidecar around a standards-conforming hash.
 * No calls, stack, allocator, libc, syscall, shadow path, or tail-call path.
 */
.global rafaelia_hash_math_plugin_4096_armv7
.hidden rafaelia_hash_math_plugin_4096_armv7
.type rafaelia_hash_math_plugin_4096_armv7, %function
rafaelia_hash_math_plugin_4096_armv7:
    mov     r12, #32
1:
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
    bne     1b
    bx      lr
.size rafaelia_hash_math_plugin_4096_armv7, .-rafaelia_hash_math_plugin_4096_armv7

.section .note.GNU-stack,"",%progbits

.arch armv8-a
.text
.p2align 4

/*
 * RAFAELIA-authored orchestration kernel.
 * It is NOT MD5, SHA-2, BLAKE, BLAKE2, or BLAKE3.
 * AArch64 Advanced SIMD remains 128-bit per vector register. This kernel
 * processes two independent 128-bit vectors per software stage (32 bytes).
 * No calls, stack, allocator, libc, syscall, shadow path, or tail-call path.
 */
.global rafaelia_hash_math_plugin_4096_aarch64
.hidden rafaelia_hash_math_plugin_4096_aarch64
.type rafaelia_hash_math_plugin_4096_aarch64, %function
rafaelia_hash_math_plugin_4096_aarch64:
    mov     x4, #32
1:
    prfm    pldl1keep, [x1, #256]
    prfm    pldl1keep, [x2, #256]
    prfm    pldl1keep, [x3, #256]
    .rept 4
    ld1     {v0.16b, v1.16b}, [x1], #32
    ld1     {v2.16b, v3.16b}, [x2], #32
    ld1     {v4.16b, v5.16b}, [x3], #32
    eor     v0.16b, v0.16b, v2.16b
    eor     v1.16b, v1.16b, v3.16b
    eor     v0.16b, v0.16b, v4.16b
    eor     v1.16b, v1.16b, v5.16b
    st1     {v0.16b, v1.16b}, [x0], #32
    .endr
    subs    x4, x4, #1
    b.ne    1b
    ret
.size rafaelia_hash_math_plugin_4096_aarch64, .-rafaelia_hash_math_plugin_4096_aarch64

.section .note.GNU-stack,"",%progbits

.syntax unified
.arm
.text
.align 2
.global _start
.type _start, %function
.hidden _start
_start:
    bl rafaelia_l0_entry
    movw r1, #0x9283
    movt r1, #0xe306
    cmp r0, r1
    moveq r0, #0
    movne r0, #1
    mov r7, #248
    svc #0
1:
    b 1b
.size _start, .-_start

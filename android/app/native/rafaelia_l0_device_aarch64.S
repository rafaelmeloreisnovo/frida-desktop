.text
.align 2
.global _start
.type _start, %function
.hidden _start
_start:
    bl rafaelia_l0_entry
    movz w1, #0x9283
    movk w1, #0xe306, lsl #16
    cmp w0, w1
    cset w0, ne
    mov x8, #94
    svc #0
1:
    b 1b
.size _start, .-_start

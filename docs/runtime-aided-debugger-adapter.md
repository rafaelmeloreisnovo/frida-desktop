# Runtime-Aided Debugger Adapter

Status: `STRUCTURAL_IMPLEMENTED / TARGET_RUNTIME_TOKEN_VAZIO`

This layer translates authorized target-runtime observations into the existing
metadata-only stability recorder. It deliberately separates target-specific
Frida hooks from the deterministic recorder and Debugger Class A planner.

## Pipeline

`authorized probe -> frida_raa_event -> frida_raa_translate -> frida_rs_input -> stability recorder -> DCA signal -> route policy`

## Safety and claim boundary

The adapter records metadata only. It does not install hooks by itself, store
payload bytes, decrypt traffic, bypass TLS/certificate pinning/authentication,
or cross operating-system process isolation. Runtime execution on Android and
real ARM32/NEON measurements remain `TOKEN_VAZIO` until reproduced on an
authorized target device.

## Supported normalized observations

- read / recv -> network read operation
- write / send / connect -> network write-side operation
- IPC boundary
- GC/allocation-pressure boundary
- dynamic-loader boundary
- web-runtime boundary

The target adapter is responsible for monotonic time, PID/TID, descriptor,
operation size, latency, normalized pressure, status flags, and a non-reversible
stream tag. No plaintext-derived peer tag is permitted.

## Deterministic validation

```sh
cc -std=c11 -Wall -Wextra -Werror -pedantic \
  tools/frida-runtime-aided-adapter.c \
  tools/frida-runtime-aided-adapter-selftest.c \
  -Itools -o /tmp/frida-runtime-aided-adapter-selftest
/tmp/frida-runtime-aided-adapter-selftest

cc -std=c11 -Wall -Wextra -Werror -ffreestanding -fno-builtin \
  -Itools -c tools/frida-runtime-aided-adapter.c \
  -o /tmp/frida-runtime-aided-adapter.o
```

Passing these commands proves only the standalone normalization contract. It is
not evidence of successful Frida attachment or Android runtime instrumentation.

## F_next

1. Build on clean hosted compiler.
2. Build freestanding object.
3. Add an authorized Android/Frida adapter that supplies metadata only.
4. Measure ARM32 runtime behavior and preserve a receipt.
5. Feed recorder state into Debugger Class A and verify FAILSAFE/FAILOVER/
   ROLLBACK behavior under induced, controlled instability.

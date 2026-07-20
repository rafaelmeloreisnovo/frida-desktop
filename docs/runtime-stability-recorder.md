# Frida runtime stability recorder

This is an opt-in, metadata-only extension of the repository's ARM runtime
debugger safety profile. It does not decrypt network traffic, persist payload
bytes, or claim to identify malicious behavior by itself. Its narrow purpose is
to detect a reproducible loss of runtime stability and preserve a short,
sequential forensic record for later analysis.

Machine-readable contract: `profiles/runtime-stability-recorder.json`.
Implementation:

- `tools/frida-runtime-stability-recorder.h`
- `tools/frida-runtime-stability-recorder.c`
- `tools/frida-runtime-stability-recorder-selftest.c`

## Exact scope

The recorder receives events from authorized Frida probes and computes a Q16
stability state. Supported event families are network read/write operations,
GC boundaries or pressure summaries, web-runtime boundaries, IPC operations,
and dynamic-loader events.

The core does not hook these functions automatically. A target-specific Frida
adapter is responsible for translating observed runtime operations into
`frida_rs_input` records. This keeps the stability model independent of Android
version, ART symbol names, libc implementation, WebAssembly engine, or Java
networking library.

## What is recorded

Only instability metadata may enter the circular bank:

- monotonic timestamp;
- process and thread identifiers;
- descriptor and operation kind;
- byte count and operation latency;
- a caller-generated non-reversible stream/peer tag;
- GC-pressure, alternation, burst, baseline, stability, and delta values;
- runtime boundary flags;
- chained record-integrity hash.

The structures contain no payload pointer or payload storage field. Callers
must not derive `peer_tag` from private plaintext. It should identify a flow or
endpoint through a local keyed digest produced outside the hot path.

## Stability model

The default trigger is:

```text
11796 / 65535 ~= 0.18
```

The recorder combines five bounded signals:

1. short-interval read/write alternation (the requested ping-pong signal);
2. burst pressure;
3. caller-observed GC pressure;
4. operation latency;
5. web, IPC, dynamic-loader, and I/O-error boundaries.

The result is an instability value. Stability is its Q16 inverse. A rolling
baseline uses a slow fixed-point smoother, and `delta_q16` is the absolute
distance between the current stability and that baseline.

Stable operations update the baseline but are not persisted. By default, two
consecutive threshold crossings are required before records enter the dump
bank. The run is released when delta falls below half the trigger.

## Silicon profile gate

`frida_rs_silicon_tag()` hashes a measured profile containing architecture,
pointer width, page size, cache-line size, HWCAP words, and an implementation
identifier. A configured mismatch moves initialization to FAILSAFE.

This is a deterministic profile selector, not a secret hardware identity. It
must not be presented as attestation, anti-cloning protection, or a root of
trust. A platform attestation mechanism is required for those claims.

## TCP, UDP, and the meaning of "packet"

A Frida hook on `read()`, `write()`, `send()`, `recv()`, Java streams, OkHttp,
or a WebAssembly host function sees runtime operations. For TCP, one operation
does not necessarily correspond to one IP packet because TCP is a byte stream.
The recorder therefore calls these entries operations, not packets.

UDP adapters may retain one-datagram-per-event semantics, but payload remains
forbidden. Packet-accurate IP capture requires a lower network layer and is
outside this Frida-only change.

## Cross-application analysis

One Frida agent observes one attached process. It cannot safely infer another
process's internal activity. Cross-application analysis requires one authorized
session per process and an external correlator that joins metadata by monotonic
time, stream tags, and process identity. The correlator must not receive
payload.

## GC interpretation

GC pressure is a correlation signal, not evidence that garbage collection moved
data between applications. The caller may report GC begin/end events, pause
duration, allocation pressure, or a normalized pressure score. A close temporal
relationship between network operations and GC raises the instability score,
but causal claims remain `TOKEN_VAZIO` until independently demonstrated.

## Debugger Class A integration

`frida_rs_make_dca_signal()` maps the recorder into the existing autotuner:

| Recorder | Debugger Class A |
| --- | --- |
| stability | `stability_q16` |
| inverse baseline distance | `accuracy_q16` |
| burst pressure | `friction_q16` |
| direction alternation | `entropy_q16` |
| GC pressure | `overhead_q16` |

This allows the existing generic, ARM32/NEON, cache-local, failover, and
rollback planner to react without duplicating route logic.

## Recommended adapter probes

A later target-specific adapter may translate authorized hooks for:

- native `connect`, `send`, `recv`, `read`, and `write`;
- Java socket and HTTP client operations;
- ART GC notifications where stable symbols or supported callbacks exist;
- Binder read/write boundaries;
- WebView or WebAssembly host entry/exit boundaries;
- `dlopen`, `android_dlopen_ext`, or class-loader events.

The adapter must capture sizes, latency, return status, and identifiers only.
It must not bypass TLS, certificate pinning, application authentication, or
operating-system process isolation.

## Build and self-test

The recorder is not wired into the default Frida build. Compile the repository
local deterministic test explicitly:

```sh
cc -std=c11 -Wall -Wextra -Werror -pedantic \
  tools/frida-debugger-class-a-autotune.c \
  tools/frida-runtime-stability-recorder.c \
  tools/frida-runtime-stability-recorder-selftest.c \
  -Itools -o /tmp/frida-runtime-stability-selftest
/tmp/frida-runtime-stability-selftest
```

A successful process exit is structural evidence for the standalone model only.
Android/Frida runtime execution remains `TOKEN_VAZIO` until measured on the
target device.

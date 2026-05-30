# Runtime debugger ARM safety profile

This document translates the broad low-level intent into a repository-local,
testable contract.  It does **not** claim that Frida is now bare-metal, quantum,
or allocator-free end-to-end.  Instead, it defines the guardrails a downstream
ARM32/ARM64 runtime-debugger target must satisfy before it can be promoted from
experimentation to a supported configuration.

The machine-readable source of truth is
`profiles/runtime-debugger-arm-safety.json`; this document explains how to use
it.

## Safety principles

- **Truth over optimistic usefulness:** missing evidence is `SKIPPED`, never a
  fake pass.
- **No silent mutation:** every patchable byte must have a rollback journal entry
  before the write happens.
- **Fail-safe first:** guard failures move the target to passive observation or
  read-only mode.
- **Failover is not escalation:** failover must not enable hosted language
  layers, garbage-collected runtimes, or extra privileges.
- **Freestanding-compatible hot paths:** probe, watchdog, failover, and rollback
  paths must be designed for fixed-capacity state and must not depend on
  `malloc()`.
- **Architecture evidence:** ARMv7/AAPCS-EABI and AArch64/AAPCS64 evidence must
  be recorded separately because pointer width, alignment, cache flushing, and
  atomicity assumptions differ.

## Module cycle 1: learn, setup, and probe

1. **learn** records CPU family, pointer width, page size, cache-line
   assumptions, syscall availability, and debugger features.
2. **setup** prepares fixed-size tables, seed material for deterministic tests,
   watchdog epochs, and rollback journal capacity.
3. **probe** inspects runtime state read-only.  If the probe cannot stay within
   latency/cache budgets, it must downgrade to a cold passive debugger path.

Cycle 1 may only produce `PASS`, `FAIL`, or `SKIPPED` evidence.  Unknown target
facts are `SKIPPED` until measured.

## Module cycle 2: patch, watchdog, failover, rollback, and evidence

1. **patch** writes only after `journal_before_write` succeeds and verification
   proves the intended bytes were installed.
2. **watchdog** monitors heartbeat, trap density, syscall rate, and rollback
   deadlines from a control path that is safe to re-enter.
3. **failover** disables mutation and switches to passive observation when a
   guard trips.
4. **rollback** restores original bytes and permissions, flushes the instruction
   cache, and verifies the snapshot.
5. **evidence** emits tri-state results and chains them through stable integrity
   markers (`fnv1a64`, `crc32c`, and a Merkle root).

## ARM32 and ARM64 structural differences

| Target | CPU family | Pointer width | ABI baseline | Promotion requirement |
| --- | --- | ---: | --- | --- |
| ARM32 | `arm` | 32 | AAPCS-EABI | bounded stack frames, fixed-capacity tables, journal-before-patch, explicit cache flush evidence |
| ARM64 | `aarch64` | 64 | AAPCS64 | same guards as ARM32, with separate atomicity/alignment evidence |

A result from one architecture does not certify the other architecture.

## Seed and metaphor boundary

Toroidal, fractal, geometric, linguistic, acoustic, or quantum-inspired models
may be useful for test-vector generation, visualization, and anomaly heuristics.
They are not security proof by themselves.  Security-sensitive seeds must come
from a platform CSPRNG or a documented hardware root of trust.  The profile only
allows deterministic seed use for tests, rollback journal identifiers, watchdog
epoch tags, and evidence-chain nonces.

## Validation

Run the repository-local validator:

```sh
python3 tools/validate-runtime-debugger-arm-safety.py
```

The validator checks the JSON schema shape, module coverage, ARM32/ARM64 guards,
rollback ordering, seed policy, and tri-state test semantics without requiring
Frida submodules.

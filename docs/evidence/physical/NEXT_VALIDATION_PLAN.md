# Next Physical Validation Plan — Frida Lab ARM32

Input evidence: `RAFAELIA_FRIDA_LAB_RECEIPT_V1`.

Current boundary: physical Android/ARM32 + ELF/Gadget + NEON4096 selftest are observed; model validation, persistence/recovery, comparative performance and GPU remain unproven.

## Gate 0 — Preserve the baseline

Before changing runtime behavior:

- retain the raw receipt and normalized JSON;
- preserve the exact selftest CRC32C `0xed4a015e` as a baseline value for this receipt only;
- keep `automatic_active=DISABLED`;
- keep GPU routing unpromoted;
- do not rewrite the existing RFL evidence file as part of documentary work.

Exit: baseline remains reproducible/readable and no new behavior has been enabled.

## Gate 1 — Freeze the model for shadow validation

Objective: establish the prerequisite that is missing now.

Required evidence in the next receipt:

- `model frozen: YES`;
- explicit immutable model/version/hash identity;
- `automatic ACTIVE policy: DISABLED`;
- learning writes remain disabled unless a separate bounded persistence test explicitly authorizes a test store;
- no model mutation while shadow predictions are collected.

Exit: frozen identity is observable and stable across the validation run.

## Gate 2 — Execute VALIDATE_SHADOW observation campaign

Objective: collect real observations/predictions while the frozen model cannot modify itself.

Record at minimum:

- observation count;
- prediction count;
- correct/incorrect/miss counts;
- context support;
- error/confidence calculation;
- candidate contexts after gates;
- exact runtime/device identity;
- start/end receipt identity;
- memory and latency/overhead measurements if the implementation exposes them.

Thresholds for accuracy/support must come from a versioned source contract or policy. This document does **not** invent numeric thresholds.

Exit: `INSUFFICIENT_EVIDENCE` can change only when the versioned support/accuracy gates are actually satisfied.

## Gate 3 — Validation persistence and restart

Current state is `validation persistence=TOKEN_VAZIO`.

Objective: prove whether validation state can be persisted and restored without conflating validation persistence with learning/training.

The test must declare:

- dedicated test-store identity/path;
- write scope and record format/version;
- before/after byte count and checksum;
- orderly restart test;
- interrupted-write/torn-tail fixture or bounded fault injection if recovery behavior is being claimed;
- recovered/not-recovered record counts;
- post-restart semantic equality checks.

Exit: persistence and recovery receive separate conclusions. `RFL recovered tail=NO` from the current empty/zero-record receipt is not sufficient recovery proof.

## Gate 4 — Scalar versus NEON physical benchmark

Objective: determine whether `CPU_NEON` is advantageous under measured total cost.

Compare the same operation/data with at least:

- scalar/reference route;
- NEON128 route;
- identical data sizes/alignment;
- warm-up policy declared;
- repeated samples;
- p50/p95/p99 or equivalent distribution;
- correctness/CRC equality;
- CPU/device state and Android context recorded;
- thermal/DVFS/scheduling limitations explicitly reported when they cannot be controlled.

Do not derive a speedup claim from the selftest alone.

Exit: routing recommendation is evidence-backed for the measured scope.

## Gate 5 — Recovery/rollback drill

Objective: prove the system can return to the prior known-good state.

Record:

- initial receipt/store/model identity;
- introduced test-state change;
- revert/recovery operation;
- final receipt/store/model identity;
- whether committed records and tail are consistent;
- any data loss or ambiguity.

No forceful mutation of production/user evidence stores is required for this drill; prefer isolated test state.

## Gate 6 — GPU feasibility, separately

GPU remains `TOKEN_VAZIO_NOT_PROMOTED` until a real backend exists and is measured.

A future GPU candidate must include:

- backend/API identity;
- initialization cost;
- transfer/copy cost;
- compute cost;
- synchronization cost;
- correctness parity with CPU reference;
- end-to-end latency/throughput;
- memory/energy/thermal limitations where observable.

Exit: GPU routing is considered only when **total cost**, not kernel-only time, is favorable for a declared workload.

## Gate 7 — Candidate ACTIVE policy

This gate is intentionally last.

Prerequisites:

- frozen-model shadow evidence sufficient under a versioned policy;
- persistence/restart semantics proven if ACTIVE depends on persistence;
- rollback path demonstrated;
- no unresolved mandatory safety/governance gate;
- exact candidate version/model/hash recorded;
- explicit promotion decision separated from model output itself.

Until these conditions exist:

`automatic_active=DISABLED`

remains the correct state.

## Current status map

| Gate | State from current receipt |
|---|---|
| Physical Android/ARM32 diagnostic | **PASS** |
| ELF probe + Frida Gadget load | **PASS** |
| NEON4096 SIMD fold selftest | **PASS** |
| Frozen-model prerequisite | **NOT MET** |
| VALIDATE_SHADOW evidence | **INSUFFICIENT_EVIDENCE** |
| Validation persistence | `TOKEN_VAZIO` |
| Recovery drill | **NOT PROVEN** |
| Scalar-vs-NEON comparative benchmark | **NOT PROVEN** |
| GPU backend | `TOKEN_VAZIO_NOT_PROMOTED` |
| Automatic ACTIVE | **DISABLED — keep disabled** |

# Frida Lab — Learning Candidate Incubator V1

Status: DESIGN_CONTRACT
Relationship: companion to `LEARNING_ARCHITECTURE_V1.md`
Activation: NOT IMPLEMENTED
Claim gate: `claim_allowed=false`

## Purpose

The candidate incubator is the "middle field" between observation/prediction and any future operational policy.

It must answer three different questions separately:

1. **Prediction:** what is likely to happen next in this context?
2. **Evaluation:** which candidate resource policy appears cheaper/safer for this context?
3. **Authorization:** is there enough independent evidence to allow a policy to leave shadow mode?

A high prediction accuracy answers only question 1. It does not authorize question 3.

## Candidate classes

V1/V2 candidates are restricted to resource-management choices inside the lab's own process:

- `RETENTION_HOT`
- `RETENTION_WARM`
- `RETENTION_COLD`
- `MAP_WINDOW_4K`
- `MAP_WINDOW_64K`
- `MAP_WINDOW_256K`
- `SAMPLING_FULL`
- `SAMPLING_HALF`
- `SAMPLING_QUARTER`
- `PREFETCH_OFF`
- `PREFETCH_NEXT_WINDOW`
- `ROUTE_LANE_0..N`
- `COMPACTION_DEFER`
- `COMPACTION_CANDIDATE`

No candidate in this protocol grants permission to alter a third-party application, bypass Android security boundaries, or activate system-wide instrumentation.

## Candidate lifecycle

```text
DISCOVERED
  -> OBSERVED
  -> SHADOW_SCORED
  -> CANARY_ELIGIBLE
  -> CANARY_RUNNING
  -> VALIDATION_PENDING
  -> ELIGIBLE
  -> FROZEN_PROPOSAL
  -> [future governed ACTIVE]
```

Failure paths:

```text
any state -> REJECTED
CANARY_RUNNING -> ROLLBACK
ELIGIBLE -> STALE -> SHADOW_SCORED
```

## Cost vector

Each candidate is scored by a vector, not a single accuracy number:

```text
C = (
  prediction_error_ppm,
  latency_p50_ns,
  latency_p95_ns,
  latency_p99_ns,
  bytes_written,
  mapping_operations,
  mapping_reuse_ratio,
  process_memory_delta,
  learning_memory_high_water,
  dropped_events,
  stale_ratio,
  compaction_amplification
)
```

The score must preserve the raw vector in the receipt. A weighted scalar may be used for ranking, but it cannot replace the underlying measurements.

## Exploration

Exploration is bounded and staged.

### Stage A — observational shadow

No behavior changes. Learn context/outcome distributions and measure baseline cost.

### Stage B — counterfactual shadow

Where a candidate can be estimated without applying it, calculate a shadow score. Mark the score `ESTIMATED`, never `MEASURED`.

### Stage C — canary measurement

Only the lab's own resource policy may change. Canary constraints:

- one candidate dimension at a time;
- hard maximum duration/observation count;
- predeclared memory and p99 latency abort budgets;
- immediate rollback on budget violation;
- no candidate promotion from the same samples used to choose it;
- canary and validation windows receive distinct epoch IDs.

## Exploration schedule

Do not use an unbounded epsilon-greedy loop in the instrumentation hot path.

A bounded scheduler may use:

```text
exploration_budget = min(configured_budget, candidate_budget, memory_budget)
```

Candidate selection occurs outside the per-event critical section. The hot path receives only an already selected numeric policy ID.

After enough evidence, exploration probability decays to zero for a frozen validation window. This allows an unbiased validation interval before eligibility is calculated.

## Eligibility gates

A candidate becomes `ELIGIBLE` only if every required gate passes:

```text
support >= MIN_SUPPORT
validation_support >= MIN_VALIDATION_SUPPORT
rolling_error_ppm <= MAX_ERROR_PPM
confidence_lower_bound >= CONFIDENCE_FLOOR
calibration_error <= CALIBRATION_BUDGET
candidate_p99_ns <= baseline_p99_ns + LATENCY_BUDGET
learning_p99_ns <= LEARNING_OVERHEAD_BUDGET
memory_high_water <= MEMORY_BUDGET
dropped_events <= DROP_BUDGET
rollback_test == PASS
training_epoch != validation_epoch
corruption_recovery == PASS
receipt_identity == VERIFIED
```

For memory/compaction candidates also require:

```text
write_amplification <= WRITE_AMP_BUDGET
compaction_amplification <= COMPACTION_BUDGET
verified_checkpoint_before_compaction == true
verified_checkpoint_after_compaction == true
```

## Accuracy language

The UI should expose both:

- observed accuracy / error ppm;
- evidence sufficiency.

Examples:

```text
Accuracy 100% / N=3 -> INSUFFICIENT_EVIDENCE
Accuracy 99.95% / N=20,000 -> fails 1000 ppm? evaluate exact error count
Accuracy 99.99% / validation N=100,000 -> may pass error gate, but still needs all other gates
```

The system must never print `SAFE`, `OPTIMAL`, or `READY` from accuracy alone.

## Fragmentation boundary

The learning component minimizes its own fragmentation by construction:

- fixed predictor table;
- fixed 4 KiB write slab;
- numeric IDs/offsets;
- bounded mapped windows;
- append-only segments;
- no per-event allocation.

Global process heap fragmentation is a separate measurement problem. RSS/PSS alone are not sufficient evidence of allocator fragmentation.

## Segment retention / GC broker

Future Phase 2 GC is a store-retention operation:

1. classify segment records as live summary inputs, superseded, cold, or tombstoned;
2. calculate stale ratio without rewriting the segment;
3. when threshold is reached, schedule compaction outside the hot path;
4. write a new segment/checkpoint;
5. verify checksums and replay identity;
6. atomically advance manifest epoch;
7. keep previous verified checkpoint for rollback;
8. retire old segment only after the new epoch is verified.

This is intentionally not a moving object GC.

## Promotion receipt

A future eligible candidate receipt must include:

- candidate ID and version;
- context family/hash contract;
- training epoch/range;
- canary epoch/range;
- validation epoch/range;
- raw cost vectors for baseline and candidate;
- error/confidence/calibration metrics;
- memory/latency/drop budgets and observed maxima;
- RFL store/checkpoint identity;
- APK/build/source SHA;
- physical device identity class (without inventing unsupported hardware facts);
- rollback receipt;
- final state `ELIGIBLE`, never implicit `ACTIVE`.

## Canonical invariant

```text
observe -> learn -> predict -> evaluate -> canary -> validate -> eligible

eligible != active
accuracy != safety
shadow estimate != measured canary
low overhead in CI != low overhead on device
```

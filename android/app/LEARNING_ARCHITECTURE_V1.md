# Frida Lab — Learning Architecture V1

Status: DESIGN_CONTRACT / implementation pending
Scope: self-process Android Frida Gadget laboratory
Claim gate: `claim_allowed=false` until implementation + CI + physical receipt

## 1. Goal

Turn the Frida Android Lab from a passive diagnostic page into a low-overhead learning runtime that can:

1. observe bounded instrumentation events;
2. encode them into fixed binary records;
3. learn repeated context -> outcome/policy relationships online;
4. make shadow predictions without changing behavior;
5. measure prediction error and runtime overhead;
6. declare a context eligible for promotion only after strict evidence gates;
7. keep the hot path allocation-bounded and fragmentation-resistant;
8. persist/replay state using a binary store inspired by ISOraf/ZIPRAF principles;
9. export/checkpoint evidence into ZIPRAF-compatible archival artifacts.

This is not a claim that user-space code bypasses Android/Linux. `mmap`, file I/O and page cache remain kernel-managed. The intended optimization is removal of avoidable higher-level overhead: per-event JSON, SQLite row/object churn, Java allocation churn, repeated parsing, repeated mappings, and unbounded heap allocation.

## 2. Existing architecture to reuse

### Vectras RmR TCG cache

`Vectras-VM-Android/engine/rmr/src/rmr_tcg_cache.c` already has useful semantics:

- hit/miss accounting;
- coherence score;
- miss variation;
- retention bias;
- collapse state;
- delta-XOR writes that touch only changed bits;
- reuse and preservation metrics.

The Frida learning layer should reuse the *contract ideas*, not copy the implementation blindly.

### Vectras ISOraf

`Vectras-VM-Android/engine/rmr/src/rmr_isorf.c` provides a dense-logical/sparse-physical model with page allocation only when required. The transferable ideas are:

- page-oriented state;
- fixed metadata;
- offset-based addressing;
- no object graph in the hot path;
- explicit manifest/identity/rebuild checks.

### Vectras ZIPRAF direct runtime

`Vectras-VM-Android/app/src/main/java/com/vectras/vm/vectra/ZiprafDirectRuntime.kt` already implements:

- strict ZIP STORE validation;
- bounded `MappedByteBuffer` windows;
- L1/L2-sized window policy;
- mapping reuse;
- mapping latency P50/P95/P99;
- read-only slices instead of whole-payload materialization.

### Existing ZipRaf DB

`Rafaelia_Private/src/c/zipraf_db.c` and `include/omega_zipraf.h` provide an append-oriented binary semantic store concept. They are useful for provenance and archive layout, but the current implementation must not be used as the learning hot path because it may allocate the entire data area to recompute CRC after append.

## 3. Layer model

```text
Frida event
   |
   v
[OBSERVE]
   |
   v
[FEATURE ENCODER]
   |
   +---------------------> [HOT FIXED TABLE]
   |                            |
   |                            v
   |                       [PREDICTOR]
   |                            |
   v                            v
[4 KiB RECORD SLAB]       [SHADOW RESULT]
   |                            |
   v                            v
[RFL HOT STORE] <------- [ERROR UPDATE]
   |
   +--> [RETENTION / COMPACTION]
   |
   +--> [ZIPRAF CHECKPOINT / RECEIPT]
   |
   v
[PROMOTION GATE]
```

## 4. Learning states

The UI and runtime must expose explicit states:

- `OFF`: no learning writes;
- `OBSERVE`: collect measurements only;
- `LEARN_SHADOW`: update model and produce predictions, but never apply them;
- `PREDICT_SHADOW`: expose predictions and confidence to the operator/Frida agent, still without automatic mutation;
- `ELIGIBLE`: statistical and overhead gates passed for a specific context; this is not activation;
- `ACTIVE`: future state, manual/governed promotion only;
- `FROZEN`: read-only learned state for reproducibility;
- `ROLLBACK`: discard active policy and return to previous frozen checkpoint.

V1 must stop at `PREDICT_SHADOW` / `ELIGIBLE`. Automatic activation is out of scope until physical validation exists.

## 5. What is learned

Do not start with a heavyweight neural model. V1 uses bounded online statistics suitable for ARMv7 and ARM64.

A context is a 64-bit stable hash over selected features, for example:

```text
context = H(
  event_type,
  module_id,
  hook_id,
  callsite_class,
  thread_class,
  previous_event_class,
  memory_pressure_bucket
)
```

A candidate/outcome is a compact integer ID. Initial safe candidates are internal resource policies, not arbitrary modification of other applications:

- next-event class prediction;
- hot/cold retention class;
- preferred mapped-window class;
- sampling level;
- prefetch/no-prefetch recommendation;
- keep/retire learning record;
- route/lane selection.

The Frida agent may emit other bounded event classes through the exported native observation API, but the learning core itself remains generic.

## 6. Predictor V1

Use a fixed-size, set-associative online predictor:

- 256 sets;
- 4 ways per set;
- 1024 entries total;
- no heap allocation after initialization;
- each entry stores context hash, candidate ID, support count, hit count, miss count, last epoch, EWMA cost, confidence and error.

Prediction for a context chooses the best supported candidate in its set. Updates use saturating counters and bounded replacement of the least-supported/oldest entry.

This is intentionally closer to a branch/cache predictor than to a general ML framework: deterministic cost, tiny footprint, explainable error and easy rollback.

## 7. Accuracy and promotion gate

`accuracy` alone is insufficient. Eligibility must require all gates simultaneously and per context/policy:

```text
support >= min_support
rolling_error_ppm <= configured_max_error_ppm
confidence_lower_bound >= configured_confidence_floor
calibration_error <= configured_calibration_budget
overhead_p99_ns <= configured_overhead_budget
memory_high_water_bytes <= configured_memory_budget
fragmentation_proxy <= configured_fragmentation_budget
validation_window != training_window
```

Initial conservative defaults for experimentation may be:

- `min_support = 4096` predictions for a context;
- `max_error_ppm = 1000` (0.1%) for an initial gate;
- confidence lower bound >= 99.9%;
- no automatic promotion when evidence is insufficient.

These are configuration defaults, not claims that the implementation already reaches them. More stringent thresholds such as 99.99% may be selected later, but only if enough independent observations exist to support them.

The UI must show `INSUFFICIENT_EVIDENCE` instead of rounding a small sample into a misleading high accuracy.

## 8. Binary hot store: RFL V1

Working name: `RFL` = Rafaelia/Frida Learning Log.

RFL is the hot learning store. ZIPRAF is the checkpoint/archive layer.

### Why not write ZIP per event

Updating ZIP metadata, CRCs or high-level database objects per event would create unnecessary write amplification. Hot observations should be sequential fixed-size records. Periodic checkpoints can be exported into ZIPRAF.

### Record shape

Target: 64-byte fixed record, naturally page-friendly.

Suggested fields:

```text
u64 sequence
u64 monotonic_ns
u64 context_hash
u64 outcome_hash_or_aux
u32 event_type
u32 candidate_id
u32 cost_ns_q
u32 memory_delta_q
u16 predicted_id
u16 actual_id
u16 confidence_q16
u16 error_q16
u32 flags
u32 crc32c
```

The exact on-disk struct must have compile-time size assertions and explicit endianness/version rules. No implicit compiler padding may define the wire format.

### Write slab

- 64 records x 64 bytes = 4096-byte slab;
- static/fixed slab in native memory;
- append slab with one bounded write sequence;
- no malloc/free per observation;
- explicit flush on pause/freeze/exit;
- partial-write handling is fail-closed.

## 9. Fragmentation strategy

The learning engine must not depend on moving heap objects.

Rules:

1. predictor table lives in fixed native storage;
2. records use numeric offsets/IDs, never persistent raw pointers;
3. hot record slab has fixed capacity;
4. no allocation per event;
5. mapped archive windows are bounded and reusable;
6. compaction is segment-based and runs outside the instrumentation hot path;
7. compaction creates a new segment/checkpoint and swaps by epoch only after verification;
8. old mappings remain valid only for their recorded epoch;
9. rollback keeps the previous verified checkpoint until the new one is committed.

This is a retention/compaction collector, not a tracing object garbage collector.

## 10. Segment GC / compaction

V2 target:

- append-only segments, e.g. 1–4 MiB each;
- classify records as hot, cold, superseded or tombstoned;
- compact only cold segments whose stale ratio exceeds a threshold;
- preserve aggregate predictor statistics before retiring raw observations;
- write new segment -> checksum -> fsync policy -> manifest update -> epoch switch;
- never rewrite the only valid copy in place;
- retain rollback checkpoint.

Under memory pressure, prefer reducing sampling/prefetch and freezing learning before introducing unbounded allocation.

## 11. ZIPRAF relationship

ZIPRAF remains useful for:

- immutable checkpoints;
- receipts;
- model/predictor snapshots;
- RFL segment archival;
- SHA/CRC/integrity metadata;
- transport between Termux/Vectras/desktop tooling;
- read-only mmap/direct-map candidates when layout/alignment/integrity gates permit.

Canonical relationship:

```text
RFL = hot mutable learning log
ISOraf ideas = sparse/fixed page semantics
Vectras direct runtime = bounded mapped read path
ZIPRAF = immutable checkpoint / evidence / transport
```

## 12. Frida menu

Inside Developer Mode:

```text
Learning
  Mode: OFF | OBSERVE | LEARN_SHADOW | PREDICT_SHADOW | FROZEN
  Verbose learning logs: on/off
  Store: RFL V1
  Observations: N
  Predictions: N
  Correct: N
  Error: ppm
  Confidence: % / INSUFFICIENT_EVIDENCE
  Hot table occupancy: %
  Write slab: used/4096 B
  Store bytes: N
  Compaction state: IDLE / SCHEDULED / RUNNING / TOKEN_VAZIO
  Memory high-water: N
  Overhead p50/p95/p99: N ns
  Eligible contexts: N

  [Start Observe]
  [Start Shadow Learning]
  [Freeze]
  [Flush]
  [Create ZIPRAF checkpoint]
  [Reset volatile predictor]
  [Open Developer Options]
```

No `ACTIVE` button in V1.

## 13. Frida agent bridge

The source-built ELF probe evolves into a native learning bridge with exported functions conceptually equivalent to:

```c
int rafaelia_learning_init(const char *store_path);
int rafaelia_learning_set_mode(uint32_t mode);
int rafaelia_learning_observe(uint64_t context,
                              uint32_t candidate,
                              uint32_t event_type,
                              uint64_t cost_ns,
                              int64_t memory_delta);
int rafaelia_learning_predict(uint64_t context,
                              uint32_t *candidate_out,
                              uint16_t *confidence_q16_out);
int rafaelia_learning_snapshot(void *snapshot_out, uint32_t bytes);
int rafaelia_learning_flush(void);
```

Java/JNI controls the menu and status. Frida JavaScript can call the same exported C ABI through `NativeFunction`, so the model does not depend on Java object allocation for each instrumentation event.

## 14. Overhead instrumentation

Measure instead of claiming:

- observe-call latency p50/p95/p99;
- predictor lookup/update latency;
- records/sec;
- write calls/sec;
- mapped bytes and mapping reuse;
- native static footprint;
- Java heap delta;
- process RSS/PSS when available;
- dropped/sampled events;
- store growth;
- compaction bytes read/written;
- prediction error/calibration.

Learning must automatically fall back to OBSERVE/FROZEN if its own overhead exceeds the configured budget.

## 15. Fail-closed rules

- corrupt RFL header -> do not learn from file;
- unsupported version/record size -> reject;
- partial record -> stop replay at last complete verified record;
- CRC mismatch -> reject affected record/segment according to versioned policy;
- predictor state is never treated as evidence unless tied to store identity/epoch;
- insufficient samples -> no promotion;
- failed checkpoint -> keep previous verified checkpoint;
- physical-device PASS is not inferred from CI.

## 16. Implementation phases

### Phase 0 — contract

- this document;
- C public header;
- fixed record/header ABI;
- compile-time size assertions;
- no runtime behavior change.

### Phase 1 — shadow learning core

- fixed predictor table;
- 4 KiB record slab;
- RFL append/replay;
- JNI menu state;
- exported Frida observation/predict ABI;
- OFF/OBSERVE/LEARN_SHADOW/PREDICT_SHADOW/FROZEN;
- metrics and receipts.

### Phase 2 — memory/retention

- bounded segments;
- stale/tombstone accounting;
- cold-segment compaction;
- memory-pressure fallback;
- ZIPRAF checkpoint export.

### Phase 3 — governed promotion

- validation window split;
- confidence/error gates;
- overhead budget gate;
- rollback receipt;
- only then consider an `ACTIVE` policy mode.

## 17. Invariants

```text
learning != correctness
prediction != permission to act
high sample accuracy != calibrated confidence
CI PASS != physical-device PASS
binary store != bypassing the OS
GC here = bounded retention/compaction, not magic memory elimination
hot path != archive path
RFL mutable != ZIPRAF checkpoint immutable
claim_allowed=false until evidence closes the relevant gate
```

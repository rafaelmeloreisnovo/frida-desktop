# Android runtime stability dump — V2 falsifiable contract

## Purpose

`agents/android-runtime-stability-dump.js` is a passive Frida sensor for
authorized Android processes. It emits a structural runtime dump suitable for:

- recognizing the platform/build surface;
- recognizing the loaded-module surface;
- comparing two executions;
- detecting platform drift separately from module/lazy-load drift and ordinary
  runtime drift;
- attaching a neutral context packet to crash, performance or compatibility
  investigations.

It does **not** decide that a process is stable or unstable. A snapshot is
evidence, not a causal conclusion.

## Feedback loop

```text
COLLECT
  -> NORMALIZE
  -> DUMP
  -> COMPARE
  -> DELTA
  -> HYPOTHESIS / TOKEN_VAZIO
  -> NEXT OBSERVABLE TEST
  -> NEW DUMP
```

This is the intended retroalimentacao loop. Nothing is silently promoted from
a changed value to a bug.

## Semantic separation

### Platform identity

Used to recognize whether two dumps belong to the same technical platform
surface:

- architecture;
- pointer size;
- page size;
- platform;
- Android/ART build identity when Java is available.

This produces `platform_key`.

### Module recognition surface

The loaded module **name + size** set produces `module_surface_key`.

It is deliberately separate from platform identity because legitimate lazy
loading may add/remove modules without changing firmware, ABI or logical
application identity.

The combined `recognition_key` is useful for exact surface matching, but a
module-only mismatch is classified as `MODULE_SURFACE_DRIFT`, not
`IDENTITY_DRIFT`.

ASLR module bases are never included in recognition hashes. The compact FNV-1a 32-bit fingerprints are convenience hints only; comparison of the authoritative module surface uses the full `name + size` projection so a hash collision cannot hide module drift.

### Volatile runtime state

Useful for stability and drift analysis, but expected to change:

- PID and current TID;
- module load bases;
- thread count and state distribution;
- readable/writable/executable range counts and bytes;
- Java/native heap counters;
- device elapsed time.

A change here is `RUNTIME_DRIFT`, not automatically a defect.

### TOKEN_VAZIO

The dump explicitly refuses to infer:

- LMKD kill reason;
- SELinux causality;
- physical memory pressure;
- crash causality.

Those require independent sources.

## Privacy boundary

The agent does not collect:

- device serial or Android ID;
- SIM/subscriber identifiers;
- application payload bytes;
- clipboard/UI text;
- file contents;
- credentials;
- module paths.

The process name is not collected.

## Frida use

Load the agent normally:

```sh
frida -U -n <authorized-process> -l agents/android-runtime-stability-dump.js
```

The agent emits one `RUNTIME_STABILITY_DUMP` on load.

A controller may request later snapshots through the RPC export:

```text
snapshot(reason)
```

Periodic polling is deliberately not built into V1; the controller decides
when a new observation is materially useful.


## Append-only dump file

For a local Gadget endpoint in Termux, the controller can capture the initial
sanitized agent snapshot directly into an append-only file:

```sh
python3 tools/capture-runtime-stability-dump.py \
  --endpoint 127.0.0.1:27042 \
  --process Gadget
```

The default destination is:

```text
~/.local/state/rafaelia/frida-runtime-stability/
  runtime-stability-<UTC>.json
  runtime-stability-<UTC>.json.sha256
```

Files are created with mode `0600`, never overwritten, flushed with `fsync`,
and accompanied by SHA-256. The process name or PID supplied only to locate the
authorized target is not persisted by the controller as identity metadata.

The file is intentionally a neutral observation packet. It can be attached to
a crash, performance, compatibility or HyperMemory investigation without
claiming that any observed drift caused a failure.

## Comparison

Save two emitted dump objects as JSON and run:

```sh
python3 tools/runtime-stability-diff.py baseline.json candidate.json
```

V2 classifications, in fail-closed priority order:

- `INCOMPARABLE` — unsupported/incomplete schema;
- `VISIBILITY_DRIFT` — the observer can no longer see the same evidence surface;
- `INSTRUMENTATION_DRIFT` — Frida version or JS runtime changed;
- `IDENTITY_DRIFT` — target platform/build identity changed;
- `MODULE_SURFACE_DRIFT` — full module `name+size` projection changed;
- `RUNTIME_DRIFT` — comparable volatile runtime state changed;
- `NO_OBSERVED_DRIFT`.

Clock position, capture duration, PID/TID, ASLR bases and compact hash hints
are reported but excluded from the stability classification.

None of these establishes root cause.

## HyperMemory bridge

The dump is intentionally compatible with a later HyperMemory causal tail:

```text
runtime dump
  -> platform key / module-surface key
  -> HyperMemory event
  -> crash/performance event
  -> successor dump
  -> semantic delta
```

This lets the system ask a better question than "did the app crash?":

> Which structural or runtime dimensions changed before the observed failure?

## Evidence boundary

Hosted CI can prove syntax, contract shape, comparator behavior and privacy
guards. It cannot prove device behavior.

```text
FRIDA_DEVICE_EXECUTION = TOKEN_VAZIO
PHYSICAL_STABILITY     = TOKEN_VAZIO
CAUSAL_ATTRIBUTION     = TOKEN_VAZIO
claim_allowed          = false
```


## V2 omission audit

V2 exists because several apparently small details can invalidate a stability
conclusion if they are left implicit.

### Exact memory-range accounting

Frida protection filters are minimum-permission filters. For example, `rw-`
means "at least readable and writable", not an exclusive class. V1 queried
multiple filters independently, which could overlap. V2 enumerates the range
surface once with the all-range filter and buckets each returned range by its
**exact** `range.protection`.

This invariant is now falsified in CI if the old overlapping-query pattern
returns.

### Clock and process-instance separation

A later snapshot naturally has a different clock. A restarted process naturally
has a different PID. Neither fact is itself instability.

V2 therefore reports:
- wall and monotonic clock coordinates;
- capture duration;
- PID/TID process-instance changes;

but excludes them from the stability classification.

### Instrument versus target

`Frida.version` and `Script.runtime` are recorded as
`instrumentation_identity`. A changed instrument is classified separately
from a changed target.

Frida's own heap footprint and capture duration are also recorded so observer
cost is measured instead of assumed to be zero.

### Visibility is evidence

If modules, threads, Java runtime or memory ranges stop being observable, the
result is `VISIBILITY_DRIFT`. V2 does not reinterpret missing evidence as a
target change.

### Non-atomic snapshot

The sensor reads several subsystems sequentially. It does not stop all target
threads and therefore cannot honestly claim an atomic world-state.

```text
consistency_model = BEST_EFFORT_NON_ATOMIC
```

Start/end clock coordinates and collection duration bound the observation
window.

### Controlled reason vocabulary

The RPC reason is allowlisted. Unknown caller text becomes
`CALLER_DEFINED`; arbitrary text is not persisted into the dump.

### Optional event-driven dynamics

V2 keeps snapshots as the default and adds opt-in module/thread observers:

```text
startobservers(false)
stopobservers()
```

They are event-driven rather than periodic. Existing modules/threads are
suppressed by default; callers may explicitly request the initial surface.
Thread names and previous names are never emitted.

### Append-only evidence chain

The controller now creates:

```text
runtime-stability-<UTC>.json
runtime-stability-<UTC>.json.sha256
ledger.jsonl
```

Each ledger record points to the preceding dump SHA-256. Writes remain
exclusive-create + `fsync`; non-loopback Frida endpoints are refused unless
the caller explicitly opts in with `--allow-remote`; dump size is bounded
(default 8 MiB).

## Falsification methodology

The machine-readable matrix lives at:

```text
profiles/runtime-stability-falsification-matrix.v1.json
```

Each hypothesis contains a claim, positive control, falsifier and evidence
gate. Hosted CI attempts to break invariants such as ASLR invariance,
hash-hint non-authority, clock/PID exclusion, schema fail-closed behavior,
visibility/instrument separation and append-only hash chaining.

A physical stability claim is not promoted by hosted tests. The current
promotion contract requires independent device runs and the relevant physical
context. LMKD cause, SELinux causality, memory-pressure cause and crash root
cause stay `TOKEN_VAZIO` until an independent source supplies that evidence.

## Alternatives retained or rejected

| Alternative | State | Reason |
| --- | --- | --- |
| on-demand structural snapshot | IMPLEMENTED DEFAULT | bounded, neutral evidence |
| module/thread event observers | IMPLEMENTED OPT-IN | dynamic evidence without polling |
| periodic polling | REJECTED AS DEFAULT | observer load and self-interference |
| full memory/payload dump | REJECTED | privacy, size and causal ambiguity |
| LMKD/SELinux/tombstone correlation | EXTERNAL EVIDENCE REQUIRED | must remain an independent source |
| HyperMemory causal tail | SUCCESSOR BRIDGE REQUIRED | dump provides context, not root cause |

This is intentional: rigor means implementing useful alternatives **and**
recording why alternatives that weaken falsifiability or operational integrity
are not promoted.


## Safe Android platform contract

The V2 agent reads a strict allowlist of non-identifying Android properties
through `android.os.SystemProperties`. The intent is to carry the technical
contract discovered during physical preflight into each Frida observation
without copying the full `getprop` surface.

Examples include:
- zygote and ABI lists;
- ART ARM variant/features;
- VNDK and first API level;
- board/hardware/platform family;
- build type/debuggable/secure flags;
- Verified Boot / verity / boot lock state;
- file-based encryption state;
- A/B and dynamic-partition context;
- `sys.use_memfd`, per-app memcg and LMKD downgrade tuning;
- selected service states for `lmkd`, `ashmemd`, `hidl_memory`,
  `tombstoned`, `traced` and `traced_probes`.

Explicitly excluded are serial/PSN, SIM/ICCID/IMSI/subscriber fields,
operator/carrier identity and radio provisioning data.

The agent also records process PSS through Android's `Debug.getPss()`, plus
native heap size/free/allocated and loaded-class count. These are runtime
observations, not proof of memory pressure or LMKD causality.

## Hosted HyperMemory bridge

`modules/runtime-learning-engine/runtime-stability-hypermemory-bridge.ts`
projects V2 dumps and V2 diffs into bounded HyperMemory records.

The bridge intentionally does **not** embed the full loaded-module list. It
keeps:
- source schema/hash;
- stable/instrumentation identity;
- visibility state;
- recognition hints and module count;
- thread/range/heap/PSS summaries;
- gaps and timing;
- diff change paths.

Every bridged event preserves:

```text
causality = NOT_INFERRED
claim_allowed = false
```

So the hosted bridge is implemented, while physical shared-memory/restart
survival and physical causal attribution remain separate gates.


## Omission accounting

The runtime-stability layer now has two machine-readable governance companions:

```text
profiles/runtime-stability-omission-ledger.v1.json
profiles/runtime-stability-evidence-source-matrix.v1.json
```

The omission ledger prevents low-weight observations from silently disappearing.
Every observed family receives exactly one explicit disposition:

- `IMPLEMENTED`
- `DEFERRED_WITH_GATE`
- `EXTERNAL_EVIDENCE_REQUIRED`
- `SENSITIVE_EXCLUDED`
- `REJECTED_WITH_REASON`

Each row also carries a rationale, a falsifier and the next gate. Therefore
"not in the active dump" is no longer semantically equivalent to "irrelevant"
or "forgotten".

The evidence-source matrix defines the authority boundary of Frida structural
dumps, HyperMemory, tombstones, LMKD/kernel evidence, SELinux AVC evidence,
Perfetto/atrace, safe getprop properties and independent physical repetition.
Cross-source causal claims require an explicit time/identity bridge; no single
source is allowed to silently promote itself into a stronger evidence class.

This accounting is CI-gated together with the active collector so governance
cannot drift away from implementation.


## Repeated-measure and falsifiability successor

The V2 sensor remains the authoritative collection surface. The successor layer
adds experimental comparability and epistemic gates without replacing the
existing visibility/instrumentation/privacy contracts.

### Condition control

The host controller accepts:

```text
--condition-id <label>
```

with `[A-Za-z0-9_.-]{1,64}`. Equal labels mean only that the operator declared
the captures comparable under the same workload/condition contract. They are
not causal variables. Different labels fail closed as
`INCOMPARABLE_CONDITION`.

### Non-atomic module fence

The sensor enumerates the module recognition surface at both endpoints of its
sequential capture. If the endpoint surfaces differ, the comparator returns
`INCOMPARABLE_CAPTURE_RACE`.

Equal endpoints are weaker evidence: transient load/unload activity may occur
between fences and escape observation. Therefore this fence detects some
non-atomicity; it does not convert the snapshot into an atomic world-state.

### Boot and process generation

For a same-device loopback controller, the boot identifier is reduced to
SHA-256 and carried as context only. Remote/USB targets do not silently inherit
the controller's boot identity.

When Java is available, process start elapsed time, process age and cumulative
CPU time are captured. PID/process-start changes are reported as
`PROCESS_INSTANCE_DRIFT`, not platform instability.

### Robust baseline

`tools/runtime-stability-baseline.py` requires at least three distinct
capture events under a consistent stable identity, instrumentation surface and
`condition_id`. It uses median + MAD for numeric envelopes and empirical
module prevalence.

A baseline outlier is an observation:

```text
RUNTIME_OUTLIER_OBSERVED != BUG != ROOT_CAUSE
```

### Evidence ladder

`tools/runtime-stability-evidence-gate.py` validates the structural readiness
of packets through:

```text
OBSERVED
  -> REPEATED
  -> ASSOCIATED
  -> CAUSAL_CANDIDATE
  -> CAUSAL_SUPPORTED
```

Even a structurally complete `CAUSAL_SUPPORTED` packet keeps:

```text
causal_claim_allowed = false
publication_grade_causal_support = false
claim_allowed = false
```

The gate validates methodology structure. It does not decide scientific truth.

### HyperMemory minimization

The V2 HyperMemory bridge validates the source schema and claim boundary,
accepts an optional source SHA-256, and stores only bounded semantic
projections. It does not copy raw module lists or Java/build fingerprints.

Causal-tail envelopes are locally SHA-linked. If the predecessor has already
been evicted, the bridge emits
`TOKEN_VAZIO_EVICTED_PREDECESSOR` instead of inventing a new genesis.

### Merge-resolution invariant

This successor intentionally composes the two independent V2 development
lines:

```text
PR70 sensor/control-plane
+
PR71 repeated-measure/methodology/causal-tail hardening
!= overwrite either side
```

Physical Frida execution, SharedMemory process-death survival, LMKD/SELinux
causality and crash root cause remain separate `TOKEN_VAZIO` gates.

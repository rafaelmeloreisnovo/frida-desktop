# Runtime stability falsifiability methodology

## Scope

This methodology governs passive Frida runtime-stability observations and their
promotion into stronger evidence classes. It is intentionally stricter than a
simple "changed / did not change" comparison.

The core invariant is:

```text
OBSERVATION != REPETITION != ASSOCIATION != CAUSATION
```

and:

```text
TOKEN_VAZIO != FAIL
HOSTED_EVIDENCE != PHYSICAL_DEVICE_EVIDENCE
DRIFT != INSTABILITY
```

## Scientific loop

```text
OBSERVE
  -> define falsifier
  -> repeat under comparable conditions
  -> build robust baseline
  -> expose candidate
  -> measure deviation
  -> inspect alternative explanations
  -> corroborate with an independent source
  -> intervene/reverse when safe and authorized
  -> promote or reject
```

Every promotion must be reversible by contradictory evidence.

## 1. Observation quality

A measurement can only be compared if the observation itself is sufficiently
specified. The runtime dump therefore records:

- schema;
- stable identity;
- module surface;
- volatile runtime state;
- observer/instrumentation presence;
- approximate capture duration;
- agent/controller source hashes when captured by the controller.

A low-quality observation is not evidence of absence. It becomes
`TOKEN_VAZIO`.

## 2. Repeated-measure baseline

`tools/runtime-stability-baseline.py build` requires at least three independent
snapshots.

The baseline fails closed if:

- stable identity differs between snapshots;
- platform key differs;
- a required observation is missing;
- fewer than three snapshots exist.

Numeric runtime metrics use:

- median as robust center;
- median absolute deviation (MAD) as dispersion;
- 1.4826 MAD scaling;
- robust-z > 6 as an observed outlier.

When MAD is zero, a candidate outside the empirical min/max range is marked as
a deviation. It is still not a bug or a causal claim.

Loaded modules are modeled by empirical prevalence:

- present in every baseline snapshot -> core module;
- present in some -> variable/lazy-load candidate;
- absent from baseline but present in candidate -> novel surface observation.

## 3. Candidate assessment

```sh
python3 tools/runtime-stability-baseline.py build \
  dump-1.json dump-2.json dump-3.json \
  --out baseline.json

python3 tools/runtime-stability-baseline.py assess \
  baseline.json candidate.json \
  --out assessment.json
```

Possible high-level assessment classes include:

- `WITHIN_OBSERVED_BASELINE`
- `RUNTIME_OUTLIER_OBSERVED`
- `MODULE_SURFACE_OUTSIDE_BASELINE`
- `IDENTITY_DRIFT`
- `INSUFFICIENT_OBSERVATION`

None implies root cause.

## 4. Evidence ladder

`tools/runtime-stability-evidence-gate.py` enforces a monotonic evidence ladder:

1. `OBSERVED`
2. `REPEATED`
3. `ASSOCIATED`
4. `CAUSAL_CANDIDATE`
5. `CAUSAL_SUPPORTED`

The highest level requires:

- at least three observations;
- at least two independent source types;
- temporal precedence;
- an attempted falsifier;
- alternative-explanation review;
- controlled intervention or reversal/reproduction.

The tool validates whether the evidence packet satisfies the declared
methodology. It does not decide scientific truth.

## 5. Alternative explanations that must be considered

Before promoting runtime drift:

- lazy module loading;
- ASLR movement;
- normal thread scheduling;
- JIT/AOT/GC transitions;
- thermal/power state;
- LMKD or memory pressure;
- SELinux denial;
- process restart/generation change;
- observer/instrumentation effect.

## 6. Cross-scale bridge rule

Evidence is scale-bound.

Examples:

```text
heap growth != memory leak
module drift != ABI incompatibility
SIGSEGV != proof of buffer overflow
SELinux denial != application logic bug
LMKD process death != native crash
```

A claim crossing a scale requires an explicit evidence bridge.

## 7. HyperMemory causal bridge

`RuntimeStabilityHyperMemoryBridge` writes minimized events into HyperMemory.

It intentionally stores:

- compact platform/module recognition keys;
- counts;
- changed paths;
- explicit outcome source/layer;
- process generation when supplied;
- unresolved gap keys;
- previous payload SHA-256.

It intentionally does not copy:

- full Java identity;
- build fingerprint;
- raw module names from the dump;
- before/after values from diffs;
- application payload.

This keeps the causal tail small and reduces privacy exposure.

## 8. What would falsify the current architecture?

The architecture must be reconsidered if any of these occur:

- repeated baseline snapshots cannot remain identity-consistent;
- observer timing materially changes the target behavior;
- module name+size is insufficient to distinguish relevant binary surfaces;
- HyperMemory chain restoration breaks predecessor linkage;
- independent crash evidence contradicts the inferred temporal ordering;
- candidate deviations disappear under controlled replication;
- the same claimed cause fails to reproduce under an authorized reversal test.

These are not inconveniences; they are required falsifiers.

## Evidence boundary

Hosted CI may prove:

- syntax;
- baseline mathematics;
- fail-closed promotion rules;
- HyperMemory bridge serialization/chain behavior;
- privacy minimization contracts.

It may not prove:

```text
PHYSICAL_ANDROID_STABILITY
LMKD_CAUSALITY
SELINUX_CAUSALITY
CRASH_ROOT_CAUSE
SHAREDMEMORY_SURVIVAL
FRIDA_REATTACH_RECOVERY
```

Those remain `TOKEN_VAZIO` until device evidence exists.

## 9. Evidence independence

Three references to the same snapshot are not three observations. Baseline
construction rejects duplicate paths and byte-identical snapshots.

Likewise, two source labels are not necessarily independent. Evidence packets
carry an `independence_group`; association and causal levels require distinct
groups. A Frida-derived summary and another file mechanically derived from that
same summary cannot masquerade as two independent measurements.

## 10. Retention and crash consistency

Append-only does not mean unbounded.

The controller defaults to:

- at most 256 raw dump JSON files;
- at most 64 MiB in the dump directory;
- at least 16 MiB free-space reserve after the new dump.

Reaching a bound fails closed. Old evidence is not deleted automatically.

Publication uses a temporary file, file `fsync`, an exclusive hard-link into
the final filename and directory `fsync`. JSON serialization rejects NaN and
Infinity.

## 11. Tail discontinuity

A bounded HyperMemory ring may evict an earlier causal-tail event. If the bridge
cannot observe the predecessor and eviction has occurred, it records:

```text
TOKEN_VAZIO_EVICTED_PREDECESSOR
```

It must not reset the chain to `GENESIS`, because that would manufacture a
false beginning.


## Audit hardening: previously implicit failure modes

The successor audit treats the following as first-class falsifiers rather than
implementation details:

- **Missingness is not equality.** Two missing observations never establish
  `NO_OBSERVED_DRIFT`; the comparison fails closed as insufficient.
- **Capture is non-atomic.** The module surface is fenced at capture start/end.
  If the endpoint surfaces differ, module recognition is incomparable. Equal
  endpoints still do not prove that no transient churn occurred between them.
- **Observer visibility is bounded.** Frida introspection is Cloak-aware, so
  instrumentation-owned resources may be absent from thread/range enumeration.
- **Memory-range filters are overlapping predicates.** Ranges are therefore
  enumerated once and aggregated by the exact protection returned by Frida.
- **Java absence is a scope, not a failure.** A native-only process may produce
  a valid `NATIVE_ONLY` observation. `JAVA_AWARE` and `NATIVE_ONLY`
  observations are distinct stable-identity scopes.
- **Condition matters.** Each controller capture carries a bounded
  `condition_id`. Different conditions are incomparable, not target drift.
- **Process instance matters.** PID and, when Java is available,
  `Process.getStartElapsedRealtime()` are treated as process-generation
  context, separate from firmware identity and from runtime instability.
- **Boot session matters.** A privacy-safe SHA-256 of the per-boot kernel boot
  id is controller context on a same-device capture; a reboot is reported as a
  distinct dimension.
- **Repeated capture is not independent evidence.** Repetition requires unique
  observation fingerprints. Association/causal levels additionally require
  distinct source types, independence groups and evidence references.
- **Non-empty arrays are not evidence.** Falsifier, temporal-order,
  intervention and alternative-explanation records must contain required
  semantic fields; empty objects fail closed.
- **Methodological completeness is not truth.** Even a structurally complete
  `CAUSAL_SUPPORTED` packet leaves `causal_claim_allowed=false` and
  `claim_allowed=false`; scientific/physical review is external to this gate.
- **Append order is not causality.** Local dumps carry
  `previous_dump_sha256`; the storage layer serializes writers and rejects a
  stale predecessor before publication. This proves local order/integrity only.

## System context and confounders

When the controller itself is running on the same Android device as a loopback
Frida target, it may add an explicitly bounded `CONTEXT_ONLY` packet:

- selected non-identifying Android properties relevant to ashmem/LMKD/boot;
- selected `/proc/meminfo` counters;
- memory PSI when exposed by the kernel;
- kernel release/machine;
- SELinux enforcing state when readable;
- load averages;
- a SHA-256 of the per-boot boot id.

For remote/USB targets this local context is not silently attributed to the
target and is omitted as target context.

These fields are potential confounders and covariates. They never establish an
LMKD, SELinux, thermal, memory-pressure or crash cause by themselves.

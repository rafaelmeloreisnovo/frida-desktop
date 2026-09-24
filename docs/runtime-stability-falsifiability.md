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

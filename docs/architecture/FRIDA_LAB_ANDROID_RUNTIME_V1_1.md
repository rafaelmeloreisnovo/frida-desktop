# RAFAELIA Frida Lab — Android Runtime Architecture V1.1

Status: **IMPLEMENTED_UNTESTED for this branch until exact-head CI completes**  
Producer authority: `rafaelmeloreisnovo/frida-desktop`  
Base main observed before delta: `53193abfb0910f1adf7096a2802e9992899fa173`  
Invariant: `SOURCE != ARTIFACT != EXECUTION != EVIDENCE != CLAIM`; `TOKEN_VAZIO != 0`.

## 1. Current one-screen execution path

The current Android operator path is implemented in:

- `android/app/src/io/rafaelia/fridalab/MainActivity.java`
- `android/app/build.gradle`

Observed control chain in code:

```
Java Activity
  -> javac / D8 / DEX
  -> JNI nativeLearning* + learningObserve(...)
  -> source-built native probe / RFL runtime
  -> NEON4096 snapshot/self-test
```

Frida Gadget is loaded separately through `System.loadLibrary("frida-gadget")` and bound to the local endpoint reported as `127.0.0.1:27042`. The operator UI does not require external ADB/desktop tooling for the local snapshot path.

### Current Android build contract

From `android/app/build.gradle` at the observed base:

- applicationId: `io.rafaelia.fridalab`
- minSdk: 29
- compileSdk / targetSdk: 34
- NDK ABI filters: `armeabi-v7a`, `arm64-v8a`
- debug build: debuggable
- release build: non-debuggable

## 2. Learning modes already present in MainActivity

Numeric modes already implemented:

0. OFF
1. OBSERVE
2. LEARN_SHADOW
3. PREDICT_SHADOW
4. VALIDATE_SHADOW
5. FROZEN

Current safety boundaries already implemented:

- OFF and FROZEN block `learningObserve(...)`.
- invalid six-field operator input is rejected before JNI/RFL mutation.
- negative `costNs` is rejected.
- automatic ACTIVE remains explicitly disabled.
- GPU backend remains `TOKEN_VAZIO`.
- validation persistence remains `TOKEN_VAZIO`.
- volatile predictor reset is allowed only in OFF/FROZEN.

## 3. Parallel/legacy Android classes present

The repository also contains:

- `learning/RFLBridge.java`
- `learning/MetricsPoller.java`
- `ui/ResearchModePanel.java`

They form a parallel string-mode/JSON metrics path. The current one-screen `MainActivity` uses direct static/native bindings instead and does not import those three classes.

This is **architectural coexistence**, not proof that both paths are equivalent.

Known drift to retain as an explicit gap:

- MainActivity includes `VALIDATE_SHADOW`; the parallel ResearchModePanel mode list does not.
- RFLBridge documentation describes a no-prediction return value of `0`; if zero is also a valid model outcome, the sentinel semantics require a separate ABI-safe resolution.
- ResearchModePanel historically defaults absent JSON metrics to numeric zero; that path must not be treated as evidence until its unknown-value semantics are reconciled.

No compatibility claim is promoted from those observations.

## 4. Receipt V1.1 semantic patch

This delta changes presentation/audit semantics, not predictor math.

When training has zero observations and zero predictions:

- `training error: 0 ppm` is projected as `TOKEN_VAZIO / NO_SAMPLES`.
- p50/p95/p99 all-zero with no samples is projected as `TOKEN_VAZIO / NO_SAMPLES`.

When VALIDATE_SHADOW has zero observations and zero predictions:

- validation state becomes `NOT_RUN`.
- `model frozen: NO` is not interpreted as an existing mutable model; the receipt projects `NO_MODEL` / `TOKEN_VAZIO`.
- `error: 0 ppm` becomes `TOKEN_VAZIO / NO_SAMPLES`.

The native snapshot remains the source observation; normalization is an evidence-preserving presentation layer.

Additional explicit receipt fields:

- `receipt_schema=1.1`
- `runtime_state`
- `learning_state`
- `validation_state`
- `learning_mutations`
- `filesystem_write_claim=TOKEN_VAZIO`
- `measurement_semantics=TOKEN_VAZIO_ON_ZERO_DENOMINATOR`
- `rfl_recovery_required=TOKEN_VAZIO`

The existing line `RFL recovered tail: NO` does not by itself prove whether recovery was required, attempted, unnecessary, or unsuccessful; that distinction remains open.

## 5. Runtime-learning risk ratchet already on main

Main already contains the uncertainty-risk hotfix merged by PR #72:

- heuristic runtime signals are tagged `OBSERVATION_ONLY` before automatic mutation;
- worsening rollback/success evidence can tighten automatic thresholds but cannot automatically relax them;
- integrity evidence uses SHA-256 while non-cryptographic fast hashes remain a separate concept;
- physical restart/reattach/restore evidence remains independent from hosted tests.

Relevant files include:

- `docs/runtime-uncertainty-family-v1.md`
- `modules/runtime-learning-engine/auto-optimizer.ts`
- `modules/runtime-learning-engine/pattern-detector.ts`
- `modules/runtime-learning-engine/integrity-verifier.ts`
- `modules/runtime-learning-engine/tests/uncertainty-risk-hotfix.test.ts`
- `profiles/runtime-uncertainty-family.v1.json`

## 6. Assurance mapping — non-certification

The engineering discipline intentionally maps to, but does **not** claim certification/conformance with:

- NIST SP 800-218 SSDF — secure development lifecycle and evidence gates.
- ISO/IEC 27001/27002 — security governance/control framing.
- ISO/IEC 25010 — software quality characteristics.
- RFC 2119 / RFC 8174 — explicit normative requirement language.
- IEEE 1012 concepts — verification/validation separation and independence.
- W3C PROV-DM — provenance/entity/activity/agent modeling.
- SLSA / in-toto concepts — build provenance and attestable subjects.

A reference to a standard is not proof of compliance.

## 7. Promotion gates

```
CODE_PRESENT
  != BUILD_PASS
  != DEVICE_RUNTIME_PASS
  != STATISTICAL_VALIDATION
  != SECURITY_CERTIFICATION
  != CLAIM_ALLOWED
```

Current policy remains `claim_allowed=false`.

Next exact gate: build/test this branch, then run the new receipt on the authorized ARM32 Android 10 device and compare it with the 2026-09-26 physical evidence.


## 8. Physical verifier binding — Δ2

The on-device verifier now keeps **two views of the same read-only native state**:

1. `learningSnapshotForInstrumentation(...)` = raw native source observation.
2. `learningEvidenceSnapshotForInstrumentation(...)` = V1.1 evidence projection using the same `TOKEN_VAZIO` rules as the operator receipt.

The verifier stores both in its append-only receipt and fails closed on the V1.1 evidence bridge when zero-sample conditions are present but are projected as measured zero.

New required physical gate:

`zero_sample_token_vazio_semantics=PASS`

This does not train, inject observations, enable ACTIVE, or mutate the RFL store. The raw snapshot is retained separately so the normalization remains auditable rather than destructive.

# RAFAELIA Frida Android Lab — One-Screen Operator V1

## Goal

The normal Android path is one screen and does not require leaving the app to read runtime metrics.

`Activity/DEX -> JNI -> source-built ELF -> RFL/NEON4096`

Frida Gadget remains loaded at `127.0.0.1:27042` for instrumentation, but ADB, a desktop host, Frida REPL, and hand-written JavaScript are not prerequisites for the normal metric workflow.

## Basic workflow

1. Open the app.
2. Tap **Executar diagnóstico completo**.
3. Read the Device / ELF / RFL / NEON4096 metrics on the same screen.
4. Tap **Copiar métricas** when a portable receipt is needed.

## Optional on-device verification receipt

For a reproducible physical-device receipt from Termux, run from a clean repository checkout:

```sh
bash android/app/on-device-smoke.sh
```

This route is deliberately restricted to the local Gadget endpoint (`127.0.0.1`, `localhost`, or `::1`). It does not use ADB, USB, or a desktop host and it does not inject a training observation.

The v2 receipt is append-only and binds:

- repository commit when a Git worktree is available;
- tracked-tree clean/dirty state;
- SHA-256 of `on-device-smoke.sh`;
- Android SDK/release/ABI/model/fingerprint;
- local Gadget enumeration and Frida attach;
- Java availability and `MainActivity` resolution;
- the public raw read-only `learningSnapshotForInstrumentation(true)` bridge;
- the V1.1 read-only `learningEvidenceSnapshotForInstrumentation(true)` bridge;
- separation of raw native observation from the evidence projection;
- `zero_sample_token_vazio_semantics=PASS` whenever zero-sample denominators are present;
- NEON4096 4096-byte page match;
- SIMD fold self-test;
- automatic ACTIVE policy remaining disabled;
- GPU backend and validation persistence remaining explicitly unpromoted.

A missing commit binding, dirty tracked tree, missing Gadget/Frida bridge, failed runtime gate, missing snapshot invariant, or zero-sample evidence projected as measured zero makes the receipt `FAIL`. A physical receipt never changes `claim_allowed=false` by itself.

Current custody boundary: `source_commit` binds the verifier checkout, not the
installed application bytes by itself. The current v2 receipt does not yet bind
the installed APK, `librafaelia-probe.so`, and `libfrida-gadget.so` SHA-256
values to that same source commit. Until those byte identities are present in
one physical receipt, `APK_TO_SOURCE_EXACT_BIND=TOKEN_VAZIO`.

Default receipt directory:

`$HOME/.local/state/rafaelia/frida-lab/receipts/`

Each JSON receipt is created with exclusive-create semantics and receives a sibling `.sha256` file. Existing receipts are never overwritten.

## Optional real observation

A single text input accepts exactly six comma-separated values:

`contextHash, candidateId, eventType, costNs, memoryDelta, auxHash`

The UI never generates synthetic observations. Malformed input is rejected before JNI. Learning `OFF` and `FROZEN` reject recording. `VALIDATE_SHADOW` continues to validate against a frozen predictor instead of training it.

## Advanced controls

One checkbox reveals, on the same Activity:

- Learning mode selector;
- verbose diagnostics;
- RFL flush;
- volatile predictor reset.

Reset remains restricted to `OFF` / `FROZEN`. Automatic ACTIVE promotion remains disabled.

## Receipt V1.1 semantics

The operator receipt now separates `runtime_state`, `learning_state`, and `validation_state`. When observations/predictions are both zero, rates and percentiles that require samples are represented as `TOKEN_VAZIO / NO_SAMPLES`, not as measured zero. With no validation samples, the evidence projection uses `NO_MODEL` / `TOKEN_VAZIO` instead of interpreting `model frozen: NO` as proof of an existing mutable model.

The raw native snapshot remains available to the physical verifier. Normalization is a second, auditable view; it does not rewrite the source observation.

`filesystem_write_claim=TOKEN_VAZIO` remains explicit: zero committed learning records is not promoted into a process-wide claim of zero filesystem writes.

## Evidence boundaries

- `validation persistence = TOKEN_VAZIO` until implemented and physically verified;
- `ZIPRAF checkpoint + GC/compaction = TOKEN_VAZIO`;
- `GPU compute backend = TOKEN_VAZIO` until a measured physical backend exists;
- UI and on-device receipts keep `claim_allowed=false`.

The one-screen UI remains the normal operator path. `on-device-smoke.sh` is an evidence verifier, not a second UI or an autonomous control loop. Both reuse the existing JNI entry points and native RFL/NEON4096 implementation rather than adding a parallel runtime.


## Detailed / verbose observation boundary

The in-app **Mostrar diagnóstico detalhado** view is the operator-facing verbose
projection of the local JNI/RFL/NEON4096 state. It is not the same artifact as
the passive Frida Runtime Stability Dump V2.

For structural comparison across captures, use the repository-owned V2 sensor:

`agents/android-runtime-stability-dump.js`

Its contract is `rafaelia.android.runtime-stability/v2`, and its role is
`OBSERVATION_ONLY`. A receipt may name that contract while the capture itself
remains `TOKEN_VAZIO` until executed.

Android can recreate this Activity without recreating the native process. If a
repeat init returns `rc=-5 / ERR_STATE`, the UI now reuses the process-global
core only after a read-only detailed snapshot proves the existing runtime is
readable. This state is receipted as
`learning_init_disposition=REUSED_EXISTING_CORE`; it is not treated as a new
initialization and does not weaken the native fail-closed lifecycle.

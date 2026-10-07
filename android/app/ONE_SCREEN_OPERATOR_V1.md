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

### Exact-byte V3 custody mode

Legacy V2 remains available for runtime-only observation. The successor V4
build receipt now defines a **side-by-side physical target** rather than asking
the new debug build to replace the existing lab package.

For every CI run, the build creates one universal physical APK with:

- a run-scoped package such as `io.rafaelia.fridalab.physical.r<run-id>`;
- the same `io.rafaelia.fridalab.MainActivity` DEX class;
- the same ABI-specific source-built probe and pinned Frida Gadget bytes;
- an isolated Gadget endpoint at `127.0.0.1:27043`;
- its own app sandbox, so the existing `io.rafaelia.fridalab` RFL state is not
  replaced or cleared.

After the **exact V4 sidecar APK has been installed by an authorized human
action**, run from a clean checkout whose head or Git tree matches the V4
receipt:

```sh
RAFAELIA_FRIDA_EXPECTED_RECEIPT=dist/android17-lab/receipt.android17-apk-lab.v4.json \
  bash android/app/on-device-smoke.sh
```

No package name or port must be copied manually: V3 reads both from the V4
`physical_target` and fails if an environment override disagrees.

The V3 verifier hashes, from inside that Android process:

- the installed sidecar APK at `ApplicationInfo.sourceDir`;
- the installed `librafaelia-probe.so`;
- the installed `libfrida-gadget.so`;
- the package signing certificate.

It compares them with the exact ABI entry in V4 and proves source identity by
either exact source-head equality or exact Git-tree equality. A mismatch is
`FAIL`, never an inferred promotion.

**The verifier does not install, uninstall, clear, or replace the package.**
It does not invoke `adb install`, `pm install`, `pm uninstall`, or
`pm clear`. Installation is deliberately outside the evidence verifier.

Because the physical package ID is unique per build run, its ephemeral debug
signer does not need to replace the signer of the existing primary lab app.
The primary package and its RFL data remain untouched.

Only a physical V3 run in which all runtime and exact-byte gates pass may set
`APK_TO_SOURCE_EXACT_BIND=PASS` for that measured sidecar/device execution.
Until such a physical receipt exists,
`APK_TO_SOURCE_EXACT_BIND=TOKEN_VAZIO`.

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


## In-app proofs and tests — V1 candidate (branch-only until exact-head CI)

This optional UI workflow extends the existing one-screen Android Lab without
installing a new library, permission, agent, or background service.

1. Tap **Exibir comprovantes + testes** to capture the current read-only
   native RFL/NEON4096 snapshot, load statuses, and SHA-256 of the installed
   APK, librafaelia-probe.so, and libfrida-gadget.so.
2. Inspect T01 through T10 as separately typed
   PASS | FAIL | NOT_RUN | OBSERVED_UNPROMOTED | TOKEN_VAZIO.
3. Tap **Copiar comprovantes + testes** for a portable textual receipt.
4. Tap **Salvar comprovante privado** for an explicitly requested new file
   under the app's private files/receipts/ directory. Each save creates a
   new file and does not replace its predecessor.
5. Tap **Compartilhar comprovantes** to launch the Android share chooser.
   Sharing is never automatic.

The resulting RAFAELIA_FRIDA_INAPP_EVIDENCE_V1 includes the complete
RAFAELIA_FRIDA_LAB_RECEIPT_V1 underneath, the Android ABI/PID, a capture
epoch-millisecond timestamp, ten scoped tests, three SHA-256 capture outputs
and a digest of the preceding evidence text (bundle_sha256, hex lowercase).

**Boundary:** T08..T10 PASS establishes only that hashes were computed for
the installed files. It does not prove identity with an expected GitHub CI
artifact. Thus apk_to_ci_exact_byte_bind=TOKEN_VAZIO, signer binding
TOKEN_VAZIO, claim_allowed=false, and physical AArch64 (unless separately
tested) stay unpromoted. The independent V3 sidecar verifier remains the
authority for exact-byte comparison to the V4 CI manifest; this new
in-app surface must not bypass it.

These buttons do not call learningObserve, nativeLearningFlush,
nativeLearningResetVolatile, or nativeLearningSetMode; they do not create
training samples and do not authorize ACTIVE. The normal advanced controls
retain their existing, separately opted-in behavior. File hashing can take
perceptible time on older ARMv7 hardware and runs only on explicit action.

**New-feature gates:** source review; Android javac -> D8 -> APK packaging,
signature and ABI inventories at the exact commit; independent APK install and
in-app UI/clipboard/private-file/share smoke. Until each is observed, its state
is IMPLEMENTED_UNTESTED or TOKEN_VAZIO, not PASS.

**Rollback:** revert the isolated feature commit(s); previous diagnosis,
snapshot, clipboard, activity lifecycle, and the sidecar exact-byte verifier
are not removed or replaced.

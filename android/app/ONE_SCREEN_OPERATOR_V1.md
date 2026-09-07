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
- the public read-only `learningSnapshotForInstrumentation(true)` bridge;
- NEON4096 4096-byte page match;
- SIMD fold self-test;
- automatic ACTIVE policy remaining disabled;
- GPU backend and validation persistence remaining explicitly unpromoted.

A missing commit binding, dirty tracked tree, missing Gadget/Frida bridge, failed runtime gate, or missing snapshot invariant makes the receipt `FAIL`. A physical receipt never changes `claim_allowed=false` by itself.

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

## Evidence boundaries

- `validation persistence = TOKEN_VAZIO` until implemented and physically verified;
- `ZIPRAF checkpoint + GC/compaction = TOKEN_VAZIO`;
- `GPU compute backend = TOKEN_VAZIO` until a measured physical backend exists;
- UI and on-device receipts keep `claim_allowed=false`.

The one-screen UI remains the normal operator path. `on-device-smoke.sh` is an evidence verifier, not a second UI or an autonomous control loop. Both reuse the existing JNI entry points and native RFL/NEON4096 implementation rather than adding a parallel runtime.

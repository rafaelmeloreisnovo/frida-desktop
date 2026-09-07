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
- UI receipts keep `claim_allowed=false`.

The change is intentionally presentation/control-plane only. It reuses the existing JNI entry points and native RFL/NEON4096 implementation rather than adding a parallel runtime.

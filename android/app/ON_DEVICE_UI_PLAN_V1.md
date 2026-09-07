# RAFAELIA Frida Android Lab — One-Screen Operator Contract V1

Objective: keep the Android Lab operational path on one screen, with DEX -> JNI -> ELF as the primary control path and Frida Gadget as an instrumentation endpoint rather than a mandatory manual hop.

## UX invariants

- One Activity / one scroll surface.
- Default is safe: Learning OFF, ACTIVE promotion disabled.
- Metrics are readable without Termux, ADB, Frida REPL or JavaScript snippets.
- One primary action refreshes the entire runtime status.
- Optional real-observation input is explicit and never auto-populated with synthetic training data.
- Advanced controls stay in the same screen and remain understandable.
- Every risky/destructive transition is absent or guarded; volatile reset remains restricted to OFF/FROZEN.
- TOKEN_VAZIO remains visible for unsupported/unmeasured capabilities.

## Primary flow

1. App starts and loads source-built ELF + Gadget.
2. JNI initializes RFL/NEON4096.
3. Main screen shows Device / Frida / RFL / NEON / Validation metrics.
4. `Executar diagnóstico completo` refreshes all local metrics and flushes only when the current learning mode is not OFF.
5. `Copiar métricas` copies the current diagnostic snapshot.
6. Optional `Observação real` input calls the existing JNI `learningObserve()` only when the user deliberately supplies the fields and the learning mode accepts observations.

## Architectural boundary

UI (Java/DEX) -> JNI bridge -> source-built native ELF -> RFL / NEON4096

Frida Gadget remains loaded and reachable at 127.0.0.1:27042 for instrumentation, but normal metric collection does not require leaving the app.

No Kotlin migration is required for V1 because the existing Java Activity is already the thinnest path to the current JNI/ELF implementation.

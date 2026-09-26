# Frida Lab Assurance Matrix V1

This is an engineering crosswalk, **not a certification statement**.

| Concern | Repository control/evidence | External frame | Current state |
|---|---|---|---|
| Provenance | Git SHA, receipt hashes, source/evidence separation | W3C PROV-DM; SLSA/in-toto concepts | PARTIAL |
| Secure development | fail-closed gates, observation-only heuristics, conservative risk ratchet | NIST SP 800-218 SSDF | IMPLEMENTED_SCOPED |
| Security governance | claim gate, least-promotion, data minimization | ISO/IEC 27001/27002 concepts | PARTIAL |
| Software quality | explicit runtime/build/test/validation states | ISO/IEC 25010 concepts | PARTIAL |
| Normative language | PASS/FAIL/NOT_RUN/TOKEN_VAZIO and MUST-like boundaries documented explicitly | RFC 2119 / RFC 8174 | IMPLEMENTED_SCOPED |
| Verification vs validation | build/runtime/statistical validation are separate gates | IEEE 1012 concepts | IMPLEMENTED_SCOPED |
| Physical evidence | Android 10 ARMv7 receipt + bugreport hash; raw bugreport withheld | project custody policy | PASS_SCOPED |
| Learning efficacy | zero observations/predictions | statistical evidence | NOT_RUN |
| Automatic mutation | ACTIVE policy | safety boundary | DISABLED |
| GPU promotion | requires measured backend + total-cost evidence | performance gate | TOKEN_VAZIO |

## Audit rules

1. Unknown is never converted to zero.
2. Zero samples cannot produce a measured zero error rate or measured latency percentile.
3. A green local diagnostic does not promote learning efficacy.
4. A loaded library does not prove all exported functions or all code paths.
5. A source-built probe and a Gadget load are runtime evidence for those bounded events only.
6. Raw Android bugreports are not committed by default because they can contain unrelated identifiers and application/process state.
7. Any future correction appends or supersedes; historical evidence is not silently rewritten.

## Current Delta

The 2026-09-26 delta preserves the native runtime behavior and tightens receipt semantics in the Java presentation/audit layer. Exact-head CI and a new physical-device run are required before the code delta is promoted from IMPLEMENTED_UNTESTED.


## Δ2 — verifier non-regression control

The physical verifier now requires the read-only V1.1 evidence bridge and records the raw snapshot separately from the normalized evidence snapshot. For a zero-denominator state, `zero_sample_token_vazio_semantics` must PASS. This strengthens traceability without converting a hosted/static gate into physical-device evidence.

`STATIC_CONTRACT_PASS != PHYSICAL_DEVICE_PASS`.

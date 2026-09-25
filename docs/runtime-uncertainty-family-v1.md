# Runtime Uncertainty Family V1

This contract reconciles runtime-learning, HyperMemory, stability, integrity and physical-device uncertainty without turning absence into zero risk.

## Invariants

- `SOURCE != ARTIFACT != EXECUTION != EVIDENCE != CLAIM`.
- `TOKEN_VAZIO != 0 != FAIL != PASS`.
- `heuristic signal != diagnosis != mutation authority`.
- `fast routing hash != evidence integrity hash`.
- `hosted PASS != physical-device PASS`.
- `drift != instability`; `association != causality`.

## Two-cycle falsification

### Cycle alpha — internal

1. Feed synthetic heuristic signals into the pattern detector.
2. Require the resulting pattern to remain `OBSERVATION_ONLY`.
3. Require `shouldApplyFix()` to return false.
4. Feed low-success/high-rollback summaries into the optimizer.
5. Require automatic threshold movement to be conservative only.
6. Verify monitored integrity hashes are SHA-256, while FNV-1a remains available only for fast routing/identification uses.

### Cycle omega — cross-source

1. Bind exact Git head and exact CI run.
2. Reconcile the producer state with Mapa's risk vector and gap atlas.
3. Record Drive receipt as memory/routing evidence, not producer execution authority.
4. Preserve physical Android restart/reattach/restore and upstream reconciliation as independent gates.
5. If any source disagrees, append a successor/contradiction edge; do not overwrite the historical record.

## Dictionary delta

- `OBSERVATION_ONLY`: observed signal that may be stored, clustered and tested but cannot by itself authorize mutation.
- `AUTO_FIX_ELIGIBLE`: event/pattern explicitly allowed to reach the automatic mutation gate; confidence and occurrence gates still apply.
- `UNCERTAINTY_RATCHET`: worsening outcome evidence may tighten automatic actuation; it may not automatically loosen it.
- `FAST_HASH`: non-cryptographic hash used for routing, bucketing or compact identifiers.
- `EVIDENCE_HASH`: cryptographic digest used to bind evidence bytes; this hotfix uses SHA-256 in IntegrityVerifier.
- `PHYSICAL_TOKEN_VAZIO`: implementation/hosted evidence exists, but the corresponding physical-device event has not been observed.

## Residual risks

Physical SharedMemory FD handoff, process restart survival, Frida reattach, state restore, LMKD/SELinux causal attribution, crash root cause and staged current-upstream reconciliation remain separate evidence gates.

No hosted test may close those physical or causal gaps.

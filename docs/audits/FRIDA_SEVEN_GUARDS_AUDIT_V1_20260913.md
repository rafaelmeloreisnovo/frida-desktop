# Frida — Seven-Guard Audit Receipt V1

Date: 2026-09-13  
Repository: `rafaelmeloreisnovo/frida-desktop`  
Observed HEAD: `6aee1cf64c646dc1862bc331328ddaf1ddf3d74e`  
State: `AUDITED_BLOCKED`  
Claim boundary: `SOURCE != ARTEFATO != EXECUTION != EVIDENCE != CLAIM`  
`claim_allowed=false`

## 1. Provenance

Observed upstream/fork chain:

`frida/frida -> wojcikiewicz17/frida -> rafaelmeloreisnovo/frida-desktop`

Controls already present:
- `THIRD_PARTY_PROVENANCE.md`;
- `docs/rafaelia-provenance-gate.md`;
- `docs/rafaelia-provenance-non-regression.md`;
- machine-readable scope in `profiles/rafaelia-provenance-scope.v1.json`;
- pinned parent baseline `281ad2176c165e4fd3cf4c64befbabe5d7302a66`;
- pinned `COPYING` blob `b01d49c670e55dbff638eb294ac1a52416fb32e8`.

Provider evidence:
- provenance workflow run `34436588017`: **success** on observed HEAD.

Boundary:
- fork delta is not authorship proof;
- unresolved hunk origin remains `TOKEN_VAZIO_REQUIRES_ORIGIN_REVIEW`.

## 2. Context

Two execution planes must remain separate:

1. upstream Frida release graph: `.github/workflows/ci.yml`;
2. RAFAELIA bounded control graph: `.github/workflows/01.yml` plus `.github/scripts/rafaelia/`.

Hosted CI is not physical Android execution.

The Runtime Learning gate on the observed HEAD reports:
- `device_target=HOSTED_NO_PHYSICAL_DEVICE_SENTINEL`;
- `physical_device=TOKEN_VAZIO`.

## 3. Evidence

RAFAELIA orchestrator run: `34480119443`.

PASS:
- workflow topology contract;
- ATLAS mission boundary;
- provenance fail-closed;
- ARM32 strict freestanding;
- ARM32 physical-adapter structural gate;
- hash bit-exact backend;
- hash streaming + NEON;
- hash math freestanding;
- RFL + NEON4096 selftest;
- runtime hardening.

FAIL:
- `01.11 runtime learning integration`;
- final pipeline verdict.

SKIPPED due dependency:
- Android crash observability;
- Android17 APK + ELF + DEX.

Runtime Learning exact result:
- test suites: **14 PASS / 2 FAIL / 16 total**;
- tests: **253 PASS / 3 FAIL / 256 total**;
- runtime surface fingerprint:
  `21e19db82274e215207577344935580d6050bbc340b45fc4712524b990c1fbe3`;
- artifact: `01-runtime-learning-34480119443`;
- artifact id: `10153839431`;
- artifact SHA-256:
  `d760424200e06051f756f7ab7a06ade8b4299218f68ba24a40581abfd253d6b7`.

Observed failing assertions:
1. watchdog FAILSAFE passive-mode expectation: expected boolean `true`, received a phase-result object;
2. event capacity: expected `<= 10`, received `15`;
3. storage cleanup: expected `<= 5`, received `20`.

The same run emitted rollback-verification checksum mismatch messages:

`expected 0x34f63537929614dd / got 0x3f782951219d18fa`

Those messages are evidence of an observed path, but are not yet classified as either an expected negative-path fixture or a functional rollback defect.

## 4. Contradiction

Current evidence prevents these collapses:

- historical documentation claiming hardening/readiness/rollback guarantees != current integrated gate PASS;
- `ARM32 physical adapter gate PASS` != physical ARM32 execution PASS;
- hosted test evidence != physical-device evidence;
- fork-relative delta != project authorship;
- upstream CI environment failure != Frida source regression.

The upstream CI run `34436588089` scheduled toolchain jobs but failed at `Set up environment` with:

`Credentials could not be loaded, please check your action inputs: Could not load credentials from any providers`

That failure is classified as environment/authentication evidence until a source-level causal link is demonstrated.

## 5. Uncertainty

Open states:
- `lock=TOKEN_VAZIO_NO_REPOSITORY_LOCKFILE` for Runtime Learning dependency observation;
- `physical_device=TOKEN_VAZIO`;
- `rollback_checksum_classification=TOKEN_VAZIO_EXPECTED_NEGATIVE_FIXTURE_OR_DEFECT`;
- complete hunk-by-hunk origin classification remains open;
- complete dependency/submodule license reconciliation remains open;
- upstream CI credentials/provider authority remains external/open.

No open state is promoted to zero or PASS.

## 6. Reproduction

Canonical repository-local routes:

```bash
python3 .github/scripts/rafaelia/workflow-contract.py
bash .github/scripts/rafaelia/provenance-ci.sh all
bash .github/scripts/rafaelia/runtime-learning-engine-ci.sh
```

Reproduction must bind:
- exact Git SHA;
- runtime surface fingerprint;
- produced evidence paths/artifact hashes;
- test totals and failing assertions.

A different HEAD requires a new receipt.

## 7. Rollback

### Source-control rollback
Any corrective patch should be isolated in a dedicated branch/PR and remain revertible without history rewrite. Previous evidence receipts remain preserved.

### Runtime rollback
Runtime rollback is **not promoted as proven globally** while:
- the integrated Runtime Learning gate remains red;
- rollback checksum mismatch classification is open;
- physical-device execution remains `TOKEN_VAZIO`.

### Audit rollback
This receipt is additive. Supersession should create a later receipt referencing this file; do not erase the historical observation.

## F_gap

`RUNTIME_LEARNING_3_TEST_FAILURES + ROLLBACK_CHECKSUM_CLASSIFICATION + NO_REPOSITORY_LOCKFILE + PHYSICAL_DEVICE_TOKEN_VAZIO + UPSTREAM_CI_CREDENTIALS`

## F_next

Single bounded next action:

> Isolate and correct only the three current Runtime Learning failures on the same source surface, classify the rollback checksum mismatch, rerun `runtime-learning-engine-ci.sh`, and only then rerun workflow `01`.

Do not promote ACTIVE, physical performance, global rollback guarantee, or expanded authorship before the corresponding gates.

---

`μID=FRIDA-SEVEN-GUARDS-AUDIT-V1-20260913 | source/ref=GitHub:rafaelmeloreisnovo/frida-desktop@6aee1cf64c646dc1862bc331328ddaf1ddf3d74e + run:34480119443 | kind=SEVEN_GUARDS_AUDIT | Δsummary=provenance gate PASS; integrated Runtime Learning blocked at 3/256 tests; rollback checksum classification open; physical device remains TOKEN_VAZIO | routes=P/C/R/I/E/A | evidence=run:34436588017 PASS + run:34480119443 FAIL + artifact:10153839431@d7604242... | gap=RUNTIME_LEARNING+ROLLBACK_CLASSIFICATION+LOCKFILE+PHYSICAL_DEVICE+UPSTREAM_CREDENTIALS | next=isolate 3 failures -> classify checksum -> rerun bounded gate -> rerun 01 | rollback=branch/PR revert or superseding receipt; no history rewrite | claim_allowed=false`

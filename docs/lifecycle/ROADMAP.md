# Frida Lifecycle Roadmap

Status: **implementation in controlled stages**. A stage closes only after its own exact-head checks and receipts are observed.

## Stage 0 — Inventory and contract

**Goal:** establish one source of truth for lifecycle semantics without altering production publication.

Deliverables:
- machine contract `frida_lifecycle.v1.json`;
- `00-intake`, `01-integration`, `02-beta` lanes;
- lifecycle governance + promotion workflows;
- navigable artifact receipt (JSON/MD/HTML/SHA256);
- release-note configuration, issue forms, PR template;
- ADR/RFC/document taxonomy.

Exit: lifecycle workflow passes on the foundation PR and the existing workflow architecture contract remains PASS. Provider branch protection may still be `TOKEN_VAZIO`.

## Stage 1 — Intake/test lane

**Goal:** make `00-intake` the only normal entry for new/internal/external code.

Controls:
- PR-based intake;
- provenance and source/license classification;
- lifecycle topology gate;
- targeted subsystem tests;
- artifact receipt with exact SHA/run identity;
- no release authority.

Exit: repeated clean runs on `00-intake`; branch-protection desired state reviewed and ready for provider application.

## Stage 2 — Integration/alpha lane

**Goal:** make `01-integration` accept promotion only from `00-intake`.

Controls:
- promotion SHA lock;
- compatibility/integration/canary evidence;
- dashboard/read-only lifecycle view;
- regression and dependency-boundary checks;
- alpha artifacts, not production tags.

Exit: successful ordered promotion with no bypass/backflow and rollback plan generated for the promoted SHA.

## Stage 3 — Beta/RC lane

**Goal:** make `02-beta` the stabilization and release-candidate boundary.

Controls:
- promotion only from `01-integration`;
- aggregated technical receipts;
- release-readiness mode with SemVer pre-release syntax;
- release notes, known limitations, compatibility matrix and unresolved `TOKEN_VAZIO` ledger;
- no production publication.

Exit: beta evidence package is reproducible and all release blockers are explicit.

## Stage 4 — Stable promotion

**Goal:** permit `02-beta → main` only through a reviewed PR after provider-side protection is evidenced.

Controls:
- exact-head lifecycle/provenance/topology checks;
- stable SemVer plan;
- upstream release graph isolated from lifecycle pre-release channels;
- release authority separately evidenced;
- rollback target and post-merge readback prepared.

Exit: stable merge + post-merge receipts. A Git tag/release remains a separate authorized action.

## Stage 5 — Operations and maintenance

**Goal:** keep the system operable over its full software life cycle.

Continuous work:
- dependency and toolchain refresh;
- compatibility matrix maintenance;
- security/vulnerability response;
- artifact retention/archival;
- deprecation and EOL decisions;
- ADR/RFC/runbook evolution;
- incident/postmortem and rollback drills;
- dashboard usability and accessibility improvements;
- periodic topology/provenance audits.

## Stage gates

A stage cannot advance because of elapsed time, branch name, optimistic interpretation or artifact existence alone. Advancement requires observed evidence for the stated scope. `TOKEN_VAZIO != PASS`.

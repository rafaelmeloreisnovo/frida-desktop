# Branching and Promotion

## Canonical chain

`feature/external → 00-intake → 01-integration → 02-beta → main`

The numbered names are intentional: lexical order equals maturity order and makes navigation obvious in GitHub, scripts and receipts.

## Lane contracts

### `00-intake` — test

Entry boundary for new code. Internal feature/fix/docs/chore/hotfix branches and external fork PRs land here first. The lane may discover defects; it does not promise integration readiness.

### `01-integration` — alpha

Accepts only `00-intake`. It is the first cross-subsystem convergence point and the appropriate place for integration, compatibility and canary evidence.

### `02-beta` — beta / RC

Accepts only `01-integration`. It freezes unnecessary churn, aggregates evidence, prepares release notes and exposes limitations before stable promotion.

### `main` — stable

Accepts lifecycle promotion only from `02-beta`. The repository already contains a large upstream release graph, so stable merge and production publication remain separate decisions.

## Promotion automation

`Frida Lifecycle Promotion` is deliberately bounded:

1. operator supplies `from_lane`, `to_lane` and the exact 40-hex source SHA;
2. the script rejects an invalid transition;
3. it fetches the source and target refs and rejects SHA drift;
4. it reuses an existing promotion PR or opens a new one;
5. it **never auto-merges** and never pushes code to the target.

This gives automation without turning CI into release authority.

## Desired server-side protection

After gate proof, all four lifecycle branches should require pull requests, required status checks, stale-approval dismissal, resolved conversations, blocked force-push and blocked deletion. Administrative enforcement should be enabled when provider/account policy permits.

Current application state is `TOKEN_VAZIO_PROVIDER_ADMIN` until an authoritative GitHub provider write/readback is available. A green workflow is not branch protection.

## Required common evidence

Each promotion must have, for the exact candidate head:

- lifecycle-governance receipt;
- workflow architecture contract receipt;
- RAFAELIA provenance receipt;
- every subsystem-specific gate triggered by the delta;
- no failed/cancelled/missing required check;
- no unresolved gate that the target lane declares mandatory.

## Backflow and hotfixes

Normal backflow (`main → beta`, `beta → integration`, etc.) is forbidden. A defect found in a mature lane becomes a new fix branch and re-enters through `00-intake`, preserving one audit path.

An emergency rollback does not justify history rewriting. Prefer a revert PR with an explicit target SHA and receipt. Force-push and branch deletion stay forbidden in the desired protection state.

## Merge strategy

The lifecycle does not force a universal Git merge style at source level. For promotion PRs, preserve traceability: the resulting commit must retain a GitHub PR reference and be reproducible from the candidate head. Any future squash/rebase policy belongs in an ADR because it changes lineage semantics.

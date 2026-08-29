# RAFAELIA provenance non-regression contract

## Purpose

This repository is an upstream-derived Frida fork with a substantial fork-relative delta. This contract prevents three different facts from being collapsed into one:

1. **Upstream presence** — code or notices inherited from Frida or another ancestor/dependency.
2. **Fork delta** — a path or hunk changed relative to the pinned parent-fork baseline.
3. **Authorship/origin** — who or what produced a changed hunk and which license/notice governs it.

A fork delta is evidence of change. It is **not**, by itself, evidence of exclusive authorship.

## Pinned baseline

- Parent fork: `wojcikiewicz17/frida`
- Baseline commit: `281ad2176c165e4fd3cf4c64befbabe5d7302a66`
- Upstream licensing anchor: `COPYING`
- Pinned `COPYING` Git blob: `b01d49c670e55dbff638eb294ac1a52416fb32e8`

The validator requires the baseline to remain an ancestor of the current `HEAD` and rejects drift in the pinned `COPYING` blob.

## Machine-enforced invariants

`tools/validate-rafaelia-provenance.py` enforces the following:

- `claim_allowed` remains `false` while hunk origin is unresolved;
- the manifest cannot claim ownership merely because a path is part of the fork delta;
- the pinned upstream license file must exist and match its exact Git blob;
- the pinned baseline commit must exist and be an ancestor of `HEAD`;
- every path changed between the baseline and `HEAD` is inventoried deterministically;
- candidate paths named in the provenance manifest must both exist and belong to that baseline-relative delta;
- third-party licensing may not be flattened into a single repository-wide ownership assertion;
- rollback remains an explicit invariant.

The generated path inventory is written to:

`evidence/provenance/delta-inventory.v1.json`

The evidence file is generated during CI and is intentionally ignored by Git. CI uploads it as a run artifact instead of allowing a self-referential generated file to mutate the repository delta it is measuring.

## Path-level classification

The generated evidence classifies path relationships conservatively:

- `FORK_DELTA_PATH_ADDED`
- `MIXED_PATH_MODIFIED_REQUIRES_HUNK_REVIEW`
- `UPSTREAM_PATH_REMOVED_IN_FORK`
- `FORK_DELTA_RENAMED_OR_COPIED_REQUIRES_HUNK_REVIEW`
- `MIXED_PATH_TYPE_CHANGED_REQUIRES_HUNK_REVIEW`
- `UNMERGED_PATH_REQUIRES_RESOLUTION`
- `TOKEN_VAZIO_UNKNOWN_GIT_STATUS`

Every entry carries:

- `authorship_claimed: false`
- `hunk_origin_state: TOKEN_VAZIO_REQUIRES_ORIGIN_REVIEW`

until a separate origin review supports stronger classification.

## Hunk-origin closure classes

Where an authorship or licensing claim is intended, changed hunks must eventually be classified as one of:

- `upstream`
- `project-authored`
- `AI-assisted-or-generated`
- `third-party`
- `mixed`
- `unknown`

`unknown` is a valid fail-closed state and must remain `TOKEN_VAZIO` rather than being guessed.

## Negative falsifiers

The CI gate must reject at least these regressions:

1. premature repository or authorial ownership promotion;
2. upstream `COPYING` blob drift;
3. an invalid or non-ancestral baseline;
4. premature hunk-origin promotion from `TOKEN_VAZIO` to `PASS`.

The gate then re-runs the canonical manifest to prove that the negative fixtures did not mutate repository state.

## Remaining open gates

The following are deliberately not promoted by this contract:

- full hunk-by-hunk origin classification;
- full dependency/submodule license reconciliation;
- current physical-device execution evidence for new runtime deltas;
- security claims derived merely from instrumentation source presence.

These remain evidence-driven closure tasks, not assumptions.

## Non-regression rule

No later change may weaken a proven invariant merely to obtain a passing CI run. If evidence is missing, preserve the stronger boundary and record `TOKEN_VAZIO` with the next falsifiable closure step.

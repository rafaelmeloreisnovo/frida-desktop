# RAFAELIA provenance gate

This repository contains upstream Frida material and additional project-specific experiments/integrations. This document does **not** relicense upstream code and does **not** declare candidate paths to be authorial merely because they differ in this fork.

Canonical machine-readable state:

`profiles/rafaelia-provenance-scope.v1.json`

## Authority

- `COPYING` remains the observed upstream licensing anchor for its scope.
- submodules/dependencies retain their own governing terms;
- a path is not promoted to an authorial delta until an upstream baseline and path/hunk-level diff establish origin;
- a source file or README entry is not runtime/security evidence.

## Fail-closed sequence

```text
exact fork commit
  -> upstream identity/baseline
  -> path/hunk diff
  -> origin classification
  -> upstream/third-party license preservation
  -> authorial delta boundary
  -> named functional/security/runtime gate if a claim is requested
  -> evidence receipt
```

Until the upstream baseline and delta classification are complete, the state remains:

`TOKEN_VAZIO_NEEDS_UPSTREAM_DIFF`

## Candidate paths

The manifest lists paths surfaced by the current README as candidates for reconciliation (freestanding profile, ChipQuantum diagnostics, debugger autotuning and runtime stability recorder). “Candidate” is intentionally weaker than “authorial”.

## Risk mitigation

The gate rejects:

- `claim_allowed=true`;
- removal/non-preservation of the upstream license anchor;
- authorial ownership claims while delta provenance is open;
- flattening all dependency/submodule licenses into one project license;
- disappearance of a candidate path without updating the manifest.

The CI also performs a negative test by attempting premature authorship promotion and requires rejection.

This gate is evidence organization, not a legal opinion, security certification, Frida upstream endorsement, or physical-runtime proof.

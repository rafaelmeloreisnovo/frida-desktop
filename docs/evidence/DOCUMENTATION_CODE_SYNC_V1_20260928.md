# RAFAELIA Frida — Documentation ↔ Code Sync Receipt V1

**Date:** 2026-09-28  
**Producer:** `rafaelmeloreisnovo/frida-desktop`  
**Source base:** `main@a941926b7e8ee3eb67d14dde3e1e9215e1b2bef4`  
**Refactor branch:** `docs/sync-current-code-v2-20260928`  
**Pre-receipt documentation head:** `82378a6b01b2be65bc88dc0055453fbf7d93cdb0`  
**Kind:** `DOCUMENTATION_REFACTOR / SOURCE_ALIGNMENT`  
**Claim gate:** `claim_allowed=false`

## Intent

Bring the repository's human-facing documentation back into alignment with the
current implementation without changing runtime behavior and without rewriting
historical snapshots as if they had always described the current source.

## Source authority

The refactor used the exact current `main` source as implementation authority.

Current `main` is PR #74 merge
`a941926b7e8ee3eb67d14dde3e1e9215e1b2bef4`.

PR #74 exact head
`1660af1ea1943f24d5b0c1e2084725c4af9b2a0a` has observed PASS for:

- OMEGA Integrator run `36286029935`;
- Provenance Non-Regression run `36286029690`;
- Workflow Architecture Contract run `36286029718`;
- Android 17 APK + ELF/DEX Lab run `36286029667`.

Hosted CI evidence is scoped to that exact producer head.

## Stale documentation findings

The audit found concrete documentary drift:

1. `IMPLEMENTATION_SUMMARY.md` still described the 2026-08-22 Phase-1 state,
   including an Android JNI bridge as a stub and “ready for Phase 2”.
2. `android/app/LEARNING_ARCHITECTURE_V1.md` still said implementation
   pending and omitted the implemented `VALIDATE_SHADOW` logical mode.
3. `android/BUILD_GUIDE.md` mixed hosted Gradle assumptions with the separate
   Android-17 APK/ELF/DEX evidence lab and contained obsolete environment
   wording.
4. `docs/GUI_ARCHITECTURE.md` presented the old Phase-1/2/3 roadmap as a
   current status surface.
5. the 2026-08-24 implementation-correction map lacked a prominent historical
   lifecycle marker.
6. `README.md` did not route a reader to the current RAFAELIA fork state.
7. `ONE_SCREEN_OPERATOR_V1.md` documented source commit binding but did not
   make the remaining installed-byte custody gap prominent.

## Refactor delta

Updated documentation now records:

- current main/PR #74 authority;
- JNI/RFL native runtime as implemented rather than stubbed;
- logical modes
  `OFF | OBSERVE | LEARN_SHADOW | PREDICT_SHADOW | VALIDATE_SHADOW | FROZEN`;
- RFL fixed ABI/store semantics;
- NEON4096/3 current geometry and evidence boundary;
- receipt schema 1.1 / raw-vs-evidence snapshot distinction;
- Activity re-entry semantics via `learning_init_disposition`;
- Detailed Runtime Dump V2 as `OBSERVATION_ONLY`;
- hosted Gradle and standalone Android-17 build paths as separate contracts;
- manifest-vs-Gradle SDK drift as an explicit open gap;
- historical GUI/correction documents as historical rather than current;
- installed APK/probe/Gadget SHA-to-source binding as `TOKEN_VAZIO`.

## Non-delta

No runtime, Java, C, assembly, Gradle, workflow, schema, test, or application
behavior is intentionally changed by this documentation refactor.

## Evidence boundary

```text
documentation_matches_observed_source = SOURCE_REVIEWED
documentation_branch_ci              = PENDING_AT_RECEIPT_CREATION
physical_device_rerun                = NOT_RUN_BY_THIS_REFACTOR
installed_apk_source_binding         = TOKEN_VAZIO
probe_elf_source_binding             = TOKEN_VAZIO
gadget_elf_source_binding            = TOKEN_VAZIO
claim_allowed                        = false
```

## Rollback

Close the documentation PR or revert the documentation commits. The producer
runtime on `main@a941926...` is unchanged by this branch.

## R3

```text
F_ok:
  stale status language identified and corrected against exact current source;
  historical documents retained as history instead of silently rewritten;
  source/CI/physical/claim boundaries made explicit.

F_gap:
  documentation-branch exact-head CI is still pending at receipt creation;
  physical byte-exact APK/probe/Gadget -> source custody remains open.

F_next:
  run/review exact-head CI for this documentation branch;
  merge only through human/provider-authorized repository flow;
  separately extend the physical on-device receipt with installed artifact hashes.
```

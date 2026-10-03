# Frida Lab — Documentation Navigation Receipt V1

**Receipt ID:** \`DOCUMENTATION_NAVIGATION_RECEIPT_V1_20261003\`  
**Date:** 2026-10-03  
**Producer:** \`rafaelmeloreisnovo/frida-desktop\`  
**Source base:** \`main@a4205b0166c7c222912e8fbd85d7d0173ee4e358\`  
**Documentation branch:** \`docs/frictionless-navigation-v1-20261003\`  
**Documentation head before this receipt:** \`f4195d41944d119e83f11b74b981eee19320fbed\`  
**Kind:** \`DOCUMENTATION_ONLY / HUMAN_AI_NAVIGATION\`  
**Claim gate:** \`claim_allowed=false\`

## Intent

Reduce navigation friction for humans and AI agents reconstructing the Frida Lab
from a bounded source set. Provide one canonical entrypoint, one machine-readable
index and direct routes to current state, gates, provenance, evidence and
federation.

## Materialized delta

Added:

- \`docs/START_HERE.md\`
- \`docs/frida-navigation-index.v1.json\`
- this receipt

Updated:

- \`README.md\`
- \`IMPLEMENTATION_SUMMARY.md\`

The README and current implementation summary now point to the same navigation
entrypoint. The JSON index mirrors the route, gate and receipt identifiers for
machine navigation.

## Scope boundary

No runtime, Java, C, assembly, JNI, Gradle, workflow, test, schema, Android
manifest or generated artifact was changed by this delta.

Historical documents and previous receipts remain intact. No history rewrite,
deletion or claim promotion was performed.

## Navigation contract

The route enforces:

\`\`\`text
INTENT -> CURRENT_STATE -> μREAD -> SOURCE_MIN -> AUTHORITY
       -> ACT -> EVIDENCE -> μWRITE -> CLAIM
\`\`\`

Initial expansion is limited to the selected intent and may widen only for
\`missing_source\`, \`contradiction\`, \`unresolved_authority\`,
\`missing_evidence\` or an explicit request.

## Verification state

| Check | State | Evidence |
|---|---|---|
| canonical human entrypoint exists | PASS | \`docs/START_HERE.md\` |
| machine index is UTF-8 JSON | PASS | \`docs/frida-navigation-index.v1.json\` |
| README route added | PASS | \`README.md\` |
| current summary route added | PASS | \`IMPLEMENTATION_SUMMARY.md\` |
| runtime scope unchanged by path selection | PASS_SCOPED | changed paths are documentation only |
| exact-head CI for this branch | NOT_RUN | documentation-only branch at receipt creation |
| physical-device execution | TOKEN_VAZIO | outside this documentation delta |
| installed APK/probe/Gadget byte binding | TOKEN_VAZIO | existing custody gap remains open |
| claim promotion | BLOCKED | \`claim_allowed=false\` |

## Open gates preserved

- exact APK/probe/Gadget byte-to-source binding;
- physical restart, reattach and state restoration;
- validation persistence;
- GPU backend and total-cost evidence;
- causal runtime claims;
- any other gap recorded by the current implementation summary.

The route labels these as priorities for uncertainty reduction; it does not close
or reinterpret them.

## Rollback

Close the draft pull request or revert the documentation commits on the branch.
The producer runtime on \`main@a4205b0...\` remains unchanged. Preserve this
receipt and create a superseding receipt for any correction.

## R3

\`\`\`text
F_ok:
  human and AI entrypoint, machine index, intent routes and gate priorities
  materialized; README and current summary point to the route; runtime untouched.

F_gap:
  documentation-branch exact-head CI and all physical custody gates remain open;
  claim_allowed=false is preserved.

F_next:
  verify route targets and applicable CI on the exact branch head, then review
  or merge only through the authorized GitHub flow; do not promote runtime claims.
\`\`\`

\`SOURCE != ARTIFACT != EXECUTION != EVIDENCE != CLAIM\`

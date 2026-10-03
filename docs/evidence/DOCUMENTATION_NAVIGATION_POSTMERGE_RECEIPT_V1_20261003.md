# Frida Lab — Documentation Navigation Post-Merge Receipt V1

**Receipt ID:** \`DOCUMENTATION_NAVIGATION_POSTMERGE_RECEIPT_V1_20261003\`  
**Parent receipt:** \`docs/evidence/DOCUMENTATION_NAVIGATION_RECEIPT_V1_20261003.md\`  
**Date:** 2026-10-03  
**Producer:** \`rafaelmeloreisnovo/frida-desktop\`  
**Published source:** \`main@099e346bdccc3fb36b3ba5234f22d3ce43b2f543\`  
**Published by:** PR \`#76\`  
**Correction branch:** \`docs/navigation-postmerge-custody-v1-20261003\`  
**Head before this receipt:** \`018033a7c6ead5f8a4097eb71462455cdcb323cf\`  
**Kind:** \`POST_MERGE_PROVENANCE / DOCUMENTATION_ONLY\`  
**Claim gate:** \`claim_allowed=false\`

## Observed delta

PR #76 was merged into \`main\`. The original navigation receipt remains
unchanged and continues to describe the pre-merge documentation branch.

This successor record closes the post-merge identity gap by recording:

- the published \`main\` commit;
- the historical documentation branch;
- the route and index blob identities after the correction;
- the successor receipt in the navigation chain.

## Bound objects

| Object | Route | Identity |
|---|---|---|
| published route | \`main@099e346...\` | PR #76 merge |
| human route | \`docs/START_HERE.md\` | blob \`63f5cfad1c4218f5dc2763e44ae37a43b67124f7\` |
| machine index | \`docs/frida-navigation-index.v1.json\` | blob \`9d451834c5254c43aeb592eddca86e5282d2b91f\` |
| parent receipt | \`docs/evidence/DOCUMENTATION_NAVIGATION_RECEIPT_V1_20261003.md\` | blob \`fb784e1cd4e23d09cc6dd84cee6b60ee6b62fe84\` |

## Scope

Changed surfaces are documentation and provenance routing only:

- published route metadata;
- machine-index snapshot;
- receipt-chain link;
- this successor receipt.

No runtime, JNI, C, assembly, Gradle, workflow, test, manifest or generated
artifact was changed.

## Gate state

| Gate | State | Meaning |
|---|---|---|
| route published ref | PASS_SCOPED | \`main@099e346...\` recorded |
| historical branch preserved | PASS_SCOPED | original branch remains named |
| route/index receipt chain | PASS_SCOPED | successor receipt linked |
| automatic route-integrity validator | TOKEN_VAZIO | not yet implemented |
| merge-commit CI statuses | NOT_RUN | no status entries observed |
| physical execution | TOKEN_VAZIO | outside documentation scope |
| artifact byte custody | TOKEN_VAZIO | existing physical gap remains |
| claim promotion | BLOCKED | \`claim_allowed=false\` |

## Rollback

Revert this documentation branch or close its draft PR. Do not modify or delete
the parent receipt. Any correction must create a new superseding receipt.

## R3

\`\`\`text
F_ok:
  current main publication, historical branch, route/index blobs and receipt
  lineage are now explicitly bound.

F_gap:
  automatic route-integrity validation and all physical/artifact gates remain
  open; merge-commit CI has no observed status entries.

F_next:
  add one bounded repository-local documentation gate that parses the JSON index
  and verifies its declared local targets; run it on the exact head, without
  touching runtime or broadening the corpus.
\`\`\`

\`SOURCE != ARTIFACT != EXECUTION != EVIDENCE != CLAIM\`

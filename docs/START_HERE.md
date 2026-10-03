# Frida Lab — START HERE

Status: \`ROUTER_READY / DOCUMENTATION_ONLY\`  
Repository: \`rafaelmeloreisnovo/frida-desktop\`  
Base source observed: \`main@a4205b0166c7c222912e8fbd85d7d0173ee4e358\`  
Global claim gate: \`claim_allowed=false\`

This is the canonical navigation layer for humans and AI agents. It routes to
current source, exact-head evidence, physical receipts, provenance and gaps. It
does not replace source code, build logs or execution receipts.

## 1. Non-negotiable boundary

\`\`\`text
SOURCE != ARTIFACT != EXECUTION != EVIDENCE != CLAIM
TOKEN_VAZIO != 0 != FAIL != PASS
IMPLEMENTED_UNTESTED != PASS
HOSTED_CI_PASS != PHYSICAL_DEVICE_PASS
\`\`\`

The current source is authoritative for implementation. Exact-head CI is
authoritative only for the tested ref. A physical claim requires a physical
receipt. Documentation is a derived routing layer.

## 2. Fast path: first three reads

Read only these three roots before expanding:

1. [Current implementation summary](../IMPLEMENTATION_SUMMARY.md) — current
   topology, scoped CI evidence, open gates and R3.
2. [Assurance matrix](assurance/FRIDA_LAB_ASSURANCE_MATRIX_V1.md) — what each
   PASS, PARTIAL, NOT_RUN, DISABLED and TOKEN_VAZIO state means.
3. [Navigation index](frida-navigation-index.v1.json) — machine-readable routes,
   gates, receipts and reconstruction order.

Expand only when the selected intent requires it or when a source, authority,
evidence or contradiction is missing.

## 3. Route by intent

| Intent | Read first | Then inspect | Boundary |
|---|---|---|---|
| Current state | [IMPLEMENTATION_SUMMARY](../IMPLEMENTATION_SUMMARY.md) | source at the exact ref | summary is derived |
| Android build | [BUILD_GUIDE](../android/BUILD_GUIDE.md) | [APK/ELF/DEX lab](android-apk-elf-dex-lab.md) | hosted Gradle and standalone lab are separate |
| Device receipt | [one-screen operator](../android/app/ONE_SCREEN_OPERATOR_V1.md) | [physical evidence](evidence/physical/) | receipt must bind the execution boundary |
| Learning semantics | [learning architecture](../android/app/LEARNING_ARCHITECTURE_V1.md) | [uncertainty contract](runtime-uncertainty-family-v1.md) | shadow/validation is not ACTIVE |
| Runtime topology | [Android runtime architecture](architecture/FRIDA_LAB_ANDROID_RUNTIME_V1_1.md) | [dependency map](frida-implantation-dependency-map.v1.json) | map is not execution proof |
| CI and workflows | [workflow orchestration](WORKFLOW_ORCHESTRATION_V1.md) | [.github/workflows](../.github/workflows/) | YAML routes; scripts implement |
| Provenance | [provenance gate](rafaelia-provenance-gate.md) | [non-regression](rafaelia-provenance-non-regression.md), [third-party provenance](../THIRD_PARTY_PROVENANCE.md) | fork delta is not authorship |
| Assurance and audit | [assurance matrix](assurance/FRIDA_LAB_ASSURANCE_MATRIX_V1.md) | [audits](audits/), [evidence](evidence/) | standards references are not certification |
| Federation / ATLAS | [consumer contract](contracts/frida_atlas_mission_execution_consumer.v1.json) | [federation receipts](federation/) | Frida remains a bounded producer/consumer |
| Agent operation | [crash observer](../agents/android-crash-observer.js) | [stability dump](../agents/android-runtime-stability-dump.js) | observation is not mutation |
| Historical context | [documentation sync receipt](evidence/DOCUMENTATION_CODE_SYNC_V1_20260928.md) | [historical GUI](GUI_ARCHITECTURE.md), correction map | history is not current state |

## 4. Reconstruction protocol

Use this order for a human or AI reconstruction:

1. \`INTENT\` — select one route above; do not scan the whole repository.
2. \`CURRENT_STATE\` — read the summary and record the exact ref.
3. \`μREAD\` — read at most three root documents first.
4. \`SOURCE_MIN\` — inspect only the files needed for that intent.
5. \`AUTHORITY\` — resolve source, artifact, execution and evidence owners.
6. \`ACT\` — perform only the bounded, authorized action.
7. \`EVIDENCE\` — bind ref, artifact identity, execution result, timestamp and hash
   when bytes are available.
8. \`μWRITE\` — append a receipt or superseding record; do not erase history.
9. \`CLAIM\` — promote only the measured scope whose gate is closed.

If any of \`SOURCE\`, \`AUTHORITY\`, \`EXECUTION_TARGET\` or
\`EVIDENCE_RULE\` is missing, stop at \`ROUTE_STATE=BLOCKED\` and preserve
\`TOKEN_VAZIO\`.

## 5. Current high-value gates

The following are routing priorities derived from the current summary. They are
not new PASS claims.

| Priority | Gate | Current state | Smallest closure action |
|---|---|---|---|
| P0 | Installed APK, probe ELF and Gadget ELF bound by bytes to one exact source ref | \`TOKEN_VAZIO\` | extend the existing physical receipt, then run the exact artifact |
| P0 | Automatic ACTIVE promotion | \`DISABLED\` | keep disabled; require separate governed promotion evidence |
| P1 | Physical restart / Frida reattach / state restore | \`TOKEN_VAZIO\` | execute the bounded restart scenario and append a receipt |
| P1 | Validation persistence | \`TOKEN_VAZIO\` | implement and test persistence separately from shadow validation |
| P2 | GPU backend and total-cost evidence | \`TOKEN_VAZIO\` | implement a bounded backend and measure the complete path |
| P0 | Causal runtime claims | \`BLOCKED\` | do not promote association or observation into causality |

Priority here means reduction of uncertainty and custody risk; it does not override
repository or provider authority.

## 6. Receipt and provenance chain

Use the receipt that matches the claim boundary:

- [documentation/code sync receipt](evidence/DOCUMENTATION_CODE_SYNC_V1_20260928.md)
  records the previous documentation alignment and its limits;
- [physical evidence tree](evidence/physical/) contains device-bound material
  when available;
- [assurance matrix](assurance/FRIDA_LAB_ASSURANCE_MATRIX_V1.md) maps gates
  without claiming certification;
- [audit receipts](audits/) preserve historical observations and open gaps;
- [federated receipt](federation/frida-desktop-federated-receipt.json) and
  [lineage](federation/frida-desktop-lineage-v1.json) preserve cross-repository
  custody boundaries;
- this navigation change is recorded by
  [the navigation receipt](evidence/DOCUMENTATION_NAVIGATION_RECEIPT_V1_20261003.md).

Every new receipt should identify: stable ID, source/ref, parent or superseded
record, kind, delta, routes, evidence, gap, next step and rollback.

## 7. Safe stop conditions

Stop and ask for authority when:

- the target repository, branch or execution device is ambiguous;
- a file is missing but its absence changes the claim;
- a document conflicts with exact source or exact-head evidence;
- a proposed change would touch runtime behavior outside this documentation scope;
- a physical or security claim lacks the corresponding receipt.

## 8. R3

\`\`\`text
F_ok:
  one human/AI entrypoint, intent routes, reconstruction order and gate priorities
  are materialized without changing runtime behavior.

F_gap:
  exact artifact-to-source binding, physical restart/reattach/restore, persistence,
  GPU and causal gates remain open as recorded by the current summary.

F_next:
  review this route on the documentation branch, run the repository's applicable
  documentation/CI checks, and merge only through the authorized GitHub flow.
\`\`\`

\`claim_allowed=false\`

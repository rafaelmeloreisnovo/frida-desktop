# RAFAELIA Ω · Tooltrace/UI Evidence Custody V1 — DRAFT/HOLD

Status: PROPOSED_CONTRACT / HOSTED_LOCAL_TESTS_ONLY / claim_allowed=false
Authority: frida-desktop owns its authorized runtime probes; ChatGPT UI and provider traces remain external and inaccessible by this repository.
Related current source: tools/frida-runtime-stability-recorder.c, tools/capture-runtime-stability-dump.py, docs/runtime-stability-recorder.md.
Governance: START HERE Ω V2.2 → CURRENT_STATE HOTSTATE V4.5 → evidence receipt → review gate. Not an active runtime integration.

## Problem / measured fact
ChatGPT mobile screenshots may show an expandable tool-activity card containing an invocation envelope (\`path\`, \`args\`) rather than the complete tool result. A card that becomes non-expandable is **not** evidence of database record deletion, loss of a provider response, or a reproducible interface defect. The mobile app/provider implementation and the exact underlying tool result are unavailable to this producer.

## Separation of layers
1. SOURCE: exact app-exported JSONL or user-supplied screenshots, if permitted. Visual screenshots prove only visible pixels.
2. ARTIFACT: byte-preserving local copy; file extension is never trusted over byte signature.
3. EXECUTION: separate app/process/session and event-local source timestamp; screenshot clock and file naming are unverified.
4. EVIDENCE: SHA-256 of exact bytes and deterministic append-only event-record chain; FNV64 of runtime recorder is not cryptographic SHA-256.
5. CLAIM: scoped local checks only; no on-device live Frida/ChatGPT hooking, no provider-data persistence proof.

## Proposed opt-in flow
- Physical Android observer: on user-owned/debuggable app only, use consented screen capture or an embedded, authorized Frida Gadget adapter. Standard Frida server cross-app attachment is not assumed available on unrooted Android. Do not intercept ChatGPT network traffic, tokens, clipboard, private app memory or third-party processes.
- Adapter emits bounded, privacy-reduced metadata with \`stage\` = \`tool_call\` / \`tool_result\` / \`ui_event\`. Distinguish a missing result from an explicit JSON null.
- Capture wall time (UTC with offset) AND monotonic time provided by instrumented app, plus boot epoch or session ID where available. Never manufacture a source time from an import timestamp or screenshot filename.
- Offline importer: user explicitly supplies screenshots and/or already exported JSONL; creates immutable private copies and a manifest of exact SHA-256/byte size/MIME detected from magic bytes; emits chained records in a new output directory (no overwrite). Raw exported JSON payload is not written to a public repository.
- Bounded storage: stop with typed gap when a source is missing, oversize, unparsable, potentially secret-bearing or inaccessible. No automatic deletion, publication, or autonomous training.
- Public GitHub is only for generic contract, sanitised synthetic fixtures and tests. Private evidence stays local or in an explicitly authorized private Drive/Supabase scope. alphaXiv/Undermind are for literature, not screenshots or raw operational traces.

## Typed falsifiers / minimum tests
| Test | Counterexample | Required result |
| --- | --- | --- |
| Invocation vs result | only \`args\` exists | stage remains invocation; result = TOKEN_VAZIO |
| JSON null vs missing | \`result:null\` vs no \`result\` | JSON_NULL != MISSING |
| Empty, spaces, false, zero, ∅ | five values | five distinct semantic classes |
| MIME falsification | JPEG bytes named \`.png\` | detected MIME = JPEG, mismatch=true, original untouched |
| Tamper | mutate preserved private screenshot | verification fails |
| Chain integrity | reorder/delete/edit event | parent/hash verification fails |
| Idempotency | re-use existing output directory | refuse without overwrite |
| Timestamp | no source timestamp | TOKEN_VAZIO, import time remains separately labeled |
| Confidentiality | JSON includes passwords/token | no raw payload exported/published |
| Cross-app | non-debuggable unrelated app | BLOCKED_AUTHORITY, not silently hooked |
| Physical scope | no instrumented Android session | NOT_RUN, never PHYSICAL_PASS |
| CI | local test without exact-head workflow | HOSTED_LOCAL_ONLY, not CI_PASS |

## Risks and route
Android logcat/Accessibility/MediaProjection capture may reveal unrelated information; filter at collection boundary, use visible user consent and an allowlist. Learning/ML can classify already collected authorised metadata **after** evidence acquisition, but cannot recreate tool responses never exported. No AI-generated data may replace missing originals.

Local proof-of-concept: five source images were supplied separately to this session; a private local ZIP with byte-preserving copies, SHA-256 chain, verifier and synthetic tests exists outside GitHub. Its exact private bytes and fingerprints are intentionally **not** committed here. Physical integration and faithful re-opening of ChatGPT's own tool cards are NOT_RUN/TOKEN_VAZIO.

F_ok: bounded contract and original runtime recorder implementation reviewed.
F_gap: authorized Android adapter, provider tool-result export API, signed wall-clock/session attestation, physical exact-device receipt, independent exact-HEAD CI.
F_next: add a scoped owner-authorised adapter only to app under control; capture new trace with consent; compute independent exact-byte SHA; compare app vs export vs receipt; review before promotion.
Rollback: close this unmerged draft and leave current runtime/source/previous ledgers unchanged. Corrections append \`supersedes\` records only.

# RAFAELIA Frida — JSON Custody Four-Cycle V1

State: REVIEW / HOSTED_TESTED_SCOPED / REMOTE_COMMIT_HOLD. This is an additive integration in a review branch, not a replacement of Frida, RMR, Vectras or the original Android operator.

## Authorities and lineage

- Drive AGENTS.md -> START HERE Ω V2.2 -> CURRENT_STATE -> math/Atlas producer checkpoints.
- Frida docs/START_HERE.md, its L0 contract, tooltrace-custody-v1.schema.json and existing one-screen Android operator.
- BLAKE3/RMR rmr/AGENTS.md and RMR_BUILD_AND_BINARY_CONTRACT_V1.md: byte identity, toolchain and license separation. Upstream BLAKE3 is not changed.
- Vectras AGENTS.md Q01-Q12: VM request, provider execution and guest evidence are distinct.
- RAFAELIA Anchor Mesh (Drive): PULSAR -> SENTINEL -> MEMORY -> ACTION -> PULSAR, four separate organs × own and peer gates = eight gates. Fifth state is derived, never an additional daemon.

## Implemented source slices

| Slice | Behavior | Evidence boundary |
| --- | --- | --- |
| C11 L0 | bounded XOR/ROL32/ADD mod 2^32 with event results, four organs and eight structural checks | freestanding caller-owned memory; no OS/network/clock/JNI |
| CycleMath.java | pure Java numeric counterpart and gate checks | hosted 256-vector test |
| CustodyApprovalActivity | SAF select JSON -> inspect exact import SHA256 -> explicit human local approval -> compute -> SAF user-selected receipt and optional byte readback | Android APK/physical integration NOT_RUN |
| Python JSON runner | bounded synthetic-only JSON, SHA256 parent-linked bit-edge events, exclusive-create receipt | stdlib local execution, no cloud writes |
| NTP probe | optional unauthenticated UDP offset/rtt diagnostic | not attested chronology |

IMPORTANT: The four signatures and counters in the JSON are **caller supplied**, not four independently authenticated service signatures. The eight checks in this prototype are STRUCTURAL_LOCAL and must not authorize a remote COMMIT. The supplied expected result must not substitute for independent producer evidence.

## Remote gates: proposal, not implementation

1. Plan: Drive versioned JSON file ID, raw byte SHA256, privacy class, exact Git producer commit, bounded operations, resource limits and expected result.
2. Local: device process, installed APK/ELF/signer hashes, explicit app approval and monotonic elapsed ns; require raw source and result receipts.
3. Supabase: existing private lease with fencing token, ACL/RLS/ownership check, idempotent event, provider readback; never embed a service-role key in an app or JSON.
4. Drive: separately authorized append-only receipt upload; verify remote version, source-byte hash and provider readback. File name or modifiedTime is not a byte attest.
5. GitHub: exact commit and Git blob SHA1 are distinct from SHA256 over source bytes; no automatic branch/merge/commit from a JSON field.
6. Time: NTP is optional telemetry. Plain NTP cannot authenticate server or witness time; later use NTS, authenticated timestamping and bounded clock uncertainty.
7. If any required check is absent, outcome RETURN/HOLD, not COMMIT. No remote write or approval was tested.

## Benchmarks and forensic limits

- Each receipt should bind executable hash, input hash, device/ABI, OS/kernel, CPU frequency/temperature policy, governor, workers, repetitions, clock source, warmups, percentile distribution, counters and instrumentation cost.
- Application monotonic nanoseconds measure elapsed time INCLUDING instrumentation; they are not CPU clock cycles. Physical PMU and power telemetry are TOKEN_VAZIO until measured.
- CRC and SHA256 are different algorithms. A SHA256 chain can be rewritten by an attacker controlling the whole log. Independent anchored witnesses/signatures are needed for stronger tamper evidence.
- A syntactically valid JSON or matching expected_word is not authorization, proof of provenance or scientific proof.
- A SOURCE_CLAIM is never promoted by a passed CI that tested only a different commit, ABI or runner.

## Tests and current status

- C core: 256 vectors plus invalid expected value, gate and bounds cases on a local host; ARMv7 and AArch64 object-only crosscompile; no physical device execution.
- Java mirror: 256 inputs and negative gates on a hosted JVM.
- Python: 12 unittest methods including 256-vector sweep, duplicate-key rejection, bit-trace chain and exclusive-create receipt.
- Android API compilation/APK signature/device/SAF Drive sync: NOT_RUN.
- Remote Supabase authentication, lease acquisition, approved receipt, independent NTS and physical energy metrics: TOKEN_VAZIO.
- The review branch is public, but carries only synthetic technical source/fixtures; no private Drive JSON or secrets have been exported.

## Non-destructive rollback

Main branch and historical receipts are unchanged. Close/discard the review branch, or supersede it with an additive correction. Never silently replace prior source, metadata, receipts or third-party license material.

R3: F_ok = bounded isolated source and local tests; F_gap = physical APK, authenticated remote gate, GitHub exact-head CI; F_next = independent Android build and synthetic device E2E, then provider-specific lease/readback with explicit authorization.

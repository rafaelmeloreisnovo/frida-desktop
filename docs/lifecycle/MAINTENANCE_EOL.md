# Maintenance, Deprecation and End of Life

## Maintenance model

Software life-cycle work continues after a feature merges. Each maintained surface needs an owner/route for defects, compatibility, dependencies, security, observability, documentation and eventual retirement.

## States

- **experimental** — interface may change; evidence scope is narrow;
- **supported** — documented behavior with active regression coverage;
- **deprecated** — still available but replacement/migration is documented;
- **maintenance-only** — fixes/security only; no planned feature growth;
- **end-of-life** — no continued compatibility/security commitment;
- **removed** — code/artifact no longer ships; historical provenance remains.

A state transition should be recorded in an ADR or release note when user/operator expectations change.

## Compatibility matrix

Maintain compatibility dimensions explicitly rather than saying “works”:

- host OS/toolchain;
- CPU architecture and ABI;
- Android API/device runtime;
- Frida/subproject versions;
- Java/DEX/JNI/ELF boundary;
- artifact/schema versions;
- storage/network/provider dependencies;
- physical evidence status.

## Dependency hygiene

For each direct dependency or external GitHub Action track:

- pinned identity/version;
- purpose and authority role;
- update policy;
- known security advisories;
- license;
- replacement path;
- last validation evidence.

Prefer deterministic pins for CI catalysts and repository-owned executable semantics, consistent with the existing workflow architecture contract.

## Technical debt

Debt is catalogued, not erased by a green CI run. Use three classes:

- **known debt** — evidence exists and remediation is planned;
- **accepted constraint** — deliberate trade-off with rationale/expiry review;
- **unknown/TOKEN_VAZIO** — information is insufficient and must not be promoted to zero.

## Security and incident maintenance

Security fixes may move faster, but the evidence chain remains intact. A hotfix enters through a dedicated branch, records impact/rollback and avoids unrelated refactoring. Post-incident work should capture detection, containment, root cause, correction, prevention and evidence gaps.

## Archival

Before EOL/removal, preserve the final source identity, documentation, relevant release notes, checksums/provenance and migration/replacement guidance. Historical receipts remain historical even when the implementation is retired.

## Review cadence

Review lifecycle policy after major architecture/release changes and periodically inspect: stale docs, unsupported toolchains, obsolete fixtures, unowned components, unreachable rollback paths, expired assumptions and artifact retention gaps.

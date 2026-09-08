# Contribution and Intake

## Entry rule

New code enters normal lifecycle through a pull request to `00-intake`. This includes internal feature/fix branches and external fork contributions. Mature lifecycle branches are promotion targets, not general intake branches.

## Intake record

A PR should state:

- problem/opportunity;
- scope and out-of-scope items;
- source/origin and license implications;
- affected architectures, APIs and data formats;
- tests performed and tests still missing;
- security/privacy impact;
- performance impact or `TOKEN_VAZIO` when unmeasured;
- migration/backward-compatibility impact;
- artifacts/evidence produced;
- rollback approach;
- linked issue/RFC/ADR where appropriate.

## External code classification

Before promotion, classify imported code or binary assets by:

1. origin and authorship/provenance;
2. license and redistribution compatibility;
3. source availability;
4. checksum/signature identity;
5. dependency and supply-chain surface;
6. architecture/ABI/runtime assumptions;
7. build/reproduction status;
8. security review appropriate to risk;
9. maintenance ownership;
10. EOL/replacement strategy.

Missing information remains a blocker or explicit `TOKEN_VAZIO` according to the target lane's requirements.

## Change sizing

Prefer reviewable, reversible changes. A large feature may be decomposed into vertical slices, but decomposition must not hide a shared authority/security boundary. Changes that modify release publishing, provider permissions, secrets, branch protection, update channels or binary provenance require a dedicated review surface.

## Documentation co-change

Update the document class that owns the semantic change:

- durable architectural decision → ADR;
- significant proposal under discussion → RFC;
- operator procedure → runbook;
- future sequence → roadmap;
- user-visible shipped behavior → release notes/changelog;
- measured execution → receipt/evidence;
- interface/data contract → versioned schema/contract.

## Review ergonomics

PR titles should be concise and typed (`feat`, `fix`, `docs`, `ci`, `refactor`, `perf`, `test`, `build`, `security`, `governance`, `promote`, `rollback`). Bodies should lead with risk and evidence rather than raw implementation chronology.

## Acceptance

Acceptance into `00-intake` means **eligible for bounded testing**, not approved for integration/release. Each later lane adds evidence and narrows uncertainty.

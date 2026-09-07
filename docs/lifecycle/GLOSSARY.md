# Technical Glossary for Deep Development and Deployment

This glossary fixes vocabulary for lifecycle documents, issues, PRs and receipts. Terms are intentionally separated when they represent different authority/evidence levels.

## Architecture and planning

- **ADR — Architecture Decision Record:** durable record of a significant decision, alternatives and consequences.
- **RFC — Request for Comments:** structured proposal for a significant change before it becomes a durable decision.
- **Roadmap:** ordered future intent with milestones and exit criteria; not proof that work is complete.
- **Backlog:** prioritized work not yet necessarily scheduled or committed.
- **Milestone:** bounded delivery objective, often grouping issues/PRs.
- **Epic:** large outcome decomposed into smaller deliverables.
- **Vertical slice:** end-to-end increment crossing required layers while remaining independently reviewable.
- **Dependency graph:** nodes/edges representing build, runtime, data or authority dependencies.
- **Interface contract:** versioned expectations between components or organizations.
- **Architecture runway:** enabling technical work required before future features can safely land.

## Source and configuration management

- **SCM/VCS:** source/version-control management; Git is the repository VCS here.
- **Branch:** movable Git reference representing a line of development.
- **Tag:** Git reference normally used for a named immutable release point; in this repository tags also intersect the upstream publish graph and therefore carry authority risk.
- **Commit:** immutable Git object identifying a tree and parent lineage.
- **Merge:** integration of histories; merge policy affects traceability.
- **Rebase:** rewriting commit ancestry onto another base; inappropriate for protected historical evidence unless policy explicitly permits.
- **Configuration baseline:** identified set of versions/configurations accepted as a reference state.
- **Change control:** process by which changes are proposed, reviewed, approved, executed and recorded.
- **CODEOWNERS:** GitHub ownership-routing file; review routing is not itself an approval or protection guarantee.

## CI/CD and release engineering

- **CI — Continuous Integration:** automated build/test/validation of changes.
- **CD — Continuous Delivery/Deployment:** automated readiness or deployment; delivery and deployment are not synonymous.
- **Pipeline:** ordered automation stages with inputs, gates, outputs and failure semantics.
- **Gate:** condition that must pass before progression.
- **Promotion:** movement of the same candidate identity to a more mature lane after required evidence.
- **Release train:** repeatable cadence/process for grouping release candidates.
- **Canary:** limited exposure/validation before broader promotion.
- **Alpha:** integration-stage pre-release maturity with substantial change still possible.
- **Beta:** stabilized pre-release intended for broader validation before stable.
- **RC — Release Candidate:** beta-stage candidate expected to become stable if no blocker appears.
- **Stable:** supported release boundary; not synonymous with bug-free.
- **Feature flag:** control that separates code deployment from feature activation.
- **Environment:** named deployment/approval boundary such as test, staging or production.
- **Artifact:** produced binary/package/report/file from a build or gate.
- **Build reproducibility:** ability to reproduce equivalent output from declared inputs/toolchain; must be demonstrated, not assumed.

## Reliability and operations

- **SLI — Service Level Indicator:** measured reliability/performance signal.
- **SLO — Service Level Objective:** target value/range for an SLI.
- **SLA — Service Level Agreement:** formal commitment, usually broader than an engineering SLO.
- **Runbook:** operational procedure for a known task/condition.
- **Playbook:** decision-oriented response guide, often covering multiple runbooks.
- **Observability:** ability to infer internal system state from traces/metrics/logs/evidence.
- **Telemetry:** emitted measurements/events used for observation.
- **Health check:** bounded signal that a defined service/interface is responding; not full correctness proof.
- **MTTR:** mean time to restore/recover/repair, with definition declared in context.
- **RTO:** recovery time objective.
- **RPO:** recovery point objective.
- **Rollback:** restoration through a controlled inverse/revert path with evidence.
- **Roll-forward:** correction by a new forward change rather than reverting.
- **Postmortem:** structured analysis after an incident; ideally blameless and evidence-focused.
- **Disaster recovery:** procedures for severe loss/unavailability beyond ordinary rollback.

## Security, provenance and supply chain

- **Least privilege:** grant only permissions required for a bounded operation.
- **Provenance:** traceable origin and transformation history of source/artifacts.
- **Attestation:** signed/declared statement about an artifact or process; its trust depends on issuer and verification.
- **SBOM:** Software Bill of Materials, an inventory of software components/dependencies.
- **SLSA:** supply-chain integrity framework; repository-local controls must not be called SLSA compliance without matching evidence.
- **CVE:** public vulnerability identifier.
- **Threat model:** structured description of assets, actors, trust boundaries and abuse cases.
- **Trust boundary:** point where data/authority crosses between differently trusted domains.
- **Secret:** credential or sensitive value whose exposure changes authority/risk.
- **Immutable pin:** dependency/action reference fixed to an exact identity rather than a mutable branch/tag alias.

## Quality and testing

- **Unit test:** isolated behavioral test of a small component.
- **Integration test:** test of interactions across components/interfaces.
- **End-to-end test:** test spanning the intended user/system flow.
- **Regression test:** test protecting behavior against reintroduction of a known defect.
- **Smoke test:** small high-signal test proving a bounded path starts/works.
- **Fuzzing:** automated generation/mutation of inputs to discover failures.
- **Property-based testing:** testing invariants across generated input spaces.
- **Golden/fixture:** controlled expected input/output used by tests; fixture evidence is not live evidence.
- **Benchmark:** controlled performance measurement with declared methodology/environment.
- **Flaky test:** test with nondeterministic pass/fail behavior under equivalent conditions.
- **Coverage:** measured exercised code/requirements; high coverage does not imply correctness.

## Data, documentation and library science

- **Metadata:** data describing another resource: identity, author, date, version, type, provenance, relations.
- **Taxonomy:** controlled hierarchical classification.
- **Ontology:** explicit concepts and semantic relations, richer than a simple taxonomy.
- **Catalog:** organized inventory of resources with identifiers/metadata.
- **Index:** navigation structure pointing to resources/locations; not necessarily the source of truth.
- **Authority record/control:** controlled canonical identity/name/relationship record in information organization; analogous here to versioned machine contracts and canonical registries.
- **Provenance chain/lineage:** ordered history of origin and transformations.
- **Retention:** duration for which an artifact/record is preserved.
- **Archival:** long-term preservation with context sufficient for later interpretation.
- **Supersession:** explicit declaration that a newer record replaces another for current use without erasing history.
- **Schema:** structural contract for machine-readable data.
- **Semantic versioning:** MAJOR.MINOR.PATCH version convention tied to compatibility intent.
- **Deprecation:** supported transition period before removal.
- **EOL — End of Life:** point after which active support/maintenance commitments end.
- **LTS — Long-Term Support:** explicitly maintained line with a longer support horizon.

## RAFAELIA evidence semantics

- **`TOKEN_VAZIO`:** unknown/unobserved/not-authoritatively-resolved state; never numerically zero and never PASS.
- **Receipt:** bounded record of a concrete execution/context/result.
- **Claim boundary:** explicit limit on what evidence permits one to say.
- **Source-first:** source/contract identity precedes derived index, execution, evidence and claim.
- **Bounded catalyst:** replaceable external bootstrap/transport action whose use does not transfer implementation authority.
- **Hosted CI evidence:** execution on CI infrastructure; it does not imply physical Android/device evidence.
- **Provider readback:** authoritative post-write observation from GitHub or another external provider proving configuration/action state.

When terminology is ambiguous, use the narrower term and state the observed scope rather than inflating certainty.

# Frida Lifecycle Control Plane

> Canonical human navigation for the repository lifecycle. Machine authority lives in `docs/contracts/frida_lifecycle.v1.json`; generated receipts live under `evidence/lifecycle/`.

## Lifecycle at a glance

`feature / external contribution → 00-intake → 01-integration → 02-beta → main`

| Lane | Channel | Purpose | Promotion |
|---|---|---|---|
| `00-intake` | test | accept, classify, provenance-check and bounded-test code | PR to `01-integration` |
| `01-integration` | alpha | integration, compatibility, canary and cross-subsystem checks | PR to `02-beta` |
| `02-beta` | beta/RC | stabilization, evidence aggregation and release readiness | PR to `main` |
| `main` | stable | stable baseline and existing upstream release boundary | terminal lane |

## Navigation

- [Roadmap](ROADMAP.md) — staged implementation and exit criteria.
- [Branching and promotion](BRANCHING_AND_PROMOTION.md) — allowed flow, promotion gates and protection target.
- [Versioning and releases](VERSIONING_AND_RELEASES.md) — SemVer, test/alpha/beta/stable channels and release-note discipline.
- [Artifact catalog](ARTIFACT_CATALOG.md) — evidence hierarchy, naming, retention and visualization.
- [Rollback and recovery](ROLLBACK_AND_RECOVERY.md) — revert-first recovery, receipts and emergency boundaries.
- [Contribution and intake](CONTRIBUTION_AND_INTAKE.md) — how internal/external code enters the system.
- [Maintenance and EOL](MAINTENANCE_EOL.md) — deprecation, compatibility, LTS/EOL and technical-debt policy.
- [Technical glossary](GLOSSARY.md) — development, deployment, governance and library-science vocabulary.

## GitHub surfaces

- `Frida Lifecycle Governance`: universal PR/push gate for all lifecycle lanes.
- `Frida Lifecycle Promotion`: manual bounded automation that opens the next promotion PR; never auto-merges.
- `Workflow Architecture Contract`: repository-local topology/catalyst meta-gate reused by lifecycle governance.
- `RAFAELIA Provenance Non-Regression Gate`: append-only provenance boundary.
- `.github/release.yml`: automatic release-note category configuration only; it does not publish.
- Issue forms and promotion PR template: structured intake and release-readiness metadata.

## Evidence UI

Every lifecycle run emits four views of the same state:

1. `lifecycle-state.v1.json` — canonical machine-readable receipt;
2. `lifecycle-state.v1.md` — GitHub Step Summary / human-readable receipt;
3. `index.html` — static artifact viewer;
4. `SHA256SUMS` — integrity sidecar.

The existing Frida dashboard is an eligible **read-only consumer** of this JSON. UI rendering does not become a new authority source.

## Evidence boundary

`PR PASS != SERVER PROTECTION != RELEASE AUTHORITY != PHYSICAL DEVICE PROOF`

Unknown or externally controlled state is represented as `TOKEN_VAZIO`, never as zero or PASS. Production tags/releases are intentionally not created by lifecycle automation while the upstream release graph remains a separate authority surface.

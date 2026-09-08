# Versioning and Releases

## Version model

Use Semantic Versioning for RAFAELIA/Frida lifecycle planning:

`MAJOR.MINOR.PATCH[-PRERELEASE.N]`

- **MAJOR** — incompatible contract/API/behavior change;
- **MINOR** — backward-compatible capability;
- **PATCH** — backward-compatible correction;
- **alpha/beta/rc** — pre-release maturity, not production authority.

## Channel mapping

| Lane | Channel | Version evidence | Publication |
|---|---|---|---|
| `00-intake` | test | run/SHA artifact identity | artifact only |
| `01-integration` | alpha | candidate SemVer may be planned | artifact only |
| `02-beta` | beta/RC | `X.Y.Z-beta.N` / `X.Y.Z-rc.N` readiness | artifact only |
| `main` | stable | `X.Y.Z` readiness | existing upstream release boundary |

## Why pre-release tags are not created yet

The existing upstream `ci.yml` treats Git tags as a production-release surface. Therefore lifecycle automation does **not** create alpha/beta tags until tag-trigger isolation has its own reviewed evidence. Planned future namespace:

`rafaelia-vMAJOR.MINOR.PATCH-{alpha|beta|rc}.N`

Until that isolation is proven, `tag_creation_state=TOKEN_VAZIO_RELEASE_GRAPH_ISOLATION_REQUIRED`.

## Release readiness

`Frida Lifecycle Governance` supports `workflow_dispatch → release-readiness`.

- from `02-beta`: requires pre-release SemVer syntax;
- from `main`: requires stable SemVer syntax;
- generates a receipt only;
- never creates a tag;
- never publishes packages;
- never upgrades an unknown external authority to PASS.

## Release notes

`.github/release.yml` groups automatically generated GitHub release notes by change intent. A release candidate should also carry:

- summary and rationale;
- user-visible changes;
- compatibility and migration notes;
- security implications;
- performance changes with measurement scope;
- known limitations and `TOKEN_VAZIO` items;
- artifact/checksum/provenance references;
- rollback guidance;
- deprecated and removed behavior;
- contributors and linked ADR/RFC/issue/PR identifiers.

## Changelog discipline

Release notes explain **this release**. The roadmap explains **future intent**. ADRs explain **why a durable architectural decision was made**. RFCs explain **a proposed significant change**. Receipts prove **what a particular execution observed**. Do not collapse these document classes into a single mutable file.

## Compatibility

Compatibility declarations must name the tested surface: architecture/ABI, Android API level, Frida component/version, artifact format, wire/API contract, host toolchain and physical-device status when applicable. Hosted-CI compatibility must not be labeled physical-device compatibility.

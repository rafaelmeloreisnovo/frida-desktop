# Artifact and Evidence Catalog

## Rule

An artifact is a produced object; evidence is an artifact interpreted within a declared scope. Neither automatically grants a claim or release authority.

`source → execution → receipt → checksum → transport → human/machine view`

## Lifecycle evidence bundle

Every `Frida Lifecycle Governance` run emits:

| File | Role |
|---|---|
| `lifecycle-state.v1.json` | canonical machine-readable state/receipt |
| `lifecycle-state.v1.md` | GitHub Step Summary and human navigation |
| `index.html` | static offline viewer |
| `SHA256SUMS` | integrity sidecar for the three views |
| `workflow-contract.json/.md` | topology/catalyst inventory from the existing meta-gate |

GitHub artifact name includes `run_id` and `run_attempt` to avoid overwrite ambiguity.

## Existing technical evidence families

The repository already contains independent evidence-producing gates for Android APK/ELF/DEX, ARM32/NEON4096 freestanding paths, physical-benchmark adapters, RFL self-tests, runtime-aided debugging, runtime learning, crash observability, hash backends and provenance. Lifecycle orchestration **indexes** them; it does not redefine their technical assertions.

## Physical-device evidence register

Canonical physical-device receipts are grouped under `evidence/physical/`; their human interpretations and next-evidence plans live under `docs/evidence/physical/`.

The first registered receipt is `RAFAELIA_FRIDA_LAB_RECEIPT_V1`, classified as evidence level **6 — PHYSICAL_DEVICE** for its observed Android 10 / `armeabi-v7a` runtime, loaded source-built ELF probe, loaded Frida Gadget ELF and NEON4096 SIMD fold selftest. Its bounded interpretation explicitly leaves VALIDATE_SHADOW, validation persistence, recovery, comparative NEON performance and GPU promotion unresolved where the receipt does not prove them.

Physical evidence rules:

- raw receipts are append-only historical records;
- normalized JSON may add machine-readable classification but must preserve source values;
- ingestion time is not substituted for a missing measurement timestamp;
- a diagnostic PASS does not imply model-validation or performance PASS;
- `TOKEN_VAZIO` remains explicit until measured;
- physical-device evidence may resolve hosted-CI uncertainty only for the exact measured scope.

Index: `docs/evidence/physical/README.md`.

## Evidence levels

1. **SOURCE** — code/config/document exists and hashes.
2. **STATIC** — syntax/schema/topology/provenance gate executed.
3. **HOSTED_EXECUTION** — compiler/test ran on CI host.
4. **ARTIFACT** — expected package/report was produced and hashed.
5. **INTEGRATION** — bounded subsystem interaction was exercised.
6. **PHYSICAL_DEVICE** — receipt identifies real device/runtime execution.
7. **RELEASE** — separately authorized publication completed with provider readback.

A higher number is not inferred from a lower one.

## Naming

Preferred artifact identity:

`<surface>-<channel>-<git-sha-short>-<run-id>-<attempt>`

Receipts should include the full SHA internally. File names may use a short SHA only for readability.

## Retention and archive

- ephemeral test artifacts: short retention appropriate to debugging;
- lifecycle/provenance receipts: longer retention and append-only archival where practical;
- release artifacts: governed by release policy and provider retention;
- physical-device receipts: preserve with device/runtime metadata and checksum;
- superseded artifacts are not silently deleted from historical receipts; mark them superseded.

## Visualization

The generated HTML is dependency-free and travels inside the artifact. GitHub Step Summary renders the same state in Markdown. The existing dashboard may consume the JSON read-only. A dashboard discrepancy never overrides the JSON/checksum receipt.

## Accepting external code/artifacts

External inputs must be classified before trust:

- source versus binary;
- origin/license/provenance;
- expected checksum/signature if known;
- extraction/parsing safety;
- build reproducibility or declared limitation;
- malware/security scanning where applicable;
- architecture/ABI compatibility;
- evidence level actually achieved.

Unknown origin, missing checksum or unexecuted verification remains explicit rather than becoming a default PASS.

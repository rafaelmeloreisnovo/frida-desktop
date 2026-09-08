# Physical Device Evidence — RAFAELIA_FRIDA_LAB_RECEIPT_V1

## Classification

This record is classified as **evidence level 6 — PHYSICAL_DEVICE** under the Frida lifecycle evidence hierarchy. It records a real Android runtime context and therefore supersedes hosted-CI-only uncertainty for the specific observations listed below. It does **not** grant a broader scientific, performance or release claim.

Raw receipt: `evidence/physical/android10-armeabi-v7a/2026-09-07/RAFAELIA_FRIDA_LAB_RECEIPT_V1.txt`

Normalized receipt: `evidence/physical/android10-armeabi-v7a/2026-09-07/RAFAELIA_FRIDA_LAB_RECEIPT_V1.json`

The source receipt did not provide an evidence timestamp. The normalized record therefore uses `evidence_timestamp=TOKEN_VAZIO_NOT_PROVIDED`; `ingested_on=2026-09-07` is documentary ingestion metadata, not the measurement time.

## Observed PASS scope

| Surface | Observed state | Claim boundary |
|---|---|---|
| Diagnostic | `PASS` | Overall lab diagnostic for this receipt only |
| Runtime | Android 10 / SDK 29 / `armeabi-v7a` | Physical ARM32 Android context observed |
| Source-built ELF probe | `LOADED` | ELF probe loading path observed |
| Frida Gadget ELF | `LOADED` | Gadget loading path observed |
| Endpoint | `127.0.0.1:27042` | Local Gadget endpoint reported |
| OS page | `4096 B / MATCH_4096` | Runtime page-size observation matches NEON4096 contract |
| Compiled SIMD backend | `NEON128` | Backend identity observed |
| Default CPU route | `CPU_NEON` | Routing selection observed |
| SIMD fold selftest | `PASS` | Selftest passed in this receipt |
| Selftest page CRC32C | `0xed4a015e` | Exact receipt value preserved |
| CRC32C surfaces | `HOT + BUFFER + STORAGE + PAGE` | Reported enabled surfaces |

## Learning state — intentional OFF

The receipt explicitly reports:

- `learning_mode=OFF`;
- read-only / no-write behavior;
- `training observations=0`;
- `training predictions=0`;
- `RFL committed records=0`;
- `automatic_active=DISABLED`.

Therefore zero observations and zero predictions are **expected observations for OFF mode** and are not classified as training failure. This receipt does not demonstrate a learning cycle because no learning cycle was requested or executed.

The RFL file reports 64 bytes and zero committed records. `RFL recovered tail=NO` is preserved as an observation. This is **not** classified as a successful recovery test because the receipt does not demonstrate a damaged/interrupted tail followed by recovery.

## VALIDATE_SHADOW state

`VALIDATE_SHADOW` is **not yet validated**. The decisive fields are:

- `model frozen: NO`;
- observations/predictions: `0 / 0`;
- confidence: `INSUFFICIENT_EVIDENCE / 0.00%`;
- candidate contexts after gates: `0`;
- validation persistence: `TOKEN_VAZIO`;
- automatic ACTIVE policy: `DISABLED`.

Correct classification:

`VALIDATE_SHADOW=INSUFFICIENT_EVIDENCE`

not `FAIL`, because the prerequisite frozen-model observation campaign has not yet occurred.

## NEON4096/3 interpretation

The reported contract is arithmetically closed:

`64 B control + 3 × 1344 B = 4096 B`

The alternate partition is also closed:

`8 × 512 B = 4096 B`

And the reported SIMD/page geometry is internally compatible with a 4096-byte page:

- `64 × 64 B = 4096 B` cache lines;
- `256 × 128-bit = 4096 B` of vector-width coverage.

The receipt therefore supports the bounded statement:

`ARM32_NEON4096_PHYSICAL_SELFTEST=PASS`

It does **not** establish that NEON is faster than scalar, that the route is globally optimal, or that DVFS/cache/scheduling confounders have been controlled.

## GPU boundary

`GPU compute backend=TOKEN_VAZIO / not promoted` is preserved exactly as an unresolved state. It is not equivalent to GPU failure or disablement. The reported routing rule requires a measured backend plus total-cost evidence before promotion.

## Claim matrix

| Claim | State |
|---|---|
| Physical Android ARM32 runtime observed | **YES** |
| Source-built ELF probe loaded | **YES** |
| Frida Gadget ELF loaded | **YES** |
| NEON128 backend observed | **YES** |
| SIMD fold selftest passed | **YES** |
| Learning/training executed | **NO** |
| VALIDATE_SHADOW validated | **NO — insufficient evidence** |
| Validation persistence proven | `TOKEN_VAZIO` |
| Automatic ACTIVE enabled | **NO / disabled** |
| GPU backend validated | **NO / TOKEN_VAZIO** |
| NEON performance superiority proven | **NO** |
| Scientific/generalized claim allowed | **NO** |

## Invariants

- `DIAGNOSTIC_PASS != MODEL_VALIDATION_PASS`
- `ZERO_OBSERVATIONS_IN_OFF_MODE != TRAINING_FAILURE`
- `PHYSICAL_DEVICE_RECEIPT != PERFORMANCE_SUPERIORITY`
- `NEON_SELFTEST_PASS != SCALAR_COMPARATIVE_BENCHMARK`
- `GPU_TOKEN_VAZIO != GPU_FAIL`
- `NO_RECOVERED_TAIL != RECOVERY_TEST_PASS`
- `claim_allowed=false`

This interpretation may be superseded by later receipts, but the raw receipt remains append-only historical evidence.

# Physical Evidence Register

This group contains physical-device receipts and their bounded interpretations. Raw receipts are preserved append-only; normalized JSON exists for machine navigation; analysis documents state claim boundaries; validation plans define the next evidence required.

## Current entries

### RAFAELIA_FRIDA_LAB_RECEIPT_V1

- Device class: Android 10 / SDK 29 / `armeabi-v7a`
- Evidence level: **6 — PHYSICAL_DEVICE**
- Diagnostic: **PASS**
- Source-built ELF probe: **LOADED**
- Frida Gadget ELF: **LOADED**
- NEON backend: **NEON128**
- NEON4096 SIMD fold selftest: **PASS**
- Learning: **OFF / read-only**
- VALIDATE_SHADOW: **INSUFFICIENT_EVIDENCE**
- GPU: `TOKEN_VAZIO_NOT_PROMOTED`
- Automatic ACTIVE: **DISABLED**
- Claim allowed: **false**

Files:

- raw: `evidence/physical/android10-armeabi-v7a/2026-09-07/RAFAELIA_FRIDA_LAB_RECEIPT_V1.txt`
- normalized: `evidence/physical/android10-armeabi-v7a/2026-09-07/RAFAELIA_FRIDA_LAB_RECEIPT_V1.json`
- checksums: `evidence/physical/android10-armeabi-v7a/2026-09-07/SHA256SUMS`
- interpretation: `docs/evidence/physical/RAFAELIA_FRIDA_LAB_RECEIPT_V1_ANALYSIS.md`
- next validation: `docs/evidence/physical/NEXT_VALIDATION_PLAN.md`

## Registry rules

1. A raw receipt is never edited to match a later interpretation.
2. Documentary ingestion time is distinct from physical measurement time.
3. `TOKEN_VAZIO` remains explicit until the relevant measurement/readback exists.
4. Hosted CI does not overwrite or substitute physical-device evidence.
5. A diagnostic PASS does not imply model validation, comparative performance, recovery or release PASS.
6. New receipts append to this register and may supersede current conclusions only for the scope they actually measure.

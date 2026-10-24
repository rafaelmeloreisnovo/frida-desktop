# RAFAELIA Frida — Android Lite Boundary and Footprint V1

State: SOURCE_CHANGED / FIRST_HEAD_CI_PASS / NEW_COMPARATOR_CI_PENDING / PHYSICAL_DEVICE_TOKEN_VAZIO
Producer: rafaelmeloreisnovo/frida-desktop
Parent main: 6747df6b7dfac1b4685a247be940c283d017b27a
Scope: hosted Android build dependencies and byte-size evidence only
Global claim_allowed: false

## Purpose

Reduce APK build friction without rewriting or claiming authorship of upstream
Frida, Frida Gum, Gadget, JNI, Android framework, or the RFL freestanding core.
The target is the existing one-screen operator, not a second application.

## Bounded modification

- The normal operator remains MainActivity (Android framework / platform APIs).
- The five declared production Maven dependencies (AppCompat, ConstraintLayout,
  Material, Gson, OkHttp) are removed from android/app/build.gradle.
- The historical source files under the Java learning/ and ui/ packages remain
  in Git, with their bytes and authorship intact, but are excluded from the
  default Android Gradle production source set. These classes were not imported
  by MainActivity, and the old research panel had unresolved integration
  issues. Reactivating that historical panel is a separate compatibility task.
- The legacy `android/app/res/layout/research_mode_panel.xml` is also retained
  in Git, but the source-only Lite Activity uses `android.R` and excludes the
  research XML resource directory from Gradle packaging (`res.srcDirs = []`).
  The first attempted hosted Gradle build failed on ConstraintLayout XML
  attributes; this surgical fix addresses the observed unresolved resource
  boundary but still requires a new Gradle execution before claiming PASS.
- JUnit/AndroidX test dependencies remain build/test-only, not production
  runtime dependencies.
- Frida Gadget, upstream submodules, JNI exports, ABI filters, storage, learning
  modes, automatic ACTIVE policy, and current device package identity are not
  modified by this change.
- No new workflow, daemon, listener, background service, download, permission,
  runtime thread, or data migration has been introduced.

## One-command check

    python3 android/app/validate-lite-profile.py

This static gate requires Python stdlib only; it checks the production
dependency declarations, Gradle exclusion patterns, active Activity imports,
and absence of links from MainActivity to the excluded legacy classes.

To inventory existing build artifacts after an authorized build:

    python3 android/app/validate-lite-profile.py \
      --artifact-root dist/android17-lab \
      --artifact-root build/android17/native \
      --receipt evidence/android17-lab/lite-footprint.v1.json

The receipt is exclusive-create and append-by-new-filename (no overwrite).
It records per-file byte length and SHA-256 plus aggregate byte length. It does
not infer RSS, native allocations, initialization latency, energy consumption,
hook overhead, restart reliability, physical execution, or functional identity
from those numbers.

The existing android17-apk-elf-dex CI performs both checks around its existing
APK, JNI ELF, and DEX build graph. This CI uses its own explicit source-build
toolchain; it is NOT an Android Gradle dependency-resolution test.

## Historical APK comparison (not a controlled hardware A/B)

The read-only baseline file
`docs/evidence/FRIDA_ANDROID17_APK_BASELINE_PR83_20261007.json`
preserves recorded APK byte sizes and SHA-256 digests from GitHub Actions
Android17 run 37695601911 / job 113046712984, source
`5d899981feb5e9f822313869d8eeb01abb24eefb` (PR #83).
The first PR #84 Android17 run 40049594579 / job 120739174933, source
`dc2880d1d591792422fac70004f56f87fbae1de5`, passed build,
artifact manifest creation and provenance gates.

At those heads the four APK archive sizes were exactly equal:

- ARMv7: 8,024,812 bytes (delta 0).
- AArch64: 10,158,822 bytes (delta 0).
- Universal and physical universal: 18,158,631 bytes each (delta 0).

Their historical and candidate SHA-256 values are different. Thus this
does NOT establish byte-identical APKs, reproducible signing, a Gradle
footprint benefit, runtime stability, or a physical memory reduction.
A comparable toolchain/build contract is desirable for a controlled A/B
experiment; these are two historical CI runs with separately recorded
provenance.

`android/app/compare-apk-footprint.py` performs a strict comparison of
the new inventory receipt against that source baseline. It validates the
source commit (40-hex Git SHA), APK digests (64-hex SHA-256), expected
package names, Frida Gadget pin, duplicate/missing artifacts and signed
archive-size deltas. It fails on any size increase in this narrowly scoped
branch, emits an exclusive-create receipt, and preserves the physical gates
as unverified. The companion stdlib unit tests cover incomplete/malformed
inputs and negative regressions.

This is a *size-nonregression guard*, not a blanket functional guarantee.
The sum of four APK archive files is NOT installed storage, and the separate
native ELF inventory must not be added to APK sizes to claim deployed
memory usage.

## Cross-version interoperability

The repository workflow currently pins a particular Frida Gadget build.
Compatibility against later upstream Frida versions must be tested with
matching host/agent protocol, ABI, Android SDK, attach, detach, clean restart,
and same-byte verification. Do not update the pinned Frida version blindly.
Never claim the upstream Frida tree is freestanding.

## Gates

| Gate | This change | Evidence needed |
|---|---|---|
| Runtime dependency declaration | Source updated | static gate run |
| Historical Java/XML research UI excluded by default | Configured | independent Gradle assemble and DEX/resources inspection |
| Gradle dependency graph reduced | Expected | dependency graph before/after |
| APK byte reduction | 0 B in first historical comparison; new gate pending CI | controlled matched-toolchain A/B and artifact digests |
| RSS / CPU / thermal reduction | TOKEN_VAZIO | physical A/B, repeated measures |
| ARMv7 / AArch64 JNI and Gadget | UNCHANGED_SOURCE | exact-head CI and physical receipts |
| Frida reattach + restart | TOKEN_VAZIO | bounded physical device sequence |
| Upstream license provenance | PRESERVED | release provenance verification |

## Rollback

Revert the bounded Gradle and workflow commits, or supersede this change with
a narrowly reviewed one. Do not delete historical Java sources, upstream
licenses, old receipts, or prior documents.

## R3

F_ok = isolated lite source profile and bounded byte-inventory gate created.
F_gap = Gradle build after legacy-XML exclusion, latest exact-head comparator run, and physical resource/compatibility A/B remain unproven.
F_next = run exact-head APK baseline gate; verify hosted Gradle profile separately; collect RSS/latency/restart receipts on ARM32 and ARM64.

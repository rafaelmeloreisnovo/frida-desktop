# RAFAELIA Frida — Android Lite Boundary and Footprint V1

State: IMPLEMENTED_SOURCE / CI_PENDING / PHYSICAL_DEVICE_TOKEN_VAZIO
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
| Historical UI not bundled by default | Configured | Gradle assemble and DEX inventory |
| Gradle dependency graph reduced | Expected | dependency graph before/after |
| APK byte reduction | TOKEN_VAZIO | comparable clean baseline and candidate APK |
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
F_gap = Gradle build, CI exact-head output, and physical resource/compatibility A/B are not established by source edits alone.
F_next = verify CI on exact head; build Gradle profile; collect APK/RSS/latency/crash receipts on ARM32 and ARM64; compare with the prechange baseline.

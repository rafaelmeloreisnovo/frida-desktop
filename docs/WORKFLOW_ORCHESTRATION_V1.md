# Workflow Orchestration V1

Status: implementation + repository-local structural gates

Claim boundary: this document describes engineering controls implemented in this repository. It does **not** certify compliance with an external standard, audit framework, security program, or legal regime. Such claims require the relevant independent/continuous audit evidence.

## Design rule

The workflow layer is declarative:

`trigger -> permissions -> concurrency -> bounded job -> named implementation stage -> evidence artifact`

Executable build/test logic lives in `.github/scripts/rafaelia/` so it can be invoked outside GitHub Actions and reviewed without parsing large YAML shell blocks.

## Workflow roles

### `.github/workflows/ci.yml`

Role: `UPSTREAM_RELEASE_GRAPH`.

This is the large Frida multi-platform build/release graph. It spans Windows, macOS, Linux, iOS, watchOS, tvOS, Android, QNX, SDK/toolchain rolling, packaging and publish jobs. The RAFAELIA Android lab does not inject implementation logic into this release graph.

The file is intentionally preserved rather than mechanically reformatted: a broad rewrite would couple the lab changes to unrelated release paths and increase regression risk. `workflow-contract.py` still inventories and gates its sensitive trigger/release anchors.

### `.github/workflows/android17-apk-elf-dex.yml`

Role: `RAFAELIA_CUSTOM_ORCHESTRATION`.

Implementation: `.github/scripts/rafaelia/android-lab-ci.sh`.

Stages:

1. resolve Android API/Build-Tools/NDK fail-closed;
2. fetch official pinned Frida Gadget assets and verify release SHA-256;
3. compile source-built ARMv7 and ARM64 probes;
4. verify ELF identity, machine ABI, exported symbol and source-built linker page contract;
5. compile Java -> DEX;
6. build/align/sign/inspect ARMv7, ARM64 and universal APKs;
7. emit SHA-256 manifest and `receipt.android17-apk-lab.v3.json`.

Distinct page concepts are preserved:

- logical NEON4096 unit: 4096 bytes;
- ARMv7 source-built ELF linker max-page contract: 4096 bytes;
- ARM64 source-built ELF linker max-page contract: 16384 bytes;
- physical/runtime page size: observed only on a device, never inferred from CI.

Physical-device smoke and GPU compute remain `TOKEN_VAZIO` until receipts exist.

### `.github/workflows/android17-rfl-selftest.yml`

Role: `RAFAELIA_CUSTOM_ORCHESTRATION`.

Implementation: `.github/scripts/rafaelia/rfl-neon4096-selftest.sh`.

The gate preserves RFL append/replay/corrupt-tail behavior and NEON4096 geometry while requiring frozen-model validation semantics. Automatic active policy remains disabled; GPU compute and physical performance remain `TOKEN_VAZIO`.

### `.github/workflows/runtime-aided-debugger-hardening.yml`

Role: `RAFAELIA_CUSTOM_ORCHESTRATION`.

Implementation: `.github/scripts/rafaelia/runtime-aided-hardening.sh`.

Separate stages exercise hosted C11, freestanding compilation, and ASan+UBSan. The workflow emits source hashes and a bounded receipt; it does not reinterpret hosted CI as physical Android evidence.

### `.github/workflows/workflow-contract.yml`

Role: `RAFAELIA_CUSTOM_ORCHESTRATION / META-GATE`.

Implementation: `.github/scripts/rafaelia/workflow-contract.py`.

It inventories every `.yml/.yaml` under `.github/workflows`, records hashes/roles, rejects `pull_request_target`, rejects broad `write-all`, rejects floating action refs such as `@main/@master`, requires explicit controls on custom workflows, and protects the upstream release graph's trigger anchors.

## Evidence hierarchy

`YAML parsed/started != implementation compiled != test executed != artifact produced != physical device executed != performance claim`

CI receipts therefore keep `claim_allowed=false` for physical/performance conclusions. Negative results and unresolved states remain explicit rather than being converted into PASS.

## Local execution

From the repository root on a compatible Linux host:

```bash
bash .github/scripts/rafaelia/rfl-neon4096-selftest.sh all
bash .github/scripts/rafaelia/runtime-aided-hardening.sh all
python3 .github/scripts/rafaelia/workflow-contract.py
```

The Android pipeline additionally requires Android SDK command-line tools, Java, NDK dependencies and network access to fetch the pinned official Frida release asset:

```bash
export COMPILE_SDK=37 TARGET_SDK=37 MIN_SDK=21
export NDK_VERSION=29.0.14206865 FRIDA_VERSION=17.9.11
bash .github/scripts/rafaelia/android-lab-ci.sh resolve-sdk
bash .github/scripts/rafaelia/android-lab-ci.sh fetch-frida
bash .github/scripts/rafaelia/android-lab-ci.sh build-native
bash .github/scripts/rafaelia/android-lab-ci.sh verify-native
bash .github/scripts/rafaelia/android-lab-ci.sh build-dex
bash .github/scripts/rafaelia/android-lab-ci.sh package-apks
bash .github/scripts/rafaelia/android-lab-ci.sh receipt
```

## Change discipline

When implementation changes, update the script first, then its orchestration YAML, then the evidence contract. Do not put a second implementation copy back into `run: |` blocks. Keep upstream-release changes isolated from lab-specific changes unless a concrete dependency requires coupling them.

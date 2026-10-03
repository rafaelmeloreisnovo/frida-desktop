# Frida

Dynamic instrumentation toolkit for developers, reverse-engineers, and security
researchers. Learn more at [frida.re](https://frida.re/).

## RAFAELIA fork — current implementation state

This fork contains an opt-in RAFAELIA Android/runtime research layer in addition
to the upstream Frida codebase. The fork-specific layer is **not** the same thing
as upstream Frida and it is not described as dependency-free.

Current authority order:

1. source code and manifests on the exact Git ref under test;
2. exact-head CI evidence for that ref;
3. physical-device receipts when a device claim is made;
4. documentation as a derived description of the above.

The current Android lab includes:

- package `io.rafaelia.fridalab` with an on-device one-screen operator;
- JNI/native RFL learning runtime with
  `OFF | OBSERVE | LEARN_SHADOW | PREDICT_SHADOW | VALIDATE_SHADOW | FROZEN`;
- RFL V1 fixed 64-byte header/record ABI and 4096-byte write slab;
- NEON4096/3 page contract: `64 B control + 3 x 1344 B = 4096 B`;
- ARM32/AArch64 build routes and separate freestanding/structural gates;
- local Frida Gadget instrumentation on `127.0.0.1:27042`;
- append-only on-device smoke receipts with raw and evidence-normalized learning
  snapshots;
- passive Runtime Stability Dump V2, HyperMemory, uncertainty/actionability
  gates, and SHA-256 evidence-facing integrity checks.

Automatic ACTIVE promotion remains disabled. GPU compute, validation persistence,
physical restart/reattach/restore, and causal runtime claims remain separately
gated unless a receipt closes the corresponding gap.

Start here for the fork-specific state:

- [Documentation navigator for humans and AI](docs/START_HERE.md)
- [Current implementation summary](IMPLEMENTATION_SUMMARY.md)
- [Android one-screen operator](android/app/ONE_SCREEN_OPERATOR_V1.md)
- [Learning architecture](android/app/LEARNING_ARCHITECTURE_V1.md)
- [Android APK / ELF / DEX lab](docs/android-apk-elf-dex-lab.md)
- [Runtime uncertainty contract](docs/runtime-uncertainty-family-v1.md)
- [Runtime stability falsifiability](docs/runtime-stability-falsifiability.md)

Two ways to install
===================

## 1. Install from prebuilt binaries

This is the recommended way to get started. All you need to do is:

    pip install frida-tools # CLI tools
    pip install frida       # Python bindings
    npm install frida       # Node.js bindings

You may also download pre-built binaries for various operating systems from
Frida's [releases](https://github.com/frida/frida/releases) page on GitHub.

## 2. Build your own binaries

Run:

    make

You may also invoke `./configure` first if you want to specify a `--prefix`, or
any other options.

For constrained target experiments, an opt-in freestanding diagnostic profile is
available through `-Dfreestanding_profile=true`; see
[`docs/freestanding-profile.md`](docs/freestanding-profile.md) for the supported
contract and validation loop.

Standalone ChipQuantum basic-command diagnostics are also available through
[`tools/chipquantum-basic-commands.c`](tools/chipquantum-basic-commands.c),
[`tools/chipquantum-benchmark.c`](tools/chipquantum-benchmark.c), and
[`tools/chipquantum-repo-sensors.py`](tools/chipquantum-repo-sensors.py), with
their contract documented in
[`docs/chipquantum-basic-commands.md`](docs/chipquantum-basic-commands.md).

Debugger Class A autotuning diagnostics are available through
[`tools/frida-debugger-class-a-autotune.c`](tools/frida-debugger-class-a-autotune.c)
and [`tools/frida-debugger-class-a-autotune.h`](tools/frida-debugger-class-a-autotune.h),
with FAILSAFE/FAILOVER/ROLLBACK semantics documented in
[`docs/debugger-class-a-autotune.md`](docs/debugger-class-a-autotune.md).

An opt-in runtime stability recorder extends that debugger contract with a
silicon-profile gate, Q16 `delta ~= 0.18` trigger, fixed-capacity metadata bank,
and instability-only dumps. It never stores network payload or decrypted
content. See
[`docs/runtime-stability-recorder.md`](docs/runtime-stability-recorder.md) and
[`profiles/runtime-stability-recorder.json`](profiles/runtime-stability-recorder.json).

### CLI tools

For running the Frida CLI tools, e.g. `frida`, `frida-ls-devices`, `frida-ps`,
`frida-kill`, `frida-trace`, `frida-discover`, etc., you need a few packages:

    pip install colorama prompt-toolkit pygments websockets

### Apple OSes

First make a trusted code-signing certificate. If you have already used Xcode
before, chances are you already have an Apple development certificate.
You can check it with the following command:

    security find-identity -v -p codesigning

Which will return the certificate in the following format:

    1) XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX "Apple Development: user@mail.com (YYYYYYYYYY)"

If you do not have a certificate, follow this guide: 
https://help.apple.com/xcode/mac/current/#/dev154b28f09.

Next export the name of your certificate to relevant environment
variables, and run `make`:

    export MACOS_CERTID=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
    export IOS_CERTID=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
    export WATCHOS_CERTID=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
    export TVOS_CERTID=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
    make

## Learn more

Have a look at our [documentation](https://frida.re/docs/home/).

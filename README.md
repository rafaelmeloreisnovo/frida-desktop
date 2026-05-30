# Frida

Dynamic instrumentation toolkit for developers, reverse-engineers, and security
researchers. Learn more at [frida.re](https://frida.re/).

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

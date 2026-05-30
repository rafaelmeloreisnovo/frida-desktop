# ChipQuantum basic-command benchmark and repository sensors

`tools/chipquantum-basic-commands.c` is a standalone, opt-in diagnostic source
file for experimenting with the user's seven-dimensional toroidal mapping idea
without changing Frida's default desktop build.  It is deliberately kept outside
Meson subprojects until a real target contract exists.

The implementation follows a conservative low-level contract:

- fixed seven-lane torus state `s in [0, 1)^7`, represented as unsigned Q16 lanes;
- fixed 42-state attractor orbit;
- alpha update `C(t+1) = (3*C(t) + C(in)) / 4`, matching `alpha = 0.25`;
- coherence gate `phi = (1 - H) * C` in fixed point;
- byte accumulator, FNV-1a, and CRC32 primitives;
- entropy estimate `unique * 6000 / 256 + transitions * 2000 / (len - 1)`;
- spiral radius approximation using `(sqrt(3) / 2)^n` as `866 / 1000`;
- no heap allocation, recursion, generated lookup tables, GumJS, Node, Python,
  or other hosted Frida runtime layers in the primitive source.

## Real benchmark source

`tools/chipquantum-benchmark.c` is a hosted benchmark harness that links against
the primitive C source and prints CSV timing rows for XOR, FNV-1a, CRC32, and the
full toroidal map over deterministic sensor payload sizes.

```sh
cc -std=c99 -Wall -Wextra -Werror tools/chipquantum-basic-commands.c \
  tools/chipquantum-benchmark.c -o /tmp/chipquantum-benchmark && \
  /tmp/chipquantum-benchmark
```

The benchmark is intentionally separate from the default build.  It uses hosted
`stdio`/`time` only in the harness; the primitive source remains suitable for the
freestanding object check below.

## Real repository sensors

`tools/chipquantum-repo-sensors.py` loads live GitHub metadata into deterministic
ChipQuantum sensor frames.  It first verifies the requested ChipQuantum URL and
then loads the owner's six most recently created public repositories, mapping
each repository metadata payload through the same entropy, FNV-1a, CRC32, XOR,
42-orbit, and 7-lane torus formulas.

```sh
python3 tools/chipquantum-repo-sensors.py \
  --target-url https://github.com/rafaelmeloreisnovo/ChipQuantum/expansions \
  --owner rafaelmeloreisnovo \
  --limit 6 \
  --output /tmp/chipquantum-repo-sensors.json
```

During implementation, the public `ChipQuantum/expansions` URL returned `404 Not
Found` through the GitHub API, but the owner repository sensor path succeeded and
loaded the six most recently created public repositories available at that time:
`frida-desktop`, `UserLAnd2`, `IA_nist`, `termux-api_rafcodephi`,
`relativity-living-light`, and `RafPolimata`.

## Three-cycle use

1. **Basic-command cycle:** compile and execute the self-test on a hosted machine:

   ```sh
   cc -std=c99 -Wall -Wextra -Werror -DCQ_BASIC_COMMANDS_SELFTEST \
     tools/chipquantum-basic-commands.c -o /tmp/chipquantum-basic-commands && \
     /tmp/chipquantum-basic-commands
   ```

2. **Benchmark/sensor cycle:** run the C benchmark and the repository sensor
   loader shown above.  Treat a `404` from the requested target repository as an
   explicit unavailable-source sensor state, not as proof that the code exists.

3. **Freestanding evidence cycle:** compile the primitive file as an object
   without the hosted self-test entry point:

   ```sh
   cc -std=c99 -Wall -Wextra -Werror -ffreestanding -fno-builtin \
     -c tools/chipquantum-basic-commands.c -o /tmp/chipquantum-basic-commands.o
   ```

The textual guard can run without submodules or Meson:

```sh
python3 tools/validate-chipquantum-basic-commands.py
```

## Scope

This source is diagnostic glue, not a claim that the linked ChipQuantum
repository is vendored here.  No external source code is copied.  The C benchmark
and Python repository sensor loader are real source files that can produce local
measurements and live metadata evidence while keeping Frida's default desktop
build unchanged.

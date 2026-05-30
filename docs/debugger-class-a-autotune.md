# Debugger Class A heuristic autotuning module

`tools/frida-debugger-class-a-autotune.c` and
`tools/frida-debugger-class-a-autotune.h` provide an opt-in Debugger Class A
route-planning module for freestanding diagnostics.  The module does not change
Frida's default desktop build; it is a small source pair that can be compiled by
target experiments that already enable `-Ddebugger_class_a=true`.

## Contract

The core planner is designed for constrained runtimes:

- no heap allocation, no garbage collection, no recursion, and no syscalls;
- branchless fixed-route scoring in the core path, with no data-dependent loops;
- Q16 fixed-point reliability signals for stability, accuracy, friction,
  entropy, and overhead;
- morph-on-runtime route selection between generic, ARM32/NEON, cache-local, and
  rollback paths;
- FAILSAFE, FAILOVER, and ROLLBACK outputs represented as decision flags rather
  than hidden side effects;
- deterministic rollback token so a caller can correlate the previous route and
  the selected route without allocating state;
- a risk policy layer that clamps unstable or disallowed decisions to a
  known-good route with explicit FAILSAFE, FAILOVER, and ROLLBACK flags.

## Signals

`struct frida_dca_signal` carries the runtime-debugger evidence that would be
observed by a target-specific probe:

- `stability_q16` and `accuracy_q16` increase confidence in faster specialized
  paths;
- `friction_q16`, `entropy_q16`, and `overhead_q16` reduce confidence and push
  the planner toward safer routes;
- `fault_flags` make FAILSAFE/FAILOVER explicit;
- `arch_flags` let known architecture facts select ARM32/NEON or cache-local
  routes without runtime feature discovery;
- `cycle_budget` lets a low-budget cycle prefer the cache-local route.

The module deliberately avoids learning by allocating or persisting history.  A
caller can feed learned values back into the next `frida_dca_signal`, keeping the
core bare-metal friendly.

## Two-cycle validation

1. Compile and run the hosted self-test:

   ```sh
   cc -std=c99 -Wall -Wextra -Werror -DFRIDA_DCA_AUTOTUNE_SELFTEST \
     tools/frida-debugger-class-a-autotune.c -o /tmp/frida-dca-autotune && \
     /tmp/frida-dca-autotune
   ```

2. Compile the core as a freestanding object:

   ```sh
   cc -std=c99 -Wall -Wextra -Werror -ffreestanding -fno-builtin \
     -c tools/frida-debugger-class-a-autotune.c -o /tmp/frida-dca-autotune.o
   ```

The textual guard verifies the source/header/doc contract without Meson or
submodules:

```sh
python3 tools/validate-debugger-class-a-autotune.py
```

## Risk mitigation policy

`struct frida_dca_risk_policy` is the explicit enterprise guardrail around the
planner.  It defines minimum stability, minimum accuracy, maximum friction,
maximum entropy, maximum overhead, minimum confidence, allowed route bits, and a
known-good route.  `frida_dca_mitigate()` evaluates that policy without heap
allocation and returns both the selected decision and the risk bits that forced
mitigation.

The mitigation path is intentionally conservative: when a policy risk is active,
the decision is clamped to the known-good route, FAILSAFE/FAILOVER/ROLLBACK are
set together, and the rollback token is mixed with the previous decision token.
This gives callers a deterministic rollback handshake without hidden state,
locks, syscalls, or garbage collection.

## Failure semantics

- **FAILSAFE** means at least one mitigation bit is active, so the caller should
  reduce debugger friction before trusting fast-path evidence.
- **FAILOVER** means the module has produced a replacement decision while
  preserving a rollback token.
- **ROLLBACK** forces a caller-provided known-good route when the current route
  is unstable, inaccurate, too expensive, or operationally misaligned.

These semantics are intentionally explicit: the module computes decisions only;
the caller decides when to patch, trace, or disable a runtime path.

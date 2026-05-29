# Freestanding diagnostic profile

This repository is primarily a hosted desktop build.  The freestanding profile is
therefore intentionally opt-in and non-invasive: the default build remains the
same, while `-Dfreestanding_profile=true` selects a constrained diagnostic shape
that downstream targets can use as the first step toward no-malloc, no-heap,
no-GC, bare-metal style validation.

## Contract

When `freestanding_profile` is enabled, the top-level build file:

- defines `FRIDA_FREESTANDING_PROFILE=1` for C sources;
- adds `-ffreestanding` and `-fno-builtin` when the active C compiler supports them;
- disables GumJS (`gumjs=disabled`) so the JavaScript/GC runtime layer is not
  selected by this profile;
- disables graft, gadget, server, portal, and injector products at the top
  level;
- skips hosted language/tooling layers such as .NET, Node.js, Python, Swift,
  QML, and CLI tools.

The separate `debugger_class_a` option defines `FRIDA_DEBUGGER_CLASS_A=1`.  It is
kept independent so strict debugger diagnostics can be enabled without changing
the default desktop build or forcing the freestanding profile.

## Scope and non-goals

This profile does not claim that every transitive subproject is already
bare-metal safe.  In particular, eliminating every allocator, heap dependency,
system call, or runtime service must be proven inside the relevant subprojects
and target platform code.  The top-level repository can only provide a safe
selector that removes the obvious hosted/GC layers and exposes compile-time
macros for downstream enforcement.

## Two-cycle validation loop

Use two feedback cycles before promoting a target:

1. **Configuration cycle:** run Meson with the profile enabled and verify that
   only the expected subprojects/components are configured.
2. **Evidence cycle:** run the target-specific symbol, syscall, and allocator
   checks for the produced binaries.  Treat missing evidence as `SKIPPED`, not
   as success.

The helper below validates the top-level contract without requiring submodules:

```sh
python3 tools/validate-freestanding-profile.py
```

## Example configuration

```sh
./configure -Dfreestanding_profile=true -Ddebugger_class_a=true
```

For a hosted desktop build, omit both options; defaults are intentionally
unchanged.

# Android runtime stability dump

## Purpose

`agents/android-runtime-stability-dump.js` is a passive Frida sensor for
authorized Android processes. It emits a structural runtime dump suitable for:

- recognizing the platform/build surface;
- recognizing the loaded-module surface;
- comparing two executions;
- detecting platform drift separately from module/lazy-load drift and ordinary
  runtime drift;
- attaching a neutral context packet to crash, performance or compatibility
  investigations.

It does **not** decide that a process is stable or unstable. A snapshot is
evidence, not a causal conclusion.

## Feedback loop

```text
COLLECT
  -> NORMALIZE
  -> DUMP
  -> COMPARE
  -> DELTA
  -> HYPOTHESIS / TOKEN_VAZIO
  -> NEXT OBSERVABLE TEST
  -> NEW DUMP
```

This is the intended retroalimentacao loop. Nothing is silently promoted from
a changed value to a bug.

## Semantic separation

### Platform identity

Used to recognize whether two dumps belong to the same technical platform
surface:

- architecture;
- pointer size;
- page size;
- platform;
- Android/ART build identity when Java is available.

This produces `platform_key`.

### Module recognition surface

The loaded module **name + size** set produces `module_surface_key`.

It is deliberately separate from platform identity because legitimate lazy
loading may add/remove modules without changing firmware, ABI or logical
application identity.

The combined `recognition_key` is useful for exact surface matching, but a
module-only mismatch is classified as `MODULE_SURFACE_DRIFT`, not
`IDENTITY_DRIFT`.

ASLR module bases are never included in recognition hashes. The compact FNV-1a 32-bit fingerprints are convenience hints only; comparison of the authoritative module surface uses the full `name + size` projection so a hash collision cannot hide module drift.

### Volatile runtime state

Useful for stability and drift analysis, but expected to change:

- PID and current TID;
- module load bases;
- thread count and state distribution;
- readable/writable/executable range counts and bytes;
- Java/native heap counters;
- device elapsed time.

A change here is `RUNTIME_DRIFT`, not automatically a defect.

### TOKEN_VAZIO

The dump explicitly refuses to infer:

- LMKD kill reason;
- SELinux causality;
- physical memory pressure;
- crash causality.

Those require independent sources.

## Privacy boundary

The agent does not collect:

- device serial or Android ID;
- SIM/subscriber identifiers;
- application payload bytes;
- clipboard/UI text;
- file contents;
- credentials;
- module paths.

The process name is not collected.

## Frida use

Load the agent normally:

```sh
frida -U -n <authorized-process> -l agents/android-runtime-stability-dump.js
```

The agent emits one `RUNTIME_STABILITY_DUMP` on load.

A controller may request later snapshots through the RPC export:

```text
snapshot(reason)
```

Periodic polling is deliberately not built into V1; the controller decides
when a new observation is materially useful.


## Append-only dump file

For a local Gadget endpoint in Termux, the controller can capture the initial
sanitized agent snapshot directly into an append-only file:

```sh
python3 tools/capture-runtime-stability-dump.py \
  --endpoint 127.0.0.1:27042 \
  --process Gadget
```

The default destination is:

```text
~/.local/state/rafaelia/frida-runtime-stability/
  runtime-stability-<UTC>.json
  runtime-stability-<UTC>.json.sha256
```

Files are created with mode `0600`, never overwritten, flushed with `fsync`,
and accompanied by SHA-256. The process name or PID supplied only to locate the
authorized target is not persisted by the controller as identity metadata.

The file is intentionally a neutral observation packet. It can be attached to
a crash, performance, compatibility or HyperMemory investigation without
claiming that any observed drift caused a failure.

## Comparison

Save two emitted dump objects as JSON and run:

```sh
python3 tools/runtime-stability-diff.py baseline.json candidate.json
```

Possible classifications:

- `NO_OBSERVED_DRIFT`
- `RUNTIME_DRIFT`
- `MODULE_SURFACE_DRIFT`
- `IDENTITY_DRIFT`

None of these establishes root cause.

## HyperMemory bridge

The dump is intentionally compatible with a later HyperMemory causal tail:

```text
runtime dump
  -> platform key / module-surface key
  -> HyperMemory event
  -> crash/performance event
  -> successor dump
  -> semantic delta
```

This lets the system ask a better question than "did the app crash?":

> Which structural or runtime dimensions changed before the observed failure?

## Evidence boundary

Hosted CI can prove syntax, contract shape, comparator behavior and privacy
guards. It cannot prove device behavior.

```text
FRIDA_DEVICE_EXECUTION = TOKEN_VAZIO
PHYSICAL_STABILITY     = TOKEN_VAZIO
CAUSAL_ATTRIBUTION     = TOKEN_VAZIO
claim_allowed          = false
```

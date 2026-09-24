# Android runtime stability dump

## Purpose

`agents/android-runtime-stability-dump.js` is a passive Frida sensor for
authorized Android processes. It emits a structural runtime dump suitable for:

- recognizing the runtime/build/module surface;
- comparing two executions;
- detecting identity drift separately from ordinary runtime drift;
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

### Stable identity

Used to recognize whether two dumps belong to the same technical runtime
surface:

- architecture;
- pointer size;
- page size;
- platform;
- loaded module **name + size** set fingerprint;
- Android/ART build identity when Java is available.

ASLR module bases are deliberately excluded from the recognition key.

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

The process name, when available, is reduced to a short non-reversible tag.

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

## Comparison

Save two emitted dump objects as JSON and run:

```sh
python3 tools/runtime-stability-diff.py baseline.json candidate.json
```

Possible classifications:

- `NO_OBSERVED_DRIFT`
- `RUNTIME_DRIFT`
- `IDENTITY_DRIFT`

None of these establishes root cause.

## HyperMemory bridge

The dump is intentionally compatible with a later HyperMemory causal tail:

```text
runtime dump
  -> recognition key
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

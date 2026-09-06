# Android crash observability spine

This layer turns the existing runtime stability work into a crash-focused debugger surface. It is deliberately split into an in-process Frida sensor and an out-of-process ADB sensor because one attached Frida agent does not observe the internals of every Android process.

## Invariant

```text
absence of evidence != absence of crash
unavailable surface -> TOKEN_VAZIO
observed event -> evidence, not automatic causality
```

The implementation is payload-blind by default. Keyboard content, clipboard data, UI text, URLs, network payloads, credentials, headers and application databases are outside scope.

## Components

- `agents/android-crash-observer.js`: native and Java fatal-boundary observer for an authorized attached process.
- `tools/frida-runtime-crash-observer.{h,c}`: fixed-capacity metadata ring and chained integrity record.
- `tools/android-crash-spine.sh`: ADB event-buffer collector for crash/ANR/process-death boundaries.
- `profiles/android-crash-observability.v1.json`: machine-readable evidence/privacy contract.

## Coverage matrix

| Surface | Route | State before device receipt |
| --- | --- | --- |
| Native exception in attached process | Frida `Process.setExceptionHandler()` | WIRED / runtime `TOKEN_VAZIO` |
| Java uncaught exception in attached ART process | `ThreadGroup.uncaughtException` observation | WIRED / runtime `TOKEN_VAZIO` |
| ChatGPT process crash/ANR | ADB events; optional authorized Frida session | WIRED / package discovered at runtime |
| Chrome/Chromium crash/ANR | ADB events; optional session per process | WIRED / package discovered at runtime |
| WebView renderer death | Android process/event boundary; owned-app callback may add evidence | PARTIAL / callback wiring `TOKEN_VAZIO` |
| Default keyboard/IME death | resolve `default_input_method`; observe death/ANR only | WIRED / content capture forbidden |
| Low-memory kill | Android exit/event reason when available | PARTIAL / device capability dependent |
| `system_server` watchdog internals | privileged Android surface | `TOKEN_VAZIO[PRIVILEGE_DEPENDENT]` |
| tombstones | privileged Android surface or explicit crash-buffer stack mode | `TOKEN_VAZIO[PRIVILEGE_DEPENDENT]` |
| kernel pstore/ramoops | privileged kernel surface | `TOKEN_VAZIO[PRIVILEGE_DEPENDENT]` |

## Why two observers are required

Frida provides a process-wide native exception handler inside the process to which the agent is attached. Returning `false` from the new agent means the exception is not swallowed or repaired: the normal application/OS crash path continues. Java fatal events are likewise observed and forwarded to the original `ThreadGroup` implementation.

Android itself supplies cross-process lifecycle evidence outside that process. The ADB spine listens only to the event tags relevant to crash, ANR, kill, process death and low-memory boundaries by default. `--stacks` is explicit opt-in because crash-buffer stacks can contain human-readable exception context.

## Usage

Metadata-only live capture:

```sh
sh tools/android-crash-spine.sh --out ./crash-evidence
```

One-time event-buffer snapshot:

```sh
sh tools/android-crash-spine.sh --snapshot --out ./crash-evidence
```

Explicit stack capture:

```sh
sh tools/android-crash-spine.sh --stacks --out ./crash-evidence
```

Attach `agents/android-crash-observer.js` only to processes you are authorized to debug. The agent intentionally contains no hooks for key events, EditText content, clipboard, HTTP payload, TLS plaintext or application storage.

## Evidence ladder

```text
SOURCE_OBSERVED
  -> WIRED
  -> BUILD_PROVEN
  -> RUNTIME_PROVEN
  -> DEVICE_PROVEN
  -> REPRODUCED
```

Repository code and CI may establish `WIRED` and `BUILD_PROVEN`. They cannot establish `DEVICE_PROVEN` for ChatGPT, Chrome, an IME, or Android system services without an actual authorized device run and receipt.

Android 11+ also exposes historical application process exit reasons through `ApplicationExitInfo` / `ActivityManager.getHistoricalProcessExitReasons()`. That route is valuable for owned application code because it can distinguish crash, ANR and memory-related exits after restart. It is not treated here as a universal cross-application oracle.

## Receipt minimum

A device receipt should preserve, append-only:

1. UTC and monotonic timestamps;
2. Android SDK and ABI list;
3. resolved target package/process identity or non-reversible tag;
4. source (`FRIDA_NATIVE`, `FRIDA_JAVA`, `ADB_EVENTS`, optional `ADB_CRASH`);
5. event kind and exit/signal status;
6. PID/TID when available;
7. PC/SP/fault address for native exceptions when available;
8. chained record hash;
9. explicit `TOKEN_VAZIO` entries for inaccessible surfaces;
10. reproduction status and exact next verifiable step.

A crash observed once is an event. A cause remains a hypothesis until reproduction or independent evidence closes the gap.

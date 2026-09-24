# HyperMemory Runtime V1

## Intent

Provide a bounded, auditable runtime-memory layer for Frida/RAFAELIA debugging that preserves the **last valid runtime state** across process restarts without claiming that an Android process can be made immortal.

The design intentionally separates:

`RAM HOT arena != checkpoint != Android process survival != Frida attachment != evidence`.

## V1 execution model

```text
Frida/runtime events
      |
      v
HOT: bounded RAM ring
      |
      +--> atomic checkpoint (warm state)
      |        |
      |        +--> integrity SHA-256
      |        +--> corruption quarantine
      |
      v
restart -> restore last valid checkpoint -> debugger/runtime continues
```

Implementation: `modules/runtime-learning-engine/hypermemory-runtime.ts`.

### HOT

- Bounded RAM resident record ring.
- Capacity is explicit.
- Oldest records are evicted under pressure.
- Each payload receives SHA-256.
- Oversized individual records are rejected rather than silently truncated.

### WARM

- Atomic file checkpoint using temporary-file + fsync + rename.
- Whole-checkpoint SHA-256 protects the serialized state.
- Corrupt checkpoints are quarantined append-only and are never interpreted as valid memory.
- Restart restoration is deterministic for the stored records.

### Android boundary

This V1 does **not** claim to stop Android from killing an application.

Important lifecycle cases:

| Event | HOT RAM | Checkpoint | Recovery |
|---|---|---|---|
| Activity leaves foreground | process-dependent | preserved | available |
| ordinary process death / LMKD | lost | preserved | restore after restart |
| app crash | lost | preserved to last checkpoint | restore after restart |
| device reboot | lost | preserved if filesystem survives | restore after relaunch |
| user/system force-stop | lost | preserved | app cannot self-restart until Android permits an explicit launch |
| storage corruption | not authority | quarantined | fresh arena, fail-closed |

Therefore:

`PROCESS_KILL != MEMORY_HISTORY_LOSS`

when a valid checkpoint exists, but:

`CHECKPOINT_RESTORE != PROCESS_IMMORTALITY`.

## Frida relation

Embedded Frida Gadget shares the lifetime of the instrumented program. A separate Frida controller/server can outlive the target process and is the correct place for a future reattach/relaunch supervisor.

A physical Android supervisor remains:

`TOKEN_VAZIO_NOT_PROVEN`

until a real-device receipt demonstrates restart + reattach + restore under declared conditions.

## P1 physical candidate

A later Android gate may add a privileged or user-authorized supervisor with all of these boundaries:

1. observe target PID/package;
2. capture a final checkpoint when possible;
3. detect target disappearance;
4. relaunch only when explicitly configured and authorized;
5. reattach Frida;
6. restore HyperMemory state;
7. emit a receipt containing old PID, new PID, checkpoint identity, restore result and elapsed recovery time.

No V1 code modifies `lmkd`, `oom_score_adj`, SELinux, kernel memory policy, or Android force-stop semantics.

## Evidence boundary

Hosted TypeScript tests can prove:

- bounded-memory behavior;
- deterministic checkpoint/restore;
- integrity rejection;
- corruption quarantine.

They cannot prove:

- Android physical survivability;
- reduced LMKD kill rate;
- foreground-service behavior;
- root/Termux relaunch authority;
- Frida reattach latency.

Those remain physical-device gates.

## API sketch

```ts
const memory = new HyperMemoryRuntime({
  storagePath: '/data/local/tmp/frida-learning',
  capacityBytes: 4 * 1024 * 1024,
  checkpointIntervalMs: 15000
});

await memory.start();
memory.appendJson('debug-state', { pid, state: 'OBSERVE' });
memory.append('trace-tail', traceBytes);
memory.checkpoint();

// after restart
const restored = memory.readRecords();
```

## Claim gate

`claim_allowed=false` for Android anti-kill behavior until physical evidence exists.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HyperMemoryRuntime } from '../hypermemory-runtime';
import { RuntimeStabilityHyperMemoryBridge } from '../runtime-stability-hypermemory-bridge';

describe('RuntimeStabilityHyperMemoryBridge', () => {
  let storagePath: string;
  let memory: HyperMemoryRuntime;
  let bridge: RuntimeStabilityHyperMemoryBridge;

  beforeEach(async () => {
    storagePath = fs.mkdtempSync(path.join(os.tmpdir(), 'frida-stability-bridge-'));
    memory = new HyperMemoryRuntime({
      storagePath,
      capacityBytes: 16384,
      checkpointIntervalMs: 0
    });
    await memory.start();
    bridge = new RuntimeStabilityHyperMemoryBridge(memory);
  });

  afterEach(async () => {
    await memory.stop();
    fs.rmSync(storagePath, { recursive: true, force: true });
  });

  test('stores a minimized stability dump without raw module names or Java identity', () => {
    bridge.appendDump({
      schema: 'rafaelia.android.runtime-stability/v1',
      capture_seq: 7,
      reason: 'BEFORE_CRASH',
      captured_epoch_ms: 123456,
      platform_key: 'plat',
      module_surface_key: 'mods',
      recognition_key: 'rec',
      stable_identity: {
        arch: 'arm',
        pointer_size: 4,
        page_size: 4096,
        platform: 'linux'
      },
      runtime_state: {
        pid: 42,
        current_tid: 43,
        debugger_attached: true,
        modules: { count: 91 },
        threads: { count: 17 }
      },
      gaps: {
        crash_causality: 'TOKEN_VAZIO',
        safe_value: 'OBSERVED'
      }
    });

    const record = memory.readRecords(1)[0];
    const payload = JSON.parse(record.payload.toString('utf8'));
    const encoded = JSON.stringify(payload);

    expect(payload.event_kind).toBe('STABILITY_DUMP');
    expect(payload.previous_payload_sha256).toBe('GENESIS');
    expect(payload.payload.runtime_state.module_count).toBe(91);
    expect(payload.payload.unresolved_gap_keys).toEqual(['crash_causality']);
    expect(encoded).not.toContain('libfoo');
    expect(encoded).not.toContain('build_fingerprint');
    expect(encoded).not.toContain('java_identity');
    expect(payload.claim_allowed).toBe(false);
  });

  test('links successor envelopes by prior HyperMemory payload SHA-256', () => {
    bridge.appendDiff({
      schema: 'rafaelia.android.runtime-stability-diff/v1',
      classification: 'RUNTIME_DRIFT',
      platform_identity_match: true,
      module_surface_match: true,
      recognition_match: true,
      runtime_changes: [{ path: 'runtime_state.threads.count' }]
    });

    const first = memory.readRecords(1)[0];

    bridge.appendOutcome({
      timestamp: 222,
      layer: 'NATIVE_ELF',
      event_type: 'SIGSEGV',
      source: 'tombstone',
      process_generation: 3,
      thread_id: 77,
      evidence_ref: 'receipt://tombstone/abc'
    });

    const second = memory.readRecords(1)[0];
    const secondPayload = JSON.parse(second.payload.toString('utf8'));

    expect(secondPayload.previous_payload_sha256).toBe(first.sha256);
    expect(secondPayload.event_kind).toBe('OUTCOME');
    expect(secondPayload.payload.causal_role).toBe('OBSERVATION_ONLY');
  });

  test('stores change paths but not before/after values from a diff', () => {
    bridge.appendDiff({
      schema: 'rafaelia.android.runtime-stability-diff/v1',
      classification: 'MODULE_SURFACE_DRIFT',
      module_surface_changes: [
        { path: 'runtime_state.modules.modules[name,size]' }
      ],
      runtime_changes: [
        { path: 'runtime_state.java_runtime.java_heap_total_bytes' }
      ]
    });

    const payload = JSON.parse(memory.readRecords(1)[0].payload.toString('utf8'));
    expect(payload.payload.module_surface_change_paths).toEqual([
      'runtime_state.modules.modules[name,size]'
    ]);
    expect(payload.payload.runtime_change_paths).toEqual([
      'runtime_state.java_runtime.java_heap_total_bytes'
    ]);
    expect(payload.payload.causality).toBe('NOT_INFERRED');
  });

  test('fails closed on unsupported schemas and malformed outcomes', () => {
    expect(() => bridge.appendDump({ schema: 'unknown' })).toThrow(/unsupported/);
    expect(() => bridge.appendDiff({ schema: 'unknown' })).toThrow(/unsupported/);
    expect(() =>
      bridge.appendOutcome({
        timestamp: -1,
        layer: 'UNKNOWN',
        event_type: '',
        source: ''
      })
    ).toThrow(/timestamp/);
  });
});

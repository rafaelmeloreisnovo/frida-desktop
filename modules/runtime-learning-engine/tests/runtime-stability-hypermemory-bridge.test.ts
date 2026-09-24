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
      capacityBytes: 128 * 1024,
      checkpointIntervalMs: 0
    });
    await memory.start();
    bridge = new RuntimeStabilityHyperMemoryBridge(memory);
  });

  afterEach(async () => {
    await memory.stop();
    fs.rmSync(storagePath, { recursive: true, force: true });
  });

  test('projects a V2 dump without embedding the full module list', () => {
    const sequence = bridge.appendDump({
      schema: 'rafaelia.android.runtime-stability/v2',
      claim_allowed: false,
      capture_seq: 7,
      reason: 'BASELINE',
      instrumentation_identity: {
        frida_version: '17.0.0',
        script_runtime: 'QJS'
      },
      stable_identity: { arch: 'arm', pointer_size: 4 },
      visibility: { modules: 'PASS', threads: 'PASS' },
      platform_key_hint: 'abcd',
      module_surface_key_hint: 'efgh',
      recognition_key_hint: 'ijkl',
      runtime_state: {
        pid: 123,
        current_tid: 124,
        modules: {
          count: 2,
          modules: [
            { name: 'liba.so', size: 4096, base: '0x1000' },
            { name: 'libb.so', size: 8192, base: '0x2000' }
          ]
        },
        threads: { count: 3, states: { waiting: 3 } },
        memory_ranges: { status: 'PASS' },
        java_runtime: { java_heap_total_bytes: 100 },
        observer: { frida_heap_size_bytes: 50 }
      },
      timing: { wall_duration_ms: 4 },
      gaps: { crash_causality: 'TOKEN_VAZIO' }
    }, {
      sourceSha256: 'a'.repeat(64)
    });

    expect(sequence).toBe(1);
    const payload = JSON.parse(memory.readRecords(1)[0].payload.toString('utf8'));
    expect(payload.event_kind).toBe('STABILITY_DUMP');
    expect(payload.claim_allowed).toBe(false);
    expect(payload.causality).toBe('NOT_INFERRED');
    expect(payload.recognition.module_count).toBe(2);
    expect(payload.full_module_list_embedded).toBe(false);
    expect(JSON.stringify(payload)).not.toContain('liba.so');
  });

  test('projects diff paths without promoting causality', () => {
    bridge.appendDiff({
      schema: 'rafaelia.android.runtime-stability-diff/v2',
      claim_allowed: false,
      classification: 'MODULE_SURFACE_DRIFT',
      comparable: true,
      recognition_match: false,
      module_surface_changes: [
        { path: 'runtime_state.modules.modules[name,size]', before: [], after: [] }
      ],
      runtime_changes: [
        { path: 'runtime_state.threads.count', before: 3, after: 4 }
      ],
      excluded_from_classification: ['ASLR module bases']
    });

    const payload = JSON.parse(memory.readRecords(1)[0].payload.toString('utf8'));
    expect(payload.event_kind).toBe('STABILITY_DIFF');
    expect(payload.change_paths.modules).toEqual([
      'runtime_state.modules.modules[name,size]'
    ]);
    expect(payload.change_paths.runtime).toEqual([
      'runtime_state.threads.count'
    ]);
    expect(payload.causality).toBe('NOT_INFERRED');
    expect(payload.claim_allowed).toBe(false);
  });

  test('fails closed on unsupported schemas and invalid claim boundaries', () => {
    expect(() => bridge.appendDump({
      schema: 'rafaelia.android.runtime-stability/v1',
      claim_allowed: false
    })).toThrow(/unsupported/);

    expect(() => bridge.appendDiff({
      schema: 'rafaelia.android.runtime-stability-diff/v2',
      claim_allowed: true
    })).toThrow(/claim_allowed=false/);

    expect(() => bridge.appendDump({
      schema: 'rafaelia.android.runtime-stability/v2',
      claim_allowed: false,
      runtime_state: { modules: {}, threads: {} }
    }, {
      sourceSha256: 'not-a-hash'
    })).toThrow(/sourceSha256/);
  });
});

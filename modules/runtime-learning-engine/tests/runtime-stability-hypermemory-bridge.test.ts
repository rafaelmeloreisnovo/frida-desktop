import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HyperMemoryRuntime } from '../hypermemory-runtime';
import { RuntimeStabilityHyperMemoryBridge } from '../runtime-stability-hypermemory-bridge';

describe('RuntimeStabilityHyperMemoryBridge V2', () => {
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

  const dump = () => ({
    schema: 'rafaelia.android.runtime-stability/v2',
    claim_allowed: false,
    capture_seq: 7,
    reason: 'BASELINE',
    capture_provenance: { condition_id: 'idle-v1' },
    instrumentation_identity: {
      frida_version: '17.0.0',
      script_runtime: 'QJS'
    },
    stable_identity: {
      arch: 'arm',
      pointer_size: 4,
      page_size: 4096,
      platform: 'linux',
      java_available: true,
      java_identity: {
        build_fingerprint: 'PRIVATE-BUILD-IDENTITY-MUST-NOT-BRIDGE'
      }
    },
    visibility: { modules: 'PASS', threads: 'PASS' },
    consistency: {
      snapshot_atomic: false,
      module_surface_stable_during_capture: true
    },
    platform_key_hint: 'abcd',
    module_surface_key_hint: 'efgh',
    recognition_key_hint: 'ijkl',
    platform_context: { boot_session_sha256: 'b'.repeat(64) },
    runtime_state: {
      pid: 123,
      current_tid: 124,
      debugger_attached: true,
      modules: {
        count: 2,
        modules: [
          { name: 'liba.so', size: 4096, base: '0x1000' },
          { name: 'libb.so', size: 8192, base: '0x2000' }
        ]
      },
      threads: { count: 3, states: { waiting: 3 } },
      memory_ranges: { status: 'PASS', total_ranges: 5 },
      java_runtime: {
        process_start_elapsed_ms: 100,
        process_age_ms: 25,
        process_pss_kb: 1024,
        native_heap_allocated_bytes: 2048
      }
    },
    gaps: { crash_causality: 'TOKEN_VAZIO' }
  });

  test('projects V2 dump without raw modules or Java build identity', () => {
    const sequence = bridge.appendDump(dump(), {
      sourceSha256: 'a'.repeat(64)
    });

    expect(sequence).toBe(1);
    const record = memory.readRecords(1)[0];
    const envelope = JSON.parse(record.payload.toString('utf8'));
    const encoded = JSON.stringify(envelope);

    expect(envelope.event_kind).toBe('STABILITY_DUMP');
    expect(envelope.source_sha256).toBe('a'.repeat(64));
    expect(envelope.payload.condition_id).toBe('idle-v1');
    expect(envelope.payload.recognition.module_count).toBe(2);
    expect(envelope.payload.raw_module_list_embedded).toBe(false);
    expect(envelope.payload.java_build_identity_embedded).toBe(false);
    expect(encoded).not.toContain('liba.so');
    expect(encoded).not.toContain('PRIVATE-BUILD-IDENTITY');
    expect(envelope.claim_allowed).toBe(false);
  });

  test('projects diff paths without before/after values or causal promotion', () => {
    bridge.appendDiff({
      schema: 'rafaelia.android.runtime-stability-diff/v2',
      claim_allowed: false,
      classification: 'MODULE_SURFACE_DRIFT',
      comparison_status: 'COMPARABLE',
      comparable: true,
      condition_id: 'idle-v1',
      recognition_match: false,
      module_surface_changes: [{
        path: 'runtime_state.modules.modules[name,size]',
        before: [{ name: 'secret-before' }],
        after: [{ name: 'secret-after' }]
      }],
      runtime_changes: [{
        path: 'runtime_state.threads.count',
        before: 3,
        after: 4
      }]
    }, { sourceSha256: 'c'.repeat(64) });

    const envelope = JSON.parse(
      memory.readRecords(1)[0].payload.toString('utf8')
    );
    const encoded = JSON.stringify(envelope);

    expect(envelope.payload.change_paths.modules).toEqual([
      'runtime_state.modules.modules[name,size]'
    ]);
    expect(envelope.payload.before_after_values_embedded).toBe(false);
    expect(encoded).not.toContain('secret-before');
    expect(encoded).not.toContain('secret-after');
    expect(envelope.payload.causality).toBe('NOT_INFERRED');
  });

  test('links causal-tail envelopes and records outcomes as observations only', () => {
    bridge.appendDump(dump());
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

    const records = memory.readRecords();
    const second = records[records.length - 1];
    const envelope = JSON.parse(second.payload.toString('utf8'));

    expect(envelope.previous_payload_sha256).toBe(first.sha256);
    expect(envelope.event_kind).toBe('OUTCOME');
    expect(envelope.payload.causal_role).toBe('OBSERVATION_ONLY');
    expect(envelope.claim_allowed).toBe(false);
  });

  test('marks predecessor unknown after causal-tail eviction', () => {
    const tiny = new HyperMemoryRuntime({
      storagePath: storagePath + '-tiny',
      capacityBytes: 4096,
      checkpointIntervalMs: 0
    });

    return tiny.start().then(async () => {
      const tinyBridge = new RuntimeStabilityHyperMemoryBridge(tiny);
      tinyBridge.appendOutcome({
        timestamp: 1,
        layer: 'PROCESS',
        event_type: 'START',
        source: 'lifecycle'
      });
      for (let i = 0; i < 16; i++) {
        tiny.append('noise', 'x'.repeat(700));
      }
      tinyBridge.appendOutcome({
        timestamp: 2,
        layer: 'PROCESS',
        event_type: 'RESTART',
        source: 'lifecycle'
      });

      const records = tiny.readRecords();
      const envelope = JSON.parse(
        records[records.length - 1].payload.toString('utf8')
      );
      expect(envelope.previous_payload_sha256).toBe(
        'TOKEN_VAZIO_EVICTED_PREDECESSOR'
      );
      await tiny.stop();
      fs.rmSync(storagePath + '-tiny', { recursive: true, force: true });
    });
  });

  test('fails closed on schema, claim boundary and malformed source hash', () => {
    expect(() => bridge.appendDump({
      schema: 'rafaelia.android.runtime-stability/v1',
      claim_allowed: false
    })).toThrow(/unsupported/);

    expect(() => bridge.appendDiff({
      schema: 'rafaelia.android.runtime-stability-diff/v2',
      claim_allowed: true
    })).toThrow(/claim_allowed=false/);

    expect(() => bridge.appendDump(dump(), {
      sourceSha256: 'not-a-hash'
    })).toThrow(/sourceSha256/);
  });

  test('rejects malformed outcome independently of dump schemas', () => {
    expect(() => bridge.appendOutcome({
      timestamp: -1,
      layer: 'UNKNOWN',
      event_type: '',
      source: ''
    })).toThrow(/timestamp/);
  });
});

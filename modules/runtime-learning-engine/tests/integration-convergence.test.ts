import * as fs from 'fs';
import * as path from 'path';
import { AutoFixerImpl } from '../auto-fixer';
import { BugStoreImpl } from '../bug-store';
import { RollbackEngineImpl } from '../rollback-engine';
import { RuntimeSafetyMesh } from '../runtime-safety-mesh';
import { BugPattern, RollbackJournal } from '../types';

describe('Runtime integration convergence', () => {
  const root = '/tmp/runtime-integration-convergence';

  beforeEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    delete (global as any).Java;
    delete (global as any).Memory;
    delete (global as any).ptr;
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('reversible Frida hook fix is bound to fix_id and restored by rollbackFix', async () => {
    const originalImplementation = function original() {
      return 'original';
    };
    const overload: any = {
      implementation: originalImplementation,
      returnType: { className: 'java.lang.String' },
      argumentTypes: [],
      apply: () => 'original'
    };
    const targetClass: any = {
      $methods: ['foo-()'],
      foo: { overloads: [overload] }
    };
    (global as any).Java = {
      use: () => targetClass
    };

    const pattern: BugPattern = {
      pattern_id: 'pat_test',
      bug_type: 'crash',
      class: 'com.example.Target',
      method: 'foo',
      exception_type: 'RuntimeException',
      occurrences: 3,
      confidence: 0.9,
      last_seen: Date.now(),
      suggested_fix: 'wrap',
      fix_strategy: 'try_catch_with_fallback'
    };

    const fixer = new AutoFixerImpl();
    const event = await fixer.applyFix(pattern);

    expect(event.status).toBe('applied');
    expect(event.rollback_capability).toBe('hook_restore');
    expect(fixer.canRollbackFix(event.fix_id)).toBe(true);
    expect(overload.implementation).not.toBe(originalImplementation);

    await expect(fixer.rollbackFix(event.fix_id)).resolves.toBe(true);
    expect(overload.implementation).toBe(originalImplementation);
    expect(fixer.canRollbackFix(event.fix_id)).toBe(false);
  });

  test('raw memory rollback verification fails closed when Frida Memory API is absent', async () => {
    const rollback = new RollbackEngineImpl(root);
    const journal: RollbackJournal = {
      journal_id: 'journal_test',
      timestamp: Date.now(),
      fix_id: 'fix_test',
      original_bytes: new Uint8Array([1, 2, 3]),
      target_address: 0x1000,
      size: 3,
      checksum_before: 'abc'
    };

    await expect(rollback.verifyRollback(journal)).resolves.toBe(false);
    await expect(rollback.rollback(journal)).resolves.toBe(false);
  });

  test('corrupted bug history is quarantined instead of silently overwritten', async () => {
    const history = path.join(root, 'bug-history.json');
    fs.writeFileSync(history, '{"events":[', 'utf-8');

    const store = new BugStoreImpl(root, 16);
    const loaded = await store.loadHistory();

    expect(loaded.events).toHaveLength(0);
    expect(fs.existsSync(history)).toBe(false);

    const quarantined = fs.readdirSync(root).filter(name => /^bug-history\.corrupt\.\d+\.json$/.test(name));
    expect(quarantined).toHaveLength(1);
    expect(fs.existsSync(path.join(root, `${quarantined[0]}.meta.json`))).toBe(true);
  });

  test('safety mesh classifies simulation-only concurrency separately from operational observers', () => {
    const registry = new RuntimeSafetyMesh(root).getIntegrationRegistry();
    const concurrency = registry.find(item => item.component === 'ConcurrentBugCaptureHandler');
    const memory = registry.find(item => item.component === 'MemoryPressureHandler');

    expect(concurrency?.evidence).toBe('TEST_HARNESS_ONLY');
    expect(memory?.evidence).toBe('OPERATIONAL');
  });

  test('safety snapshot keeps physical device evidence and claims closed', () => {
    const snapshot = new RuntimeSafetyMesh(root).snapshot(false, 'STABLE');
    expect(snapshot.physical_device_smoke).toBe('TOKEN_VAZIO');
    expect(snapshot.device_runtime_verified).toBe(false);
    expect(snapshot.claim_allowed).toBe(false);
  });
});

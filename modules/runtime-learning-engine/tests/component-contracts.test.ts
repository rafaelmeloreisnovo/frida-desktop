import * as fs from 'fs';
import { BugStoreImpl } from '../bug-store';
import { PatternDetectorImpl } from '../pattern-detector';
import { RollbackEngineImpl } from '../rollback-engine';
import { WatchdogMonitorImpl } from '../watchdog-monitor';
import { TestSuiteImpl } from '../test-suite';
import { BugEvent, FixEvent } from '../types';
import { calculateFNV1a64 } from '../utils';

const root = '/tmp/runtime-component-contracts';

function bug(id: string, index: number, bugType: BugEvent['bug_type'] = 'crash'): BugEvent {
  return {
    id,
    timestamp: 1_700_000_000_000 + index,
    bug_type: bugType,
    class: 'com.example.Target',
    method: 'work',
    exception_type: 'NullPointerException',
    stack_hash: `stack-${index}`,
    severity: 'high',
    status: 'new'
  };
}

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  delete (globalThis as any).Memory;
  delete (globalThis as any).ptr;
  delete (globalThis as any).Java;
  jest.useRealTimers();
});

describe('BugStore executable contracts', () => {
  test('circular buffer keeps exactly the configured newest events', async () => {
    const store = new BugStoreImpl(root, 3);
    for (let i = 0; i < 4; i++) await store.appendEvent(bug(`e${i}`, i));

    const history = await store.loadHistory();
    expect(history.events.map(event => event.id)).toEqual(['e1', 'e2', 'e3']);
  });

  test('persisted integrity hash is derived from the stored structural summary', async () => {
    const store = new BugStoreImpl(root, 3);
    await store.appendEvent(bug('integrity-event', 0));

    const persisted = JSON.parse(fs.readFileSync(`${root}/bug-history.json`, 'utf-8'));
    const expected = calculateFNV1a64(JSON.stringify({
      schema: persisted.schema,
      events_count: persisted.events.length,
      patterns_count: persisted.patterns.length,
      fix_events_count: persisted.fix_events.length,
      watchdog_events_count: persisted.watchdog_events.length,
      last_event_id: persisted.events[persisted.events.length - 1].id
    }));

    expect(persisted.integrity_hash).toBe(expected);
  });
});

describe('PatternDetector executable contracts', () => {
  test('requires the configured minimum occurrence count', async () => {
    const detector = new PatternDetectorImpl({ confidence_threshold: 0.1, min_occurrences: 3 });
    const patterns = await detector.detectPatterns([bug('a', 0), bug('b', 1)]);
    expect(patterns).toEqual([]);
  });

  test('promotes only sufficiently confident clusters and selects crash strategy deterministically', async () => {
    const detector = new PatternDetectorImpl({ confidence_threshold: 0.75, min_occurrences: 3 });
    const events = Array.from({ length: 8 }, (_, i) => bug(`p${i}`, i));
    const patterns = await detector.detectPatterns(events);

    expect(patterns).toHaveLength(1);
    expect(patterns[0].confidence).toBeGreaterThanOrEqual(0.75);
    expect(patterns[0].occurrences).toBe(8);
    expect(patterns[0].fix_strategy).toBe('monkey_patch_from_journal');
  });
});

describe('RollbackEngine executable contracts', () => {
  function installMemory(initial: number[], writeMode: 'restore' | 'ignore' = 'restore') {
    let memory = Uint8Array.from(initial);
    let writes = 0;

    (globalThis as any).ptr = (address: number) => address;
    (globalThis as any).Memory = {
      readByteArray: (_address: number, size: number) => memory.slice(0, size).buffer,
      protect: () => true,
      writeByteArray: (_address: number, bytes: number[]) => {
        writes++;
        if (writeMode === 'restore') memory = Uint8Array.from(bytes);
      }
    };

    return {
      mutate(bytes: number[]) { memory = Uint8Array.from(bytes); },
      bytes() { return Array.from(memory); },
      writes() { return writes; }
    };
  }

  test('journal persists checksum and rollback restores the original bytes', async () => {
    const memory = installMemory([1, 2, 3, 4]);
    const engine = new RollbackEngineImpl(root, 16, 3);
    const journal = await engine.journalBefore(0x1000, 4, 'fix-contract');

    expect(journal.fix_id).toBe('fix-contract');
    expect(journal.checksum_before).toBe(calculateFNV1a64(Buffer.from([1, 2, 3, 4]).toString('base64')));
    expect(fs.existsSync(`${root}/rollback-journal.json`)).toBe(true);

    memory.mutate([9, 9, 9, 9]);
    expect(await engine.rollback(journal)).toBe(true);
    expect(memory.bytes()).toEqual([1, 2, 3, 4]);
  });

  test('rollback stops after the configured maximum attempts when verification cannot succeed', async () => {
    const memory = installMemory([1, 2, 3, 4], 'ignore');
    const engine = new RollbackEngineImpl(root, 16, 3);
    const journal = await engine.journalBefore(0x1000, 4, 'fix-max-attempts');
    memory.mutate([9, 9, 9, 9]);

    expect(await engine.rollback(journal)).toBe(false);
    expect(memory.writes()).toBe(3);
  });
});

describe('Watchdog executable contracts', () => {
  test('heartbeat cadence advances deterministically', async () => {
    jest.useFakeTimers();
    const monitor = new WatchdogMonitorImpl(root, 10, 1000);
    await monitor.startWatchdog();

    jest.advanceTimersByTime(35);
    expect(monitor.getStats().heartbeat_count).toBeGreaterThanOrEqual(3);

    await monitor.stopWatchdog();
  });

  test('epoch timeout enters FAILSAFE and invokes rollback callback', async () => {
    jest.useFakeTimers();
    const monitor = new WatchdogMonitorImpl(root, 1000, 20);
    const rollback = jest.fn();
    monitor.setRollbackCallback(rollback);
    await monitor.startWatchdog();

    jest.advanceTimersByTime(45);
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(monitor.getStats().current_state).toBe('FAILSAFE');

    await monitor.stopWatchdog();
  });
});

describe('TestSuite fail-closed contracts', () => {
  test('smoke test fails closed when Java runtime evidence is absent', async () => {
    delete (globalThis as any).Java;
    const result = await new TestSuiteImpl().smokeTest();
    expect(result.state).toBe('FAIL');
  });

  test('runAfterFix does not report success when the smoke gate fails', async () => {
    delete (globalThis as any).Java;
    const fix: FixEvent = {
      fix_id: 'fix-test-suite-contract',
      pattern_id: 'pattern-test-suite-contract',
      timestamp: Date.now(),
      strategy: 'try_catch_with_fallback',
      status: 'applied',
      test_results: []
    };

    const results = await new TestSuiteImpl().runAfterFix(fix);
    expect(results.length).toBeGreaterThan(0);
    expect(results.some(result => result.state === 'FAIL')).toBe(true);
    expect(results.every(result => result.state === 'PASS' || result.state === 'SKIPPED')).toBe(false);
  });

  test('hosted synthetic performance check is explicit and bounded', async () => {
    (globalThis as any).Java = {
      use: (name: string) => {
        if (name !== 'java.lang.Runtime') throw new Error(`unexpected class ${name}`);
        return { getRuntime: () => ({ totalMemory: () => 0 }) };
      }
    };

    const result = await new TestSuiteImpl().performanceTest();
    expect(result.test_name).toBe('performance_test');
    expect(result.state).toBe('PASS');
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });
});

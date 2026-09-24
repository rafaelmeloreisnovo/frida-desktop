import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HyperMemoryRuntime } from '../hypermemory-runtime';

describe('HyperMemoryRuntime', () => {
  let storagePath: string;

  beforeEach(() => {
    storagePath = fs.mkdtempSync(path.join(os.tmpdir(), 'frida-hypermemory-'));
  });

  afterEach(() => {
    fs.rmSync(storagePath, { recursive: true, force: true });
  });

  test('keeps the HOT arena bounded and evicts oldest records', async () => {
    const runtime = new HyperMemoryRuntime({
      storagePath,
      capacityBytes: 512,
      checkpointIntervalMs: 0
    });
    await runtime.start();

    for (let i = 0; i < 12; i++) {
      runtime.append('debug-event', 'x'.repeat(80));
    }

    const stats = runtime.getStats();
    expect(stats.used_bytes).toBeLessThanOrEqual(stats.capacity_bytes);
    expect(stats.evictions).toBeGreaterThan(0);
    expect(stats.records).toBeLessThan(12);
    expect(stats.process_immortality_claim).toBe(false);

    await runtime.stop();
  });

  test('restores committed records after a new runtime instance starts', async () => {
    const first = new HyperMemoryRuntime({
      storagePath,
      capacityBytes: 4096,
      checkpointIntervalMs: 0
    });
    await first.start();
    first.appendJson('debug-state', { pid: 1234, state: 'OBSERVE' });
    first.append('trace-tail', 'last-known-call');
    first.checkpoint();
    await first.stop();

    const second = new HyperMemoryRuntime({
      storagePath,
      capacityBytes: 4096,
      checkpointIntervalMs: 0
    });
    await second.start();

    const stats = second.getStats();
    const records = second.readRecords();
    expect(stats.recovery_state).toBe('RESTORED');
    expect(records).toHaveLength(2);
    expect(records[0].kind).toBe('debug-state');
    expect(records[0].payload.toString('utf8')).toContain('OBSERVE');
    expect(records[1].payload.toString('utf8')).toBe('last-known-call');

    await second.stop();
  });

  test('quarantines a corrupt checkpoint and fails closed to an empty arena', async () => {
    const first = new HyperMemoryRuntime({
      storagePath,
      capacityBytes: 4096,
      checkpointIntervalMs: 0
    });
    await first.start();
    first.append('trace-tail', 'valid-before-corruption');
    await first.stop();

    const checkpoint = path.join(storagePath, 'hypermemory-runtime.v1.json');
    fs.writeFileSync(checkpoint, '{"schema":"broken"', 'utf8');

    const second = new HyperMemoryRuntime({
      storagePath,
      capacityBytes: 4096,
      checkpointIntervalMs: 0
    });
    await second.start();

    expect(second.getStats().recovery_state).toBe('QUARANTINED_CORRUPT');
    expect(second.readRecords()).toHaveLength(0);
    expect(
      fs.readdirSync(storagePath).some(name => name.includes('.corrupt.'))
    ).toBe(true);

    await second.stop();
  });

  test('rejects a single record larger than the configured arena', async () => {
    const runtime = new HyperMemoryRuntime({
      storagePath,
      capacityBytes: 256,
      checkpointIntervalMs: 0
    });
    await runtime.start();

    expect(() => runtime.append('oversized', 'x'.repeat(512))).toThrow(
      /capacity/
    );

    await runtime.stop();
  });
});

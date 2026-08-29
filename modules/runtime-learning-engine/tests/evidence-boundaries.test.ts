import { initializeEngine, shutdownEngine, RuntimeLearningEngine } from '../index';
import { setupFridaMock, teardownFridaMock } from '../test-utils/frida-mock';
import * as fs from 'fs';

const testDir = '/tmp/runtime-evidence-boundary';

describe('Runtime evidence boundaries', () => {
  let engine: RuntimeLearningEngine;

  beforeEach(async () => {
    fs.rmSync(testDir, { recursive: true, force: true });
    setupFridaMock();
    engine = await initializeEngine({
      storage_path: testDir,
      heartbeat_interval_ms: 500
    });
  });

  afterEach(async () => {
    await shutdownEngine();
    teardownFridaMock();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test('host controller memory is not promoted to target runtime evidence', async () => {
    const health = await engine.getHealthCheckEndpoint().getHealthStatus();

    expect(health.status).toBe('healthy');
    expect(health.evidence_status).toBe('PARTIAL');
    expect(health.memory_usage_mb).toBe(-1);
    expect(health.host_process_memory_usage_mb).toBeGreaterThanOrEqual(0);
    expect(health.memory_usage_source).toBe('HOST_PROCESS_ONLY');
    expect(health.evidence_gaps).toContain('target_memory_usage_mb=TOKEN_VAZIO');
  });

  test('host memory does not consume target-memory alert debounce', () => {
    const alerts = engine.getAlertManager().evaluateRules({ memory_usage_mb: 600 });

    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe('high_memory_usage');
    expect(alerts[0].severity).toBe('warning');
  });
});

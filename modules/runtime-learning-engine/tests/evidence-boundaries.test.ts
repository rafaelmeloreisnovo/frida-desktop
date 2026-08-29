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

  test('unknown target memory is omitted from numeric metric exports', async () => {
    const health = await engine.getHealthCheckEndpoint().getHealthStatus();
    expect(health.memory_usage_mb).toBe(-1);

    await engine.getMetricsCollector().exportMetrics('json');
    const metrics = JSON.parse(fs.readFileSync(`${testDir}/metrics.json`, 'utf-8'));

    expect(metrics).not.toHaveProperty('frida_memory_usage_mb');
    expect(metrics).toHaveProperty('frida_engine_uptime_seconds');
    expect(Object.values(metrics).some(value => value === -1)).toBe(false);
  });

  test('host memory does not consume target-memory alert debounce', () => {
    const alerts = engine.getAlertManager().evaluateRules({ memory_usage_mb: 600 });

    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe('high_memory_usage');
    expect(alerts[0].severity).toBe('warning');
  });

  test('local notification persistence never claims external delivery', async () => {
    const [alert] = engine.getAlertManager().evaluateRules({ bug_capture_latency_ms: 150 });
    expect(alert).toBeDefined();

    const receipt = await engine.getAlertManager().sendAlertNotification(alert, 'slack');
    expect(receipt.queue_state).toBe('LOCAL_FILE_PERSISTED');
    expect(receipt.delivery_state).toBe('TOKEN_VAZIO_EXTERNAL_TRANSPORT_NOT_BOUND');
    expect(receipt.delivery_verified).toBe(false);
    expect(receipt.external_transport_bound).toBe(false);
    expect(receipt.claim_allowed).toBe(false);

    const persisted = JSON.parse(fs.readFileSync(receipt.receipt_path, 'utf-8'));
    expect(persisted.external_delivery_attempted).toBe(false);
    expect(persisted.delivery_verified).toBe(false);
  });
});

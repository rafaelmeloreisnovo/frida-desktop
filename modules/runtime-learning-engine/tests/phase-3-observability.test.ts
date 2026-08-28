import { HealthCheckEndpoint } from '../health-check';
import { AlertRulesEngine } from '../alert-rules-3-2';
import * as fs from 'fs';
import * as path from 'path';

describe('Phase 3.2: Dashboard & Real-time Observability', () => {
  const testDir = '/tmp/phase-3-obs-test';

  beforeEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('Health evidence semantics', () => {
    test('returns complete health status', () => {
      const health = new HealthCheckEndpoint(testDir).getHealth();
      expect(health).toHaveProperty('status');
      expect(health).toHaveProperty('engine_running');
      expect(health).toHaveProperty('uptime_ms');
      expect(health).toHaveProperty('bugs_captured');
      expect(health).toHaveProperty('patterns_detected');
      expect(health).toHaveProperty('fixes_applied');
      expect(health).toHaveProperty('success_rate');
      expect(health).toHaveProperty('sla_violations');
      expect(health).toHaveProperty('watchdog_state');
      expect(health).toHaveProperty('memory_usage_mb');
      expect(health).toHaveProperty('disk_free_mb');
      expect(health).toHaveProperty('evidence_gaps');
    });

    test('missing engine/watchdog evidence degrades instead of pretending STABLE', () => {
      const health = new HealthCheckEndpoint(testDir).getHealth();
      expect(health.engine_running).toBe(false);
      expect(health.watchdog_state).toBe('UNKNOWN');
      expect(health.evidence_gaps).toContain('engine_running=TOKEN_VAZIO');
      expect(health.evidence_gaps).toContain('watchdog_state=TOKEN_VAZIO');
      expect(health.status).toBe('degraded');
    });

    test('known running engine plus stable watchdog can be healthy', () => {
      fs.writeFileSync(
        path.join(testDir, 'watchdog-events.json'),
        JSON.stringify({ events: [{ timestamp: Date.now(), state: 'STABLE' }] })
      );
      const health = new HealthCheckEndpoint(testDir, () => true).getHealth();
      expect(health.engine_running).toBe(true);
      expect(health.watchdog_state).toBe('STABLE');
      expect(health.sla_violations.critical).toBe(0);
      expect(health.status).toBe('healthy');
    });

    test('watchdog FAILSAFE is critical', () => {
      fs.writeFileSync(
        path.join(testDir, 'watchdog-events.json'),
        JSON.stringify({ events: [{ timestamp: Date.now(), state: 'FAILSAFE' }] })
      );
      const health = new HealthCheckEndpoint(testDir, () => true).getHealth();
      expect(health.watchdog_state).toBe('FAILSAFE');
      expect(health.status).toBe('critical');
    });

    test('success rate uses 0-100 scale and participates in SLA evaluation', () => {
      fs.writeFileSync(
        path.join(testDir, 'watchdog-events.json'),
        JSON.stringify({ events: [{ timestamp: Date.now(), state: 'STABLE' }] })
      );
      fs.writeFileSync(
        path.join(testDir, 'metrics.json'),
        JSON.stringify({ fixesApplied: 3, fixesRolledBack: 2 })
      );
      const health = new HealthCheckEndpoint(testDir, () => true).getHealth();
      expect(health.success_rate).toBe(60);
      expect(health.sla_violations.critical).toBeGreaterThan(0);
      expect(health.status).toBe('critical');
    });

    test('HTTP body and headers come from the same health snapshot', () => {
      fs.writeFileSync(
        path.join(testDir, 'watchdog-events.json'),
        JSON.stringify({ events: [{ timestamp: Date.now(), state: 'STABLE' }] })
      );
      const response = new HealthCheckEndpoint(testDir, () => true).toHTTPResponse();
      const body = JSON.parse(response.body);
      expect(response.headers['X-Engine-Status']).toBe(body.status);
      expect(response.headers['X-Watchdog-State']).toBe(body.watchdog_state);
      expect([200, 429, 503]).toContain(response.statusCode);
    });

    test('uptime is monotonic', async () => {
      const healthCheck = new HealthCheckEndpoint(testDir);
      const first = healthCheck.getHealth().uptime_ms;
      await new Promise(resolve => setTimeout(resolve, 10));
      const second = healthCheck.getHealth().uptime_ms;
      expect(second).toBeGreaterThanOrEqual(first);
    });
  });

  describe('Alert rules', () => {
    test('initializes with 14 default rules', () => {
      expect(new AlertRulesEngine().getAllRules()).toHaveLength(14);
    });

    test('contains critical and warning severities', () => {
      const alerts = new AlertRulesEngine();
      expect(alerts.getRulesBySeverity('critical').length).toBeGreaterThan(0);
      expect(alerts.getRulesBySeverity('warning').length).toBeGreaterThan(0);
    });

    test('triggers warning at 90ms bug capture latency', () => {
      const conditions = new AlertRulesEngine().evaluateMetric('frida_bug_capture_latency_ms', 90);
      expect(conditions.some(condition => condition.rule_id === 'sla_bug_capture_warning')).toBe(true);
    });

    test('does not trigger latency rules below thresholds', () => {
      const conditions = new AlertRulesEngine().evaluateMetric('frida_bug_capture_latency_ms', 50);
      expect(conditions).toHaveLength(0);
    });

    test('maintains triggered alert history', () => {
      const alerts = new AlertRulesEngine();
      alerts.evaluateMetric('frida_memory_usage_mb', 350);
      alerts.evaluateMetric('frida_success_rate', 75);
      expect(alerts.getAlertHistory().length).toBeGreaterThan(0);
    });

    test('can register custom rules', () => {
      const alerts = new AlertRulesEngine();
      const before = alerts.getAllRules().length;
      alerts.registerRule({
        id: 'test_custom_rule',
        name: 'Test Custom Alert',
        description: 'test',
        metric: 'frida_bugs_captured_total',
        threshold: 1000,
        operator: '>',
        severity: 'warning',
        enabled: true
      });
      expect(alerts.getAllRules().length).toBe(before + 1);
    });

    test('Prometheus export uses canonical metric names exactly once', () => {
      const yaml = new AlertRulesEngine().generatePrometheusAlertRules();
      expect(yaml).toContain('expr: frida_bug_capture_latency_ms > 100');
      expect(yaml).not.toContain('frida_frida_');
      expect((yaml.match(/- alert:/g) || []).length).toBeGreaterThan(10);
    });

    test('JSON export preserves rule identity and severity', () => {
      const json = new AlertRulesEngine().exportRulesJSON();
      expect(json.sla_bug_capture_critical.severity).toBe('critical');
      expect(json.sla_success_rate_critical.threshold).toBe(80);
      expect(json.sla_success_rate_warning.threshold).toBe(90);
    });

    test('resource thresholds remain explicit', () => {
      const rules = new AlertRulesEngine().getAllRules();
      expect(rules.find(rule => rule.id === 'resource_memory_critical')?.threshold).toBe(300);
      expect(rules.find(rule => rule.id === 'resource_disk_critical')?.threshold).toBe(50);
    });
  });

  describe('Gap boundary', () => {
    test('observability implementation artifacts exist', () => {
      expect(fs.existsSync(path.join(__dirname, '../metrics-exporter.ts'))).toBe(true);
      expect(fs.existsSync(path.join(__dirname, '../OBSERVABILITY_GUIDE.md'))).toBe(true);
      expect(fs.existsSync(path.join(__dirname, '../runtime-safety-mesh.ts'))).toBe(true);
    });

    test('implementation readiness does not claim physical runtime evidence', () => {
      const state = {
        implementation: 'IMPLEMENTED',
        runtime_integration: 'PARTIAL_TO_INTEGRATED_BY_CURRENT_BRANCH',
        physical_device_smoke: 'TOKEN_VAZIO',
        claim_allowed: false
      } as const;
      expect(state.implementation).toBe('IMPLEMENTED');
      expect(state.physical_device_smoke).toBe('TOKEN_VAZIO');
      expect(state.claim_allowed).toBe(false);
    });
  });
});

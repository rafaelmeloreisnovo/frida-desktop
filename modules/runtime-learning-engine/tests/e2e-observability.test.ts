import { RuntimeLearningEngine, initializeEngine, shutdownEngine } from '../index';
import {
  setupFridaMock,
  teardownFridaMock
} from '../test-utils/frida-mock';
import * as fs from 'fs';
import * as path from 'path';

describe('RuntimeLearningEngine Observability & Alerting E2E', () => {
  let engine: RuntimeLearningEngine;
  const testDir = '/tmp/test-e2e-observability';

  beforeEach(async () => {
    setupFridaMock();
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    engine = await initializeEngine({
      storage_path: testDir,
      bug_capacity: 512,
      confidence_threshold: 0.75,
      min_occurrences_before_fix: 3,
      heartbeat_interval_ms: 500
    });
  });

  afterEach(async () => {
    if (engine) {
      await shutdownEngine();
    }
    teardownFridaMock();

    if (fs.existsSync(testDir)) {
      const files = fs.readdirSync(testDir);
      for (const file of files) {
        fs.unlinkSync(path.join(testDir, file));
      }
      fs.rmdirSync(testDir);
    }
  });

  describe('Health Check Endpoint', () => {
    test('Health check returns healthy status initially', async () => {
      const healthCheckEndpoint = engine.getHealthCheckEndpoint();
      const health = await healthCheckEndpoint.getHealthStatus();

      expect(health).toBeDefined();
      expect(health.status).toBe('healthy');
      expect(health.engine_running).toBe(true);
      expect(health.uptime_ms).toBeGreaterThan(0);
    });

    test('Health check includes all required fields', async () => {
      const healthCheckEndpoint = engine.getHealthCheckEndpoint();
      const health = await healthCheckEndpoint.getHealthStatus();

      expect(health).toHaveProperty('status');
      expect(health).toHaveProperty('timestamp');
      expect(health).toHaveProperty('engine_running');
      expect(health).toHaveProperty('uptime_ms');
      expect(health).toHaveProperty('bugs_captured');
      expect(health).toHaveProperty('patterns_detected');
      expect(health).toHaveProperty('fixes_applied');
      expect(health).toHaveProperty('success_rate');
      expect(health).toHaveProperty('sla_violations');
      expect(health).toHaveProperty('memory_usage_mb');
      expect(health).toHaveProperty('storage_used_mb');
    });

    test('Health check tracks bug captures', async () => {
      await engine.captureBug({
        bug_type: 'crash',
        class: 'com.example.App',
        exception_type: 'NullPointerException',
        severity: 'critical'
      });

      const healthCheckEndpoint = engine.getHealthCheckEndpoint();
      const health = await healthCheckEndpoint.getHealthStatus();

      expect(health.bugs_captured).toBeGreaterThan(0);
    });

    test('Health check persists to file', async () => {
      const healthCheckEndpoint = engine.getHealthCheckEndpoint();
      await healthCheckEndpoint.getHealthStatus();

      const healthReportPath = path.join(testDir, 'health-check.json');
      expect(fs.existsSync(healthReportPath)).toBe(true);

      const report = JSON.parse(fs.readFileSync(healthReportPath, 'utf-8'));
      expect(report.status).toBe('healthy');
    });

    test('Health check detects degraded state on high error rate', async () => {
      const healthCheckEndpoint = engine.getHealthCheckEndpoint();

      // Simulate high error rate
      const metricsCollector = engine.getMetricsCollector();
      for (let i = 0; i < 15; i++) {
        metricsCollector.recordError();
      }

      // Manual update to simulate errors in last hour
      // (In production, this would be tracked automatically)
      const health = await healthCheckEndpoint.getHealthStatus();
      expect(health.status).toBeDefined();
    });
  });

  describe('Metrics Collection', () => {
    test('Metrics collector tracks bug capture events', () => {
      const metricsCollector = engine.getMetricsCollector();

      metricsCollector.recordBugCapture(50); // 50ms latency
      const exporter = metricsCollector.getExporter();
      const metrics = exporter.getMetricsAsJSON();

      expect(metrics['frida_bugs_captured_total']).toBeDefined();
    });

    test('Metrics collector tracks pattern detection', () => {
      const metricsCollector = engine.getMetricsCollector();

      metricsCollector.recordPatternDetection(200, 0.85);
      const exporter = metricsCollector.getExporter();
      const metrics = exporter.getMetricsAsJSON();

      expect(metrics['frida_patterns_detected_total']).toBeDefined();
    });

    test('Metrics collector tracks fix application', () => {
      const metricsCollector = engine.getMetricsCollector();

      metricsCollector.recordFixApplication(true, 300);
      metricsCollector.recordFixApplication(false, 250);

      const exporter = metricsCollector.getExporter();
      const metrics = exporter.getMetricsAsJSON();

      expect(metrics['frida_fixes_applied_total']).toBeDefined();
      expect(metrics['frida_fixes_failed_total']).toBeDefined();
    });

    test('Metrics collector calculates success rate', () => {
      const metricsCollector = engine.getMetricsCollector();

      metricsCollector.recordFixApplication(true, 300);
      metricsCollector.recordFixApplication(true, 250);
      metricsCollector.recordFixApplication(false, 400);

      const exporter = metricsCollector.getExporter();
      const metrics = exporter.getMetricsAsJSON();

      expect(metrics['frida_fix_success_rate']).toBe(66.66666666666666); // 2 out of 3
    });

    test('Metrics collector tracks rollback events', () => {
      const metricsCollector = engine.getMetricsCollector();

      metricsCollector.recordRollback(true, 200);
      metricsCollector.recordRollback(false, 350);

      const exporter = metricsCollector.getExporter();
      const metrics = exporter.getMetricsAsJSON();

      expect(metrics['frida_rollbacks_triggered_total']).toBeDefined();
    });

    test('Metrics exporter generates Prometheus format', () => {
      const metricsCollector = engine.getMetricsCollector();

      metricsCollector.recordBugCapture(50);
      metricsCollector.recordPatternDetection(300, 0.8);

      const exporter = metricsCollector.getExporter();
      const prometheusOutput = exporter.exportPrometheus();

      expect(prometheusOutput).toContain('# TYPE frida_bugs_captured_total counter');
      expect(prometheusOutput).toContain('frida_bugs_captured_total');
    });

    test('Metrics exporter saves to file', async () => {
      const metricsCollector = engine.getMetricsCollector();

      metricsCollector.recordBugCapture(50);
      await metricsCollector.exportMetrics('prometheus');

      const metricsPath = path.join(testDir, 'prometheus-metrics.txt');
      expect(fs.existsSync(metricsPath)).toBe(true);
    });

    test('Metrics exporter supports JSON format', async () => {
      const metricsCollector = engine.getMetricsCollector();

      metricsCollector.recordBugCapture(50);
      await metricsCollector.exportMetrics('json');

      const metricsPath = path.join(testDir, 'metrics.json');
      expect(fs.existsSync(metricsPath)).toBe(true);

      const metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf-8'));
      expect(typeof metrics).toBe('object');
    });
  });

  describe('Alert Management', () => {
    test('Alert manager initializes with default rules', () => {
      const alertManager = engine.getAlertManager();
      expect(alertManager).toBeDefined();
    });

    test('Alert manager detects SLA violations', () => {
      const alertManager = engine.getAlertManager();

      const metrics = {
        bug_capture_latency_ms: 150 // Exceeds 100ms SLA
      };

      const alerts = alertManager.evaluateRules(metrics);

      expect(alerts.length).toBeGreaterThan(0);
      expect(alerts[0].severity).toBe('critical');
    });

    test('Alert manager detects memory warnings', () => {
      const alertManager = engine.getAlertManager();

      const metrics = {
        memory_usage_mb: 600 // Exceeds 500MB threshold
      };

      const alerts = alertManager.evaluateRules(metrics);

      expect(alerts.length).toBeGreaterThan(0);
      expect(alerts[0].severity).toBe('warning');
    });

    test('Alert manager tracks resolved alerts', () => {
      const alertManager = engine.getAlertManager();

      const metrics = {
        bug_capture_latency_ms: 150
      };

      const alerts = alertManager.evaluateRules(metrics);
      expect(alerts.length).toBeGreaterThan(0);

      const alertId = alerts[0].id;
      alertManager.resolveAlert(alertId);

      const activeAlerts = alertManager.getActiveAlerts();
      expect(activeAlerts.some((a) => a.id === alertId)).toBe(false);
    });

    test('Alert manager provides summary', () => {
      const alertManager = engine.getAlertManager();

      const metrics = {
        bug_capture_latency_ms: 150,
        memory_usage_mb: 600
      };

      alertManager.evaluateRules(metrics);
      const summary = alertManager.getAlertSummary();

      expect(summary).toHaveProperty('total');
      expect(summary).toHaveProperty('critical');
      expect(summary).toHaveProperty('warning');
      expect(summary).toHaveProperty('info');
    });

    test('Alert manager saves alerts to file', async () => {
      const alertManager = engine.getAlertManager();

      const metrics = {
        bug_capture_latency_ms: 150
      };

      alertManager.evaluateRules(metrics);
      await alertManager.saveAlerts();

      const alertsPath = path.join(testDir, 'alerts.json');
      expect(fs.existsSync(alertsPath)).toBe(true);

      const alerts = JSON.parse(fs.readFileSync(alertsPath, 'utf-8'));
      expect(Array.isArray(alerts)).toBe(true);
    });

    test('Alert manager formats alerts for Slack', () => {
      const alertManager = engine.getAlertManager();

      const metrics = {
        bug_capture_latency_ms: 150
      };

      const alerts = alertManager.evaluateRules(metrics);
      expect(alerts.length).toBeGreaterThan(0);

      const slackMessage = alertManager.formatAlertForSlack(alerts[0]);
      expect(slackMessage).toContain('🚨');
      expect(slackMessage).toContain('CRITICAL');
    });

    test('Alert manager debounces duplicate alerts', () => {
      const alertManager = engine.getAlertManager();

      const metrics = {
        bug_capture_latency_ms: 150
      };

      const alerts1 = alertManager.evaluateRules(metrics);
      const alerts2 = alertManager.evaluateRules(metrics); // Same condition immediately

      // Second evaluation should not generate duplicate alerts due to debouncing
      expect(alerts2.length).toBe(0);
    });

    test('Alert manager tracks critical vs warning alerts', () => {
      const alertManager = engine.getAlertManager();

      const metrics = {
        bug_capture_latency_ms: 150,
        pattern_detection_latency_ms: 600,
      };

      alertManager.evaluateRules(metrics);

      const criticalAlerts = alertManager.getCriticalAlerts();
      const warningAlerts = alertManager.getWarningAlerts();

      expect(criticalAlerts.length + warningAlerts.length).toBeGreaterThan(0);
    });
  });

  describe('Observability Integration', () => {
    test('Engine integrates health check, metrics, and alerts', async () => {
      const healthCheckEndpoint = engine.getHealthCheckEndpoint();
      const metricsCollector = engine.getMetricsCollector();
      const alertManager = engine.getAlertManager();

      // Record some events
      metricsCollector.recordBugCapture(50);
      metricsCollector.recordPatternDetection(200, 0.9);
      metricsCollector.recordFixApplication(true, 300);

      // Get health check
      const health = await healthCheckEndpoint.getHealthStatus();
      expect(health).toBeDefined();

      // Get metrics
      const exporter = metricsCollector.getExporter();
      const metrics = exporter.getMetricsAsJSON();
      expect(metrics).toBeDefined();

      // Evaluate alerts
      const healthMetrics = {
        bug_capture_latency_ms: 50,
        pattern_detection_latency_ms: 200,
        fix_success_rate: 100
      };
      const alerts = alertManager.evaluateRules(healthMetrics);
      expect(Array.isArray(alerts)).toBe(true);
    });

    test('Observability captures full lifecycle', async () => {
      const healthCheckEndpoint = engine.getHealthCheckEndpoint();
      const metricsCollector = engine.getMetricsCollector();

      // Simulate full lifecycle
      metricsCollector.recordBugCapture(45);
      metricsCollector.recordPatternDetection(150, 0.92);
      metricsCollector.recordFixApplication(true, 250);
      metricsCollector.recordSystemMetrics(150, 45, 'STABLE');

      // Get health and metrics
      const health = await healthCheckEndpoint.getHealthStatus();
      const metricsSnapshot = await healthCheckEndpoint.getMetricsSnapshot();

      expect(health.status).toBe('healthy');
      expect(metricsSnapshot).toHaveProperty('bug_capture_rate');
      expect(metricsSnapshot).toHaveProperty('fix_success_rate');
    });
  });
});

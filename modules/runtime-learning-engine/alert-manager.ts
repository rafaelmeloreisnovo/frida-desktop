import * as fs from 'fs';
import * as path from 'path';

export interface Alert {
  id: string;
  timestamp: number;
  severity: 'critical' | 'warning' | 'info';
  type: string;
  message: string;
  context: Record<string, any>;
  resolved: boolean;
  resolved_at?: number;
}

export interface AlertRule {
  id: string;
  name: string;
  condition: (metrics: Record<string, any>) => boolean;
  severity: 'critical' | 'warning' | 'info';
  message: (metrics: Record<string, any>) => string;
  debounce_seconds?: number;
}

export class AlertManager {
  private storagePath: string;
  private alerts: Map<string, Alert> = new Map();
  private rules: AlertRule[] = [];
  private lastAlertTime: Map<string, number> = new Map();

  constructor(storagePath: string) {
    this.storagePath = storagePath;
    this.initializeDefaultRules();
  }

  private initializeDefaultRules(): void {
    // SLA violation: Bug capture latency
    this.addRule({
      id: 'sla_bug_capture_latency',
      name: 'Bug Capture Latency SLA Violation',
      condition: (metrics) => (metrics.bug_capture_latency_ms || 0) > 100,
      severity: 'critical',
      message: (metrics) => `Bug capture latency ${metrics.bug_capture_latency_ms}ms exceeds 100ms SLA`,
      debounce_seconds: 60,
    });

    // SLA violation: Pattern detection latency
    this.addRule({
      id: 'sla_pattern_detection_latency',
      name: 'Pattern Detection Latency SLA Violation',
      condition: (metrics) => (metrics.pattern_detection_latency_ms || 0) > 500,
      severity: 'warning',
      message: (metrics) => `Pattern detection latency ${metrics.pattern_detection_latency_ms}ms exceeds 500ms SLA`,
      debounce_seconds: 60,
    });

    // SLA violation: Fix application latency
    this.addRule({
      id: 'sla_fix_application_latency',
      name: 'Fix Application Latency SLA Violation',
      condition: (metrics) => (metrics.fix_application_latency_ms || 0) > 1000,
      severity: 'warning',
      message: (metrics) => `Fix application latency ${metrics.fix_application_latency_ms}ms exceeds 1000ms SLA`,
      debounce_seconds: 60,
    });

    // SLA violation: Fix success rate
    this.addRule({
      id: 'sla_fix_success_rate',
      name: 'Fix Success Rate SLA Violation',
      condition: (metrics) => (metrics.fix_success_rate || 100) < 80,
      severity: 'critical',
      message: (metrics) => `Fix success rate ${metrics.fix_success_rate}% below 80% SLA`,
      debounce_seconds: 300,
    });

    // Memory usage warning
    this.addRule({
      id: 'high_memory_usage',
      name: 'High Memory Usage Warning',
      condition: (metrics) => (metrics.memory_usage_mb || 0) > 500,
      severity: 'warning',
      message: (metrics) => `Memory usage ${metrics.memory_usage_mb}MB exceeds 500MB threshold`,
      debounce_seconds: 120,
    });

    // Storage usage critical
    this.addRule({
      id: 'high_storage_usage',
      name: 'High Storage Usage Critical',
      condition: (metrics) => (metrics.storage_usage_mb || 0) > 900,
      severity: 'critical',
      message: (metrics) => `Storage usage ${metrics.storage_usage_mb}MB exceeds 900MB threshold`,
      debounce_seconds: 300,
    });

    // Watchdog in failsafe
    this.addRule({
      id: 'watchdog_failsafe',
      name: 'Watchdog FAILSAFE Mode',
      condition: (metrics) => metrics.watchdog_state === 'FAILSAFE',
      severity: 'critical',
      message: () => 'Watchdog is in FAILSAFE mode - engine may be in degraded state',
      debounce_seconds: 0,
    });

    // High error rate
    this.addRule({
      id: 'high_error_rate',
      name: 'High Error Rate',
      condition: (metrics) => (metrics.errors_last_hour || 0) > 20,
      severity: 'warning',
      message: (metrics) => `${metrics.errors_last_hour} errors detected in the last hour`,
      debounce_seconds: 300,
    });

    // Rollback failure
    this.addRule({
      id: 'rollback_failure',
      name: 'Rollback Failure Detected',
      condition: (metrics) => (metrics.rollback_success_rate || 100) < 95,
      severity: 'critical',
      message: (metrics) => `Rollback success rate ${metrics.rollback_success_rate}% is below acceptable threshold`,
      debounce_seconds: 60,
    });
  }

  addRule(rule: AlertRule): void {
    this.rules.push(rule);
  }

  evaluateRules(metrics: Record<string, any>): Alert[] {
    const newAlerts: Alert[] = [];

    for (const rule of this.rules) {
      const shouldAlert = rule.condition(metrics);
      const lastAlertTime = this.lastAlertTime.get(rule.id) || 0;
      const debounceMs = (rule.debounce_seconds || 0) * 1000;
      const canAlert = Date.now() - lastAlertTime >= debounceMs;

      if (shouldAlert && canAlert) {
        const alert: Alert = {
          id: `${rule.id}_${Date.now()}`,
          timestamp: Date.now(),
          severity: rule.severity,
          type: rule.id,
          message: rule.message(metrics),
          context: metrics,
          resolved: false,
        };

        newAlerts.push(alert);
        this.addAlert(alert);
        this.lastAlertTime.set(rule.id, Date.now());
      }
    }

    return newAlerts;
  }

  addAlert(alert: Alert): void {
    this.alerts.set(alert.id, alert);
  }

  resolveAlert(alertId: string): void {
    const alert = this.alerts.get(alertId);
    if (alert) {
      alert.resolved = true;
      alert.resolved_at = Date.now();
    }
  }

  getActiveAlerts(): Alert[] {
    return Array.from(this.alerts.values()).filter((a) => !a.resolved);
  }

  getCriticalAlerts(): Alert[] {
    return this.getActiveAlerts().filter((a) => a.severity === 'critical');
  }

  getWarningAlerts(): Alert[] {
    return this.getActiveAlerts().filter((a) => a.severity === 'warning');
  }

  async saveAlerts(): Promise<void> {
    try {
      const alertsPath = path.join(this.storagePath, 'alerts.json');
      const alertsArray = Array.from(this.alerts.values());
      fs.writeFileSync(alertsPath, JSON.stringify(alertsArray, null, 2));
    } catch (e) {
      console.error('[AlertManager] Error saving alerts:', e);
    }
  }

  async loadAlerts(): Promise<void> {
    try {
      const alertsPath = path.join(this.storagePath, 'alerts.json');
      if (fs.existsSync(alertsPath)) {
        const content = fs.readFileSync(alertsPath, 'utf-8');
        const alertsArray = JSON.parse(content) as Alert[];
        for (const alert of alertsArray) {
          this.alerts.set(alert.id, alert);
        }
      }
    } catch (e) {
      console.error('[AlertManager] Error loading alerts:', e);
    }
  }

  getAlertSummary(): {
    total: number;
    critical: number;
    warning: number;
    info: number;
  } {
    const alerts = Array.from(this.alerts.values());
    return {
      total: alerts.length,
      critical: alerts.filter((a) => a.severity === 'critical' && !a.resolved).length,
      warning: alerts.filter((a) => a.severity === 'warning' && !a.resolved).length,
      info: alerts.filter((a) => a.severity === 'info' && !a.resolved).length,
    };
  }

  formatAlertForSlack(alert: Alert): string {
    const emoji = alert.severity === 'critical' ? '🚨' : alert.severity === 'warning' ? '⚠️' : 'ℹ️';
    return `${emoji} *${alert.severity.toUpperCase()}*: ${alert.message}`;
  }

  formatAlertForEmail(alert: Alert): string {
    const severity = alert.severity.toUpperCase();
    const timestamp = new Date(alert.timestamp).toISOString();
    return `[${severity}] ${alert.message}\nTime: ${timestamp}\nContext: ${JSON.stringify(alert.context, null, 2)}`;
  }

  async sendAlertNotification(
    alert: Alert,
    destination: 'slack' | 'pagerduty' | 'email' = 'slack'
  ): Promise<void> {
    try {
      const notificationPath = path.join(this.storagePath, `notification_${alert.id}.json`);
      const notification = {
        alert,
        destination,
        sent_at: Date.now(),
        status: 'pending',
      };
      fs.writeFileSync(notificationPath, JSON.stringify(notification, null, 2));

      // In production, integrate with actual notification services
      console.log(`[AlertManager] Alert notification queued for ${destination}: ${alert.message}`);
    } catch (e) {
      console.error('[AlertManager] Error sending alert notification:', e);
    }
  }
}

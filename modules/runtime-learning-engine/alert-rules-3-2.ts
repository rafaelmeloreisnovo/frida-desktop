/**
 * Phase 3.2: Alert Rules for SLA Monitoring
 *
 * Defines critical and warning thresholds for automatic alerting.
 * Rules are evaluated against metrics from the health endpoint.
 */

export interface AlertRule {
  id: string;
  name: string;
  description: string;
  metric: string;
  threshold: number;
  operator: '>' | '<' | '>=' | '<=' | '==';
  severity: 'critical' | 'warning';
  enabled: boolean;
  duration_seconds?: number;
}

export interface AlertCondition {
  rule_id: string;
  triggered: boolean;
  current_value: number;
  threshold: number;
  timestamp: number;
  message: string;
}

export class AlertRulesEngine {
  private rules: Map<string, AlertRule> = new Map();
  private alertHistory: AlertCondition[] = [];

  constructor() {
    this.initializeDefaultRules();
  }

  private initializeDefaultRules(): void {
    this.registerRule({
      id: 'sla_bug_capture_critical',
      name: 'Bug Capture Latency Critical',
      description: 'Bug capture latency exceeds 100ms (critical threshold)',
      metric: 'frida_bug_capture_latency_ms',
      threshold: 100,
      operator: '>',
      severity: 'critical',
      enabled: true,
      duration_seconds: 30
    });
    this.registerRule({
      id: 'sla_bug_capture_warning',
      name: 'Bug Capture Latency Warning',
      description: 'Bug capture latency exceeds 80ms (warning threshold)',
      metric: 'frida_bug_capture_latency_ms',
      threshold: 80,
      operator: '>',
      severity: 'warning',
      enabled: true,
      duration_seconds: 30
    });
    this.registerRule({
      id: 'sla_pattern_detection_critical',
      name: 'Pattern Detection Latency Critical',
      description: 'Pattern detection exceeds 500ms (critical threshold)',
      metric: 'frida_pattern_detection_latency_ms',
      threshold: 500,
      operator: '>',
      severity: 'critical',
      enabled: true,
      duration_seconds: 60
    });
    this.registerRule({
      id: 'sla_pattern_detection_warning',
      name: 'Pattern Detection Latency Warning',
      description: 'Pattern detection exceeds 400ms (warning threshold)',
      metric: 'frida_pattern_detection_latency_ms',
      threshold: 400,
      operator: '>',
      severity: 'warning',
      enabled: true,
      duration_seconds: 60
    });
    this.registerRule({
      id: 'sla_fix_application_critical',
      name: 'Fix Application Latency Critical',
      description: 'Fix application exceeds 1000ms (critical threshold)',
      metric: 'frida_fix_application_latency_ms',
      threshold: 1000,
      operator: '>',
      severity: 'critical',
      enabled: true,
      duration_seconds: 60
    });
    this.registerRule({
      id: 'sla_fix_application_warning',
      name: 'Fix Application Latency Warning',
      description: 'Fix application exceeds 800ms (warning threshold)',
      metric: 'frida_fix_application_latency_ms',
      threshold: 800,
      operator: '>',
      severity: 'warning',
      enabled: true,
      duration_seconds: 60
    });
    this.registerRule({
      id: 'sla_success_rate_critical',
      name: 'Success Rate Critical',
      description: 'Fix success rate drops below 80%',
      metric: 'frida_success_rate',
      threshold: 80,
      operator: '<',
      severity: 'critical',
      enabled: true,
      duration_seconds: 120
    });
    this.registerRule({
      id: 'sla_success_rate_warning',
      name: 'Success Rate Warning',
      description: 'Fix success rate drops below 90%',
      metric: 'frida_success_rate',
      threshold: 90,
      operator: '<',
      severity: 'warning',
      enabled: true,
      duration_seconds: 120
    });
    this.registerRule({
      id: 'resource_memory_critical',
      name: 'Memory Usage Critical',
      description: 'Memory usage exceeds 300MB',
      metric: 'frida_memory_usage_mb',
      threshold: 300,
      operator: '>',
      severity: 'critical',
      enabled: true,
      duration_seconds: 60
    });
    this.registerRule({
      id: 'resource_memory_warning',
      name: 'Memory Usage Warning',
      description: 'Memory usage exceeds 250MB',
      metric: 'frida_memory_usage_mb',
      threshold: 250,
      operator: '>',
      severity: 'warning',
      enabled: true,
      duration_seconds: 60
    });
    this.registerRule({
      id: 'resource_disk_critical',
      name: 'Disk Space Critical',
      description: 'Free disk space drops below 50MB',
      metric: 'frida_disk_free_mb',
      threshold: 50,
      operator: '<',
      severity: 'critical',
      enabled: true,
      duration_seconds: 30
    });
    this.registerRule({
      id: 'resource_disk_warning',
      name: 'Disk Space Warning',
      description: 'Free disk space drops below 100MB',
      metric: 'frida_disk_free_mb',
      threshold: 100,
      operator: '<',
      severity: 'warning',
      enabled: true,
      duration_seconds: 30
    });
    this.registerRule({
      id: 'watchdog_failsafe_critical',
      name: 'Watchdog Failsafe Activated',
      description: 'Watchdog has entered FAILSAFE mode (read-only)',
      metric: 'frida_watchdog_state',
      threshold: 4,
      operator: '==',
      severity: 'critical',
      enabled: true
    });
    this.registerRule({
      id: 'sla_violations_warning',
      name: 'SLA Violations Detected',
      description: 'One or more SLA violations detected',
      metric: 'frida_sla_total_violations',
      threshold: 0,
      operator: '>',
      severity: 'warning',
      enabled: true,
      duration_seconds: 60
    });
  }

  registerRule(rule: AlertRule): void {
    this.rules.set(rule.id, rule);
  }

  evaluateMetric(metric: string, value: number): AlertCondition[] {
    const triggered: AlertCondition[] = [];

    for (const [, rule] of this.rules) {
      if (!rule.enabled || rule.metric !== metric) continue;

      const isTriggered = this.checkCondition(value, rule.threshold, rule.operator);
      if (isTriggered) {
        const condition: AlertCondition = {
          rule_id: rule.id,
          triggered: true,
          current_value: value,
          threshold: rule.threshold,
          timestamp: Date.now(),
          message: `${rule.name}: ${rule.description} (value: ${value}, threshold: ${rule.threshold})`
        };
        triggered.push(condition);
        this.alertHistory.push(condition);
      }
    }

    return triggered;
  }

  private checkCondition(current: number, threshold: number, operator: string): boolean {
    switch (operator) {
      case '>': return current > threshold;
      case '<': return current < threshold;
      case '>=': return current >= threshold;
      case '<=': return current <= threshold;
      case '==': return current === threshold;
      default: return false;
    }
  }

  getAllRules(): AlertRule[] {
    return Array.from(this.rules.values());
  }

  getRulesBySeverity(severity: 'critical' | 'warning'): AlertRule[] {
    return Array.from(this.rules.values()).filter(rule => rule.severity === severity);
  }

  getAlertHistory(limit: number = 100): AlertCondition[] {
    return this.alertHistory.slice(-limit);
  }

  clearAlertHistory(): void {
    this.alertHistory = [];
  }

  generatePrometheusAlertRules(): string {
    const lines: string[] = [
      'groups:',
      '  - name: frida_runtime_learning_engine',
      '    interval: 30s',
      '    rules:'
    ];

    for (const rule of this.getAllRules()) {
      if (!rule.enabled) continue;

      const duration = rule.duration_seconds ? `${rule.duration_seconds}s` : '1m';
      lines.push(`      - alert: ${rule.id}`);
      // rule.metric is already canonical (for example frida_bug_capture_latency_ms).
      // Prefixing it again produced invalid frida_frida_* expressions.
      lines.push(`        expr: ${rule.metric} ${rule.operator} ${rule.threshold}`);
      lines.push(`        for: ${duration}`);
      lines.push('        labels:');
      lines.push(`          severity: ${rule.severity}`);
      lines.push('        annotations:');
      lines.push(`          summary: "${rule.name}"`);
      lines.push(`          description: "${rule.description}"`);
      lines.push('');
    }

    return lines.join('\n');
  }

  exportRulesJSON(): Record<string, AlertRule> {
    const result: Record<string, AlertRule> = {};
    for (const [id, rule] of this.rules) result[id] = rule;
    return result;
  }
}

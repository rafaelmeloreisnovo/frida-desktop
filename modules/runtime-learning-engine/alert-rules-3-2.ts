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

  /**
   * Initialize default SLA and operational alert rules
   */
  private initializeDefaultRules(): void {
    // CRITICAL: Bug capture latency > 100ms p99
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

    // WARNING: Bug capture latency > 80ms
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

    // CRITICAL: Pattern detection > 500ms p95
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

    // WARNING: Pattern detection > 400ms
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

    // CRITICAL: Fix application > 1000ms p95
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

    // WARNING: Fix application > 800ms
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

    // CRITICAL: Success rate < 80%
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

    // WARNING: Success rate < 90%
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

    // CRITICAL: Memory usage > 300MB
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

    // WARNING: Memory usage > 250MB
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

    // CRITICAL: Disk free < 50MB
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

    // WARNING: Disk free < 100MB
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

    // CRITICAL: Watchdog in FAILSAFE
    this.registerRule({
      id: 'watchdog_failsafe_critical',
      name: 'Watchdog Failsafe Activated',
      description: 'Watchdog has entered FAILSAFE mode (read-only)',
      metric: 'frida_watchdog_state',
      threshold: 4, // FAILSAFE = 4
      operator: '==',
      severity: 'critical',
      enabled: true
    });

    // WARNING: SLA violations detected
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

  /**
   * Register a new alert rule
   */
  registerRule(rule: AlertRule): void {
    this.rules.set(rule.id, rule);
  }

  /**
   * Evaluate a metric against all applicable rules
   */
  evaluateMetric(metric: string, value: number): AlertCondition[] {
    const triggered: AlertCondition[] = [];

    for (const [, rule] of this.rules) {
      if (!rule.enabled || rule.metric !== metric) {
        continue;
      }

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

  /**
   * Check if a condition is met
   */
  private checkCondition(current: number, threshold: number, operator: string): boolean {
    switch (operator) {
      case '>':
        return current > threshold;
      case '<':
        return current < threshold;
      case '>=':
        return current >= threshold;
      case '<=':
        return current <= threshold;
      case '==':
        return current === threshold;
      default:
        return false;
    }
  }

  /**
   * Get all rules
   */
  getAllRules(): AlertRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Get rules by severity
   */
  getRulesBySeverity(severity: 'critical' | 'warning'): AlertRule[] {
    return Array.from(this.rules.values()).filter(r => r.severity === severity);
  }

  /**
   * Get alert history
   */
  getAlertHistory(limit: number = 100): AlertCondition[] {
    return this.alertHistory.slice(-limit);
  }

  /**
   * Clear alert history
   */
  clearAlertHistory(): void {
    this.alertHistory = [];
  }

  /**
   * Generate Prometheus alert rule format (YAML)
   */
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
      lines.push(`        expr: frida_${rule.metric} ${rule.operator} ${rule.threshold}`);
      lines.push(`        for: ${duration}`);
      lines.push(`        labels:`);
      lines.push(`          severity: ${rule.severity}`);
      lines.push(`        annotations:`);
      lines.push(`          summary: "${rule.name}"`);
      lines.push(`          description: "${rule.description}"`);
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Export rules as JSON for configuration management
   */
  exportRulesJSON(): Record<string, AlertRule> {
    const result: Record<string, AlertRule> = {};
    for (const [id, rule] of this.rules) {
      result[id] = rule;
    }
    return result;
  }
}

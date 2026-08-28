import * as fs from 'fs';
import * as path from 'path';

export interface PrometheusMetric {
  name: string;
  help: string;
  type: 'gauge' | 'counter' | 'histogram' | 'summary';
  metrics: Array<{
    labels?: Record<string, string>;
    value: number;
  }>;
}

export class MetricsExporter {
  private storagePath: string;
  private metrics: Map<string, PrometheusMetric> = new Map();

  constructor(storagePath: string) {
    this.storagePath = storagePath;
    this.initializeMetrics();
  }

  private initializeMetrics(): void {
    // Bug capture metrics
    this.registerMetric('frida_bugs_captured_total', 'Total bugs captured', 'counter');
    this.registerMetric('frida_bug_capture_latency_ms', 'Bug capture latency in milliseconds', 'histogram');

    // Pattern detection metrics
    this.registerMetric('frida_patterns_detected_total', 'Total patterns detected', 'counter');
    this.registerMetric('frida_pattern_detection_latency_ms', 'Pattern detection latency', 'histogram');
    this.registerMetric('frida_pattern_confidence_avg', 'Average pattern confidence', 'gauge');

    // Fix application metrics
    this.registerMetric('frida_fixes_applied_total', 'Total fixes applied', 'counter');
    this.registerMetric('frida_fixes_failed_total', 'Total fix failures', 'counter');
    this.registerMetric('frida_fix_application_latency_ms', 'Fix application latency', 'histogram');
    this.registerMetric('frida_fix_success_rate', 'Fix success rate (0-100)', 'gauge');

    // Rollback metrics
    this.registerMetric('frida_rollbacks_triggered_total', 'Total rollbacks triggered', 'counter');
    this.registerMetric('frida_rollback_latency_ms', 'Rollback completion latency', 'histogram');
    this.registerMetric('frida_rollback_success_rate', 'Rollback success rate (0-100)', 'gauge');

    // SLA compliance metrics
    this.registerMetric('frida_sla_bug_capture_violations', 'Bug capture SLA violations', 'counter');
    this.registerMetric('frida_sla_pattern_detection_violations', 'Pattern detection SLA violations', 'counter');
    this.registerMetric('frida_sla_fix_application_violations', 'Fix application SLA violations', 'counter');
    this.registerMetric('frida_sla_rollback_violations', 'Rollback SLA violations', 'counter');

    // System metrics
    this.registerMetric('frida_engine_uptime_seconds', 'Engine uptime in seconds', 'gauge');
    this.registerMetric('frida_memory_usage_mb', 'Memory usage in MB', 'gauge');
    this.registerMetric('frida_storage_usage_mb', 'Storage usage in MB', 'gauge');

    // Watchdog metrics
    this.registerMetric('frida_watchdog_state', 'Watchdog state (1=STABLE, 2=OBSERVE, 3=DUMP, 4=FAILSAFE)', 'gauge');
    this.registerMetric('frida_watchdog_heartbeat_missed', 'Missed watchdog heartbeats', 'counter');

    // Error metrics
    this.registerMetric('frida_errors_total', 'Total errors', 'counter');
    this.registerMetric('frida_errors_last_hour', 'Errors in last hour', 'gauge');
  }

  private registerMetric(name: string, help: string, type: 'gauge' | 'counter' | 'histogram' | 'summary'): void {
    this.metrics.set(name, {
      name,
      help,
      type,
      metrics: [],
    });
  }

  recordCounter(metricName: string, increment: number = 1, labels?: Record<string, string>): void {
    const metric = this.metrics.get(metricName);
    if (!metric) {
      console.warn(`[MetricsExporter] Metric ${metricName} not registered`);
      return;
    }

    const labelKey = labels ? JSON.stringify(labels) : '__default__';
    const existingMetric = metric.metrics.find(
      (m) => (labels ? JSON.stringify(m.labels) : '__default__') === labelKey
    );

    if (existingMetric) {
      existingMetric.value += increment;
    } else {
      metric.metrics.push({
        labels,
        value: increment,
      });
    }
  }

  recordGauge(metricName: string, value: number, labels?: Record<string, string>): void {
    const metric = this.metrics.get(metricName);
    if (!metric) {
      console.warn(`[MetricsExporter] Metric ${metricName} not registered`);
      return;
    }

    const labelKey = labels ? JSON.stringify(labels) : '__default__';
    const existingMetric = metric.metrics.find(
      (m) => (labels ? JSON.stringify(m.labels) : '__default__') === labelKey
    );

    if (existingMetric) {
      existingMetric.value = value;
    } else {
      metric.metrics.push({
        labels,
        value,
      });
    }
  }

  recordHistogram(metricName: string, value: number, labels?: Record<string, string>): void {
    // For simplicity, store histogram values as regular metrics
    // In production, use proper histogram bucketing
    this.recordGauge(`${metricName}_bucket`, value, labels);
  }

  exportPrometheus(): string {
    let output = '';

    for (const [, metric] of this.metrics) {
      if (metric.metrics.length === 0) continue;

      output += `# HELP ${metric.name} ${metric.help}\n`;
      output += `# TYPE ${metric.name} ${metric.type}\n`;

      for (const m of metric.metrics) {
        const labels = m.labels
          ? `{${Object.entries(m.labels)
              .map(([k, v]) => `${k}="${v}"`)
              .join(',')}}`
          : '';
        output += `${metric.name}${labels} ${m.value}\n`;
      }

      output += '\n';
    }

    return output;
  }

  async saveMetricsFile(): Promise<void> {
    try {
      const metricsPath = path.join(this.storagePath, 'prometheus-metrics.txt');
      const prometheusOutput = this.exportPrometheus();
      fs.writeFileSync(metricsPath, prometheusOutput);
    } catch (e) {
      console.error('[MetricsExporter] Error saving metrics file:', e);
    }
  }

  getMetricsAsJSON(): Record<string, any> {
    const result: Record<string, any> = {};

    for (const [name, metric] of this.metrics) {
      if (metric.metrics.length === 0) continue;

      if (metric.metrics.length === 1 && !metric.metrics[0].labels) {
        result[name] = metric.metrics[0].value;
      } else {
        result[name] = metric.metrics.map((m) => ({
          labels: m.labels,
          value: m.value,
        }));
      }
    }

    return result;
  }

  async exportToFile(format: 'prometheus' | 'json' = 'prometheus'): Promise<void> {
    try {
      const filename = format === 'prometheus' ? 'prometheus-metrics.txt' : 'metrics.json';
      const filePath = path.join(this.storagePath, filename);

      let content: string;
      if (format === 'prometheus') {
        content = this.exportPrometheus();
      } else {
        content = JSON.stringify(this.getMetricsAsJSON(), null, 2);
      }

      fs.writeFileSync(filePath, content);
    } catch (e) {
      console.error(`[MetricsExporter] Error exporting to ${format} file:`, e);
    }
  }

  clear(): void {
    for (const metric of this.metrics.values()) {
      metric.metrics = [];
    }
  }

  getMetricsSnapshot(): Record<string, number> {
    const snapshot: Record<string, number> = {};

    for (const [name, metric] of this.metrics) {
      if (metric.metrics.length > 0) {
        const values = metric.metrics.map((m) => m.value);
        snapshot[name] = values[0]; // For now, just take first value

        if (metric.type === 'histogram') {
          snapshot[`${name}_avg`] = values.reduce((a, b) => a + b, 0) / values.length;
          snapshot[`${name}_max`] = Math.max(...values);
        }
      }
    }

    return snapshot;
  }
}

// Metrics collector that integrates with RuntimeLearningEngine
export class MetricsCollector {
  private exporter: MetricsExporter;
  private startTime: number;
  private bugsProcessed = 0;
  private patternsDetected = 0;
  private fixesApplied = 0;
  private fixesFailed = 0;
  private rollbacksTriggered = 0;

  constructor(storagePath: string) {
    this.exporter = new MetricsExporter(storagePath);
    this.startTime = Date.now();
  }

  recordBugCapture(latencyMs: number): void {
    this.bugsProcessed++;
    this.exporter.recordCounter('frida_bugs_captured_total', 1);
    this.exporter.recordHistogram('frida_bug_capture_latency_ms', latencyMs);

    if (latencyMs > 100) {
      this.exporter.recordCounter('frida_sla_bug_capture_violations', 1);
    }
  }

  recordPatternDetection(latencyMs: number, confidence: number): void {
    this.patternsDetected++;
    this.exporter.recordCounter('frida_patterns_detected_total', 1);
    this.exporter.recordHistogram('frida_pattern_detection_latency_ms', latencyMs);
    this.exporter.recordGauge('frida_pattern_confidence_avg', confidence);

    if (latencyMs > 500) {
      this.exporter.recordCounter('frida_sla_pattern_detection_violations', 1);
    }
  }

  recordFixApplication(success: boolean, latencyMs: number): void {
    if (success) {
      this.fixesApplied++;
      this.exporter.recordCounter('frida_fixes_applied_total', 1);
    } else {
      this.fixesFailed++;
      this.exporter.recordCounter('frida_fixes_failed_total', 1);
    }

    this.exporter.recordHistogram('frida_fix_application_latency_ms', latencyMs);

    const totalAttempts = this.fixesApplied + this.fixesFailed;
    const successRate = (this.fixesApplied / totalAttempts) * 100;
    this.exporter.recordGauge('frida_fix_success_rate', successRate);

    if (latencyMs > 1000) {
      this.exporter.recordCounter('frida_sla_fix_application_violations', 1);
    }
  }

  recordRollback(success: boolean, latencyMs: number): void {
    this.rollbacksTriggered++;
    this.exporter.recordCounter('frida_rollbacks_triggered_total', 1);
    this.exporter.recordHistogram('frida_rollback_latency_ms', latencyMs);

    if (latencyMs > 500) {
      this.exporter.recordCounter('frida_sla_rollback_violations', 1);
    }

    // Assume 95% rollback success if not specified
    const rollbackSuccessRate = success ? 100 : 90;
    this.exporter.recordGauge('frida_rollback_success_rate', rollbackSuccessRate);
  }

  recordSystemMetrics(memoryMb: number, storageMb: number, watchdogState: string): void {
    const uptimeSeconds = Math.round((Date.now() - this.startTime) / 1000);
    this.exporter.recordGauge('frida_engine_uptime_seconds', uptimeSeconds);
    this.exporter.recordGauge('frida_memory_usage_mb', memoryMb);
    this.exporter.recordGauge('frida_storage_usage_mb', storageMb);

    // Map watchdog state to numeric value
    const stateMap: Record<string, number> = {
      STABLE: 1,
      OBSERVE: 2,
      DUMP: 3,
      FAILSAFE: 4,
    };
    const stateValue = stateMap[watchdogState] || 0;
    this.exporter.recordGauge('frida_watchdog_state', stateValue);
  }

  recordError(): void {
    this.exporter.recordCounter('frida_errors_total', 1);
  }

  async exportMetrics(format: 'prometheus' | 'json' = 'prometheus'): Promise<void> {
    await this.exporter.exportToFile(format);
  }

  getExporter(): MetricsExporter {
    return this.exporter;
  }
}

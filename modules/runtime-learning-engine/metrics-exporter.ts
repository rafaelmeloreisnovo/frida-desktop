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

const HISTOGRAM_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
const MAX_HISTOGRAM_SAMPLES = 1000;

export class MetricsExporter {
  private metrics: Map<string, PrometheusMetric> = new Map();

  constructor(private storagePath: string) {
    this.initializeMetrics();
  }

  private initializeMetrics(): void {
    this.registerMetric('frida_bugs_captured_total', 'Total bugs captured', 'counter');
    this.registerMetric('frida_bug_capture_latency_ms', 'Bug capture latency in milliseconds', 'histogram');

    this.registerMetric('frida_patterns_detected_total', 'Total patterns detected', 'counter');
    this.registerMetric('frida_pattern_detection_latency_ms', 'Pattern detection latency', 'histogram');
    this.registerMetric('frida_pattern_confidence_avg', 'Average pattern confidence', 'gauge');

    this.registerMetric('frida_fixes_applied_total', 'Total fixes applied', 'counter');
    this.registerMetric('frida_fixes_failed_total', 'Total fix failures', 'counter');
    this.registerMetric('frida_fix_application_latency_ms', 'Fix application latency', 'histogram');
    this.registerMetric('frida_fix_success_rate', 'Fix success rate (0-100)', 'gauge');
    this.registerMetric('frida_success_rate', 'Canonical fix success rate alias (0-100)', 'gauge');

    this.registerMetric('frida_rollbacks_triggered_total', 'Total rollbacks triggered', 'counter');
    this.registerMetric('frida_rollback_latency_ms', 'Rollback completion latency', 'histogram');
    this.registerMetric('frida_rollback_success_rate', 'Rollback success rate (0-100)', 'gauge');

    this.registerMetric('frida_sla_bug_capture_violations', 'Bug capture SLA violations', 'counter');
    this.registerMetric('frida_sla_pattern_detection_violations', 'Pattern detection SLA violations', 'counter');
    this.registerMetric('frida_sla_fix_application_violations', 'Fix application SLA violations', 'counter');
    this.registerMetric('frida_sla_rollback_violations', 'Rollback SLA violations', 'counter');
    this.registerMetric('frida_sla_total_violations', 'Total observed SLA violations', 'counter');

    this.registerMetric('frida_engine_uptime_seconds', 'Engine uptime in seconds', 'gauge');
    this.registerMetric('frida_memory_usage_mb', 'Observed target runtime memory usage in MB; omitted when not observed', 'gauge');
    this.registerMetric('frida_storage_usage_mb', 'Observed tracked storage usage in MB', 'gauge');
    this.registerMetric('frida_disk_free_mb', 'Observed free filesystem space in MB', 'gauge');

    this.registerMetric('frida_watchdog_state', 'Watchdog state (1=STABLE, 2=OBSERVE, 3=DUMP, 4=FAILSAFE)', 'gauge');
    this.registerMetric('frida_watchdog_heartbeat_missed', 'Missed watchdog heartbeats', 'counter');

    this.registerMetric('frida_errors_total', 'Total errors', 'counter');
    this.registerMetric('frida_errors_last_hour', 'Errors in last hour', 'gauge');
  }

  private registerMetric(name: string, help: string, type: PrometheusMetric['type']): void {
    this.metrics.set(name, { name, help, type, metrics: [] });
  }

  recordCounter(metricName: string, increment: number = 1, labels?: Record<string, string>): void {
    const metric = this.metrics.get(metricName);
    if (!metric) {
      console.warn(`[MetricsExporter] Metric ${metricName} not registered`);
      return;
    }

    const existingMetric = this.findLabeledMetric(metric, labels);
    if (existingMetric) existingMetric.value += increment;
    else metric.metrics.push({ labels, value: increment });
  }

  recordGauge(metricName: string, value: number, labels?: Record<string, string>): void {
    if (!Number.isFinite(value)) {
      console.warn(`[MetricsExporter] Refusing non-finite gauge ${metricName}: ${value}`);
      return;
    }
    const metric = this.metrics.get(metricName);
    if (!metric) {
      console.warn(`[MetricsExporter] Metric ${metricName} not registered`);
      return;
    }

    const existingMetric = this.findLabeledMetric(metric, labels);
    if (existingMetric) existingMetric.value = value;
    else metric.metrics.push({ labels, value });
  }

  recordHistogram(metricName: string, value: number, labels?: Record<string, string>): void {
    if (!Number.isFinite(value)) {
      console.warn(`[MetricsExporter] Refusing non-finite histogram sample ${metricName}: ${value}`);
      return;
    }
    const metric = this.metrics.get(metricName);
    if (!metric || metric.type !== 'histogram') {
      console.warn(`[MetricsExporter] Histogram ${metricName} not registered`);
      return;
    }

    metric.metrics.push({ labels, value });
    if (metric.metrics.length > MAX_HISTOGRAM_SAMPLES) {
      metric.metrics = metric.metrics.slice(-MAX_HISTOGRAM_SAMPLES);
    }
  }

  exportPrometheus(): string {
    let output = '';

    for (const metric of this.metrics.values()) {
      if (metric.metrics.length === 0) continue;

      output += `# HELP ${metric.name} ${metric.help}\n`;
      output += `# TYPE ${metric.name} ${metric.type}\n`;

      if (metric.type === 'histogram') {
        output += this.exportHistogram(metric);
      } else {
        for (const sample of metric.metrics) {
          output += `${metric.name}${this.formatLabels(sample.labels)} ${sample.value}\n`;
        }
      }

      output += '\n';
    }

    return output;
  }

  private exportHistogram(metric: PrometheusMetric): string {
    const samples = metric.metrics;
    const sum = samples.reduce((total, sample) => total + sample.value, 0);
    let output = '';

    for (const bucket of HISTOGRAM_BUCKETS) {
      const count = samples.filter(sample => sample.value <= bucket).length;
      output += `${metric.name}_bucket{le="${bucket}"} ${count}\n`;
    }
    output += `${metric.name}_bucket{le="+Inf"} ${samples.length}\n`;
    output += `${metric.name}_sum ${sum}\n`;
    output += `${metric.name}_count ${samples.length}\n`;
    return output;
  }

  private findLabeledMetric(metric: PrometheusMetric, labels?: Record<string, string>) {
    const labelKey = labels ? JSON.stringify(labels) : '__default__';
    return metric.metrics.find(
      sample => (labels ? JSON.stringify(sample.labels) : '__default__') === labelKey
    );
  }

  private formatLabels(labels?: Record<string, string>): string {
    if (!labels) return '';
    return `{${Object.entries(labels)
      .map(([key, value]) => `${key}="${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
      .join(',')}}`;
  }

  async saveMetricsFile(): Promise<void> {
    await this.exportToFile('prometheus');
  }

  getMetricsAsJSON(): Record<string, any> {
    const result: Record<string, any> = {};

    for (const [name, metric] of this.metrics) {
      if (metric.metrics.length === 0) continue;

      if (metric.type === 'histogram') {
        const values = metric.metrics.map(sample => sample.value);
        result[name] = {
          count: values.length,
          latest: values[values.length - 1],
          avg: values.reduce((a, b) => a + b, 0) / values.length,
          max: Math.max(...values)
        };
      } else if (metric.metrics.length === 1 && !metric.metrics[0].labels) {
        result[name] = metric.metrics[0].value;
      } else {
        result[name] = metric.metrics.map(sample => ({ labels: sample.labels, value: sample.value }));
      }
    }

    return result;
  }

  async exportToFile(format: 'prometheus' | 'json' = 'prometheus'): Promise<void> {
    try {
      if (!fs.existsSync(this.storagePath)) fs.mkdirSync(this.storagePath, { recursive: true });
      const filename = format === 'prometheus' ? 'prometheus-metrics.txt' : 'metrics.json';
      const filePath = path.join(this.storagePath, filename);
      const content = format === 'prometheus'
        ? this.exportPrometheus()
        : JSON.stringify(this.getMetricsAsJSON(), null, 2);
      fs.writeFileSync(filePath, content);
    } catch (e) {
      console.error(`[MetricsExporter] Error exporting to ${format} file:`, e);
    }
  }

  clear(): void {
    for (const metric of this.metrics.values()) metric.metrics = [];
  }

  getMetricsSnapshot(): Record<string, number> {
    const snapshot: Record<string, number> = {};

    for (const [name, metric] of this.metrics) {
      if (metric.metrics.length === 0) continue;
      const values = metric.metrics.map(sample => sample.value);

      if (metric.type === 'histogram') {
        snapshot[name] = values[values.length - 1];
        snapshot[`${name}_avg`] = values.reduce((a, b) => a + b, 0) / values.length;
        snapshot[`${name}_max`] = Math.max(...values);
      } else {
        snapshot[name] = values[0];
      }
    }

    return snapshot;
  }
}

export class MetricsCollector {
  private exporter: MetricsExporter;
  private startTime: number;
  private fixesApplied = 0;
  private fixesFailed = 0;
  private rollbacksTriggered = 0;
  private rollbacksSucceeded = 0;

  constructor(storagePath: string) {
    this.exporter = new MetricsExporter(storagePath);
    this.startTime = Date.now();
  }

  recordBugCapture(latencyMs: number): void {
    this.exporter.recordCounter('frida_bugs_captured_total', 1);
    this.exporter.recordHistogram('frida_bug_capture_latency_ms', latencyMs);
    if (latencyMs > 100) this.recordSLAViolation('frida_sla_bug_capture_violations');
  }

  recordPatternDetection(latencyMs: number, confidence: number): void {
    this.exporter.recordCounter('frida_patterns_detected_total', 1);
    this.exporter.recordHistogram('frida_pattern_detection_latency_ms', latencyMs);
    this.exporter.recordGauge('frida_pattern_confidence_avg', confidence);
    if (latencyMs > 500) this.recordSLAViolation('frida_sla_pattern_detection_violations');
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
    const successRate = totalAttempts === 0 ? 100 : (this.fixesApplied / totalAttempts) * 100;
    this.exporter.recordGauge('frida_fix_success_rate', successRate);
    this.exporter.recordGauge('frida_success_rate', successRate);

    if (latencyMs > 1000) this.recordSLAViolation('frida_sla_fix_application_violations');
  }

  recordRollback(success: boolean, latencyMs: number): void {
    this.rollbacksTriggered++;
    if (success) this.rollbacksSucceeded++;
    this.exporter.recordCounter('frida_rollbacks_triggered_total', 1);
    this.exporter.recordHistogram('frida_rollback_latency_ms', latencyMs);

    if (latencyMs > 500) this.recordSLAViolation('frida_sla_rollback_violations');

    const rollbackSuccessRate =
      this.rollbacksTriggered === 0 ? 100 : (this.rollbacksSucceeded / this.rollbacksTriggered) * 100;
    this.exporter.recordGauge('frida_rollback_success_rate', rollbackSuccessRate);
  }

  recordSystemMetrics(
    memoryMb: number,
    storageMb: number,
    watchdogState: string,
    diskFreeMb?: number | null
  ): void {
    const uptimeSeconds = Math.round((Date.now() - this.startTime) / 1000);
    this.exporter.recordGauge('frida_engine_uptime_seconds', uptimeSeconds);

    // Negative values are evidence sentinels (TOKEN_VAZIO), not measurements.
    // Omit them entirely instead of encoding "unknown" as a physically meaningful
    // numeric gauge that dashboards, alerts, or downstream math might consume.
    if (Number.isFinite(memoryMb) && memoryMb >= 0) {
      this.exporter.recordGauge('frida_memory_usage_mb', memoryMb);
    }
    if (Number.isFinite(storageMb) && storageMb >= 0) {
      this.exporter.recordGauge('frida_storage_usage_mb', storageMb);
    }
    if (typeof diskFreeMb === 'number' && Number.isFinite(diskFreeMb) && diskFreeMb >= 0) {
      this.exporter.recordGauge('frida_disk_free_mb', diskFreeMb);
    }

    const stateMap: Record<string, number> = { STABLE: 1, OBSERVE: 2, DUMP: 3, FAILSAFE: 4 };
    const watchdogNumeric = stateMap[watchdogState];
    if (typeof watchdogNumeric === 'number') {
      this.exporter.recordGauge('frida_watchdog_state', watchdogNumeric);
    }
  }

  recordError(): void {
    this.exporter.recordCounter('frida_errors_total', 1);
  }

  private recordSLAViolation(metricName: string): void {
    this.exporter.recordCounter(metricName, 1);
    this.exporter.recordCounter('frida_sla_total_violations', 1);
  }

  async exportMetrics(format: 'prometheus' | 'json' = 'prometheus'): Promise<void> {
    await this.exporter.exportToFile(format);
  }

  getExporter(): MetricsExporter {
    return this.exporter;
  }
}

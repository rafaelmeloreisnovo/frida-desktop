import { RuntimeLearningEngine } from './index';
import * as fs from 'fs';
import * as path from 'path';

export type MemoryObservationSource = 'TARGET_RUNTIME' | 'HOST_PROCESS_ONLY' | 'UNKNOWN';

export interface HealthCheckResponse {
  status: 'healthy' | 'degraded' | 'critical';
  evidence_status: 'COMPLETE' | 'PARTIAL';
  timestamp: number;
  engine_running: boolean;
  uptime_ms: number;
  bugs_captured: number;
  patterns_detected: number;
  fixes_applied: number;
  rollbacks_triggered: number;
  success_rate: number;
  sla_violations: {
    critical: number;
    warnings: number;
  };
  last_heartbeat: number;
  watchdog_state: string;
  /** Target-runtime memory only. -1 means TOKEN_VAZIO / not observed. */
  memory_usage_mb: number;
  /** Host/controller process memory is informational and never promoted to Android target evidence. */
  host_process_memory_usage_mb: number;
  memory_usage_source: MemoryObservationSource;
  storage_used_mb: number;
  errors_last_hour: number;
  evidence_gaps: string[];
}

export interface MetricsSnapshot {
  timestamp: number;
  bug_capture_rate: number;
  pattern_detection_rate: number;
  fix_success_rate: number;
  rollback_rate: number;
  avg_latencies: {
    bug_capture_ms: number;
    pattern_detection_ms: number;
    fix_application_ms: number;
    rollback_ms: number;
  };
  sla_compliance: {
    bug_capture_latency: boolean;
    pattern_detection_latency: boolean;
    fix_application_latency: boolean;
    rollback_latency: boolean;
    success_rate_target: boolean;
  };
}

interface MemoryObservation {
  target_mb: number;
  host_process_mb: number;
  source: MemoryObservationSource;
}

export class HealthCheckEndpoint {
  private startTime: number;
  private metrics: Map<string, any> = new Map();

  constructor(
    private engine: RuntimeLearningEngine,
    private storagePath: string,
    private targetMemoryProvider?: () => number | null | undefined
  ) {
    this.startTime = Date.now();
  }

  async getHealthStatus(): Promise<HealthCheckResponse> {
    const stats = this.engine.getStats();
    const memory = this.getMemoryObservation();
    const storageUsed = this.calculateStorageUsage();
    const errorsLastHour = this.countErrorsLastHour();
    const bugCaptureLatency = this.getAverageLatency('bug_capture');
    const success = this.calculateSuccessStats();
    const watchdogState = String(stats.watchdogState || 'UNKNOWN');
    const evidenceGaps: string[] = [];

    if (!stats.lastHeartbeat) evidenceGaps.push('last_heartbeat=TOKEN_VAZIO');
    if (watchdogState === 'UNKNOWN') evidenceGaps.push('watchdog_state=TOKEN_VAZIO');
    if (memory.source !== 'TARGET_RUNTIME') evidenceGaps.push('target_memory_usage_mb=TOKEN_VAZIO');

    let criticalViolations = 0;
    let warningViolations = 0;

    if (bugCaptureLatency > 100) criticalViolations++;
    else if (bugCaptureLatency > 80) warningViolations++;

    if (success.attempts > 0 && success.rate < 80) criticalViolations++;
    else if (success.attempts > 0 && success.rate < 90) warningViolations++;

    // Memory thresholds are meaningful only when the observed value belongs to
    // the target runtime. Node/Jest controller memory must never be promoted to
    // Android/device memory evidence or trigger target-memory SLA alerts.
    if (memory.source === 'TARGET_RUNTIME' && memory.target_mb >= 0) {
      if (memory.target_mb > 300) criticalViolations++;
      else if (memory.target_mb > 250) warningViolations++;
    }

    if (storageUsed > 900) criticalViolations++;
    if (errorsLastHour > 20) warningViolations++;
    if (watchdogState === 'FAILSAFE') criticalViolations++;
    else if (watchdogState === 'UNKNOWN') warningViolations++;
    if (!this.engine.isRunning()) warningViolations++;

    // Operational health and epistemic completeness are orthogonal. Missing
    // physical evidence remains visible in evidence_status/evidence_gaps but is
    // not itself fabricated into an operational failure.
    const status: HealthCheckResponse['status'] =
      criticalViolations > 0 ? 'critical' : warningViolations > 0 ? 'degraded' : 'healthy';

    const healthResponse: HealthCheckResponse = {
      status,
      evidence_status: evidenceGaps.length > 0 ? 'PARTIAL' : 'COMPLETE',
      timestamp: Date.now(),
      engine_running: this.engine.isRunning(),
      uptime_ms: Date.now() - this.startTime,
      bugs_captured: stats.recentBugsCount,
      patterns_detected: stats.patternsCount,
      fixes_applied: stats.fixesApplied,
      rollbacks_triggered: stats.rollbacksTriggered,
      success_rate: success.rate,
      sla_violations: {
        critical: criticalViolations,
        warnings: warningViolations
      },
      last_heartbeat: stats.lastHeartbeat || 0,
      watchdog_state: watchdogState,
      memory_usage_mb: memory.target_mb,
      host_process_memory_usage_mb: memory.host_process_mb,
      memory_usage_source: memory.source,
      storage_used_mb: storageUsed,
      errors_last_hour: errorsLastHour,
      evidence_gaps: evidenceGaps
    };

    await this.saveJSON('health-check.json', healthResponse);
    return healthResponse;
  }

  async getMetricsSnapshot(): Promise<MetricsSnapshot> {
    const bugCaptureLatency = this.getAverageLatency('bug_capture');
    const patternDetectionLatency = this.getAverageLatency('pattern_detection');
    const fixApplicationLatency = this.getAverageLatency('fix_application');
    const rollbackLatency = this.getAverageLatency('rollback');
    const success = this.calculateSuccessStats();

    const metrics: MetricsSnapshot = {
      timestamp: Date.now(),
      bug_capture_rate: this.calculateEventRate('bug_capture'),
      pattern_detection_rate: this.calculateEventRate('pattern_detection'),
      fix_success_rate: success.rate,
      rollback_rate: this.calculateEventRate('rollback'),
      avg_latencies: {
        bug_capture_ms: bugCaptureLatency,
        pattern_detection_ms: patternDetectionLatency,
        fix_application_ms: fixApplicationLatency,
        rollback_ms: rollbackLatency
      },
      sla_compliance: {
        bug_capture_latency: bugCaptureLatency <= 100,
        pattern_detection_latency: patternDetectionLatency <= 500,
        fix_application_latency: fixApplicationLatency <= 1000,
        rollback_latency: rollbackLatency <= 500,
        success_rate_target: success.attempts === 0 || success.rate >= 80
      }
    };

    await this.saveJSON('metrics-snapshot.json', metrics);
    return metrics;
  }

  private calculateStorageUsage(): number {
    try {
      const tracked = [
        'bug-history.json',
        'audit.log',
        'provenance.json',
        'receipts.json',
        'rollback-journal.json',
        'watchdog-events.json',
        'metrics.json',
        'alerts.json'
      ];
      let totalSize = 0;
      for (const name of tracked) {
        const filePath = path.join(this.storagePath, name);
        if (fs.existsSync(filePath)) totalSize += fs.statSync(filePath).size;
      }
      return Math.round((totalSize / 1024 / 1024) * 100) / 100;
    } catch (e) {
      console.warn('[HealthCheckEndpoint] Error calculating storage usage:', e);
      return 0;
    }
  }

  private getMemoryObservation(): MemoryObservation {
    if (this.targetMemoryProvider) {
      try {
        const target = Number(this.targetMemoryProvider());
        if (Number.isFinite(target) && target >= 0) {
          return {
            target_mb: Math.round(target * 100) / 100,
            host_process_mb: this.getHostProcessMemoryMb(),
            source: 'TARGET_RUNTIME'
          };
        }
      } catch (e) {
        console.warn('[HealthCheckEndpoint] Target memory provider failed:', e);
      }
    }

    const host = this.getHostProcessMemoryMb();
    return {
      target_mb: -1,
      host_process_mb: host,
      source: host >= 0 ? 'HOST_PROCESS_ONLY' : 'UNKNOWN'
    };
  }

  private getHostProcessMemoryMb(): number {
    try {
      if (typeof process !== 'undefined' && typeof process.memoryUsage === 'function') {
        return Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 100) / 100;
      }
    } catch (e) {
      console.warn('[HealthCheckEndpoint] Host memory observation unavailable:', e);
    }
    return -1;
  }

  private getAverageLatency(metricType: string): number {
    const latencies = (this.metrics.get(`${metricType}_latencies`) || []) as number[];
    if (latencies.length === 0) return 0;
    return Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
  }

  private calculateSuccessStats(): { rate: number; attempts: number; successes: number } {
    const successes = Number(this.metrics.get('fixes_successful') || 0);
    const attempts = Number(this.metrics.get('fixes_attempted') || 0);
    return {
      rate: attempts === 0 ? 100 : Math.round((successes / attempts) * 100),
      attempts,
      successes
    };
  }

  private calculateEventRate(eventType: string): number {
    const recentEvents = (this.metrics.get(`${eventType}_recent`) || []) as Array<{ timestamp: number }>;
    const oneMinuteAgo = Date.now() - 60000;
    return recentEvents.filter(event => event.timestamp > oneMinuteAgo).length;
  }

  private countErrorsLastHour(): number {
    try {
      const auditPath = path.join(this.storagePath, 'audit.log');
      if (!fs.existsSync(auditPath)) return 0;
      const oneHourAgo = Date.now() - 60 * 60 * 1000;
      let count = 0;
      for (const line of fs.readFileSync(auditPath, 'utf-8').split('\n')) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          const timestamp = Number(entry.timestamp || 0);
          const result = String(entry.result || entry.status || '').toLowerCase();
          if (timestamp >= oneHourAgo && (result.includes('fail') || result.includes('error'))) count++;
        } catch {
          // Malformed audit lines are counted as errors instead of silently ignored.
          count++;
        }
      }
      return count;
    } catch (e) {
      console.warn('[HealthCheckEndpoint] Error reading audit log:', e);
      return 0;
    }
  }

  private async saveJSON(fileName: string, value: unknown): Promise<void> {
    try {
      if (!fs.existsSync(this.storagePath)) fs.mkdirSync(this.storagePath, { recursive: true });
      fs.writeFileSync(path.join(this.storagePath, fileName), JSON.stringify(value, null, 2));
    } catch (e) {
      console.error(`[HealthCheckEndpoint] Error saving ${fileName}:`, e);
    }
  }

  recordLatency(metricType: string, latencyMs: number): void {
    const key = `${metricType}_latencies`;
    const latencies = (this.metrics.get(key) || []) as number[];
    latencies.push(latencyMs);
    if (latencies.length > 100) latencies.shift();
    this.metrics.set(key, latencies);
  }

  recordSuccess(_metricType: string): void {
    this.metrics.set('fixes_successful', Number(this.metrics.get('fixes_successful') || 0) + 1);
    this.metrics.set('fixes_attempted', Number(this.metrics.get('fixes_attempted') || 0) + 1);
  }

  recordFailure(_metricType: string): void {
    this.metrics.set('fixes_attempted', Number(this.metrics.get('fixes_attempted') || 0) + 1);
  }

  recordEvent(eventType: string): void {
    const key = `${eventType}_recent`;
    const events = (this.metrics.get(key) || []) as Array<{ timestamp: number }>;
    events.push({ timestamp: Date.now() });
    if (events.length > 1000) events.shift();
    this.metrics.set(key, events);
  }
}

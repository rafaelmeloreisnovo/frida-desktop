import { RuntimeLearningEngine } from './index';
import * as fs from 'fs';
import * as path from 'path';

export interface HealthCheckResponse {
  status: 'healthy' | 'degraded' | 'critical';
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
  memory_usage_mb: number;
  storage_used_mb: number;
  errors_last_hour: number;
}

export interface MetricsSnapshot {
  timestamp: number;
  bug_capture_rate: number; // events/min
  pattern_detection_rate: number; // patterns/min
  fix_success_rate: number; // percentage
  rollback_rate: number; // percentage
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

export class HealthCheckEndpoint {
  private engine: RuntimeLearningEngine;
  private storagePath: string;
  private startTime: number;
  private metrics: Map<string, any> = new Map();

  constructor(engine: RuntimeLearningEngine, storagePath: string) {
    this.engine = engine;
    this.storagePath = storagePath;
    this.startTime = Date.now();
  }

  async getHealthStatus(): Promise<HealthCheckResponse> {
    try {
      const stats = this.engine.getStats();
      const memoryUsage = process.memoryUsage();
      const storageUsed = this.calculateStorageUsage();
      const errorsLastHour = this.countErrorsLastHour();

      const bugCaptureLatency = this.getAverageLatency('bug_capture');
      const successRate = this.calculateSuccessRate();

      // Determine overall status
      let status: 'healthy' | 'degraded' | 'critical' = 'healthy';
      let criticalViolations = 0;
      let warningViolations = 0;

      // Check critical SLAs
      if (bugCaptureLatency > 100) criticalViolations++;
      if (successRate < 80) criticalViolations++;
      if (memoryUsage.heapUsed / 1024 / 1024 > 500) criticalViolations++;
      if (storageUsed > 900) criticalViolations++; // 900MB of 1GB

      // Check warning SLAs
      if (bugCaptureLatency > 75) warningViolations++;
      if (successRate < 85) warningViolations++;
      if (errorsLastHour > 10) warningViolations++;

      if (criticalViolations > 0) {
        status = 'critical';
      } else if (warningViolations > 2) {
        status = 'degraded';
      }

      const healthResponse: HealthCheckResponse = {
        status,
        timestamp: Date.now(),
        engine_running: this.engine.isRunning(),
        uptime_ms: Date.now() - this.startTime,
        bugs_captured: stats.recentBugsCount,
        patterns_detected: (stats as any).patternsCount || 0,
        fixes_applied: (stats as any).fixesApplied || 0,
        rollbacks_triggered: (stats as any).rollbacksTriggered || 0,
        success_rate: successRate,
        sla_violations: {
          critical: criticalViolations,
          warnings: warningViolations,
        },
        last_heartbeat: (stats as any).lastHeartbeat || Date.now(),
        watchdog_state: (stats as any).watchdogState || 'UNKNOWN',
        memory_usage_mb: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        storage_used_mb: storageUsed,
        errors_last_hour: errorsLastHour,
      };

      await this.saveHealthCheckReport(healthResponse);
      return healthResponse;
    } catch (e) {
      console.error('[HealthCheckEndpoint] Error getting health status:', e);
      throw e;
    }
  }

  async getMetricsSnapshot(): Promise<MetricsSnapshot> {
    try {
      const stats = this.engine.getStats();
      const bugCaptureLatency = this.getAverageLatency('bug_capture');
      const patternDetectionLatency = this.getAverageLatency('pattern_detection');
      const fixApplicationLatency = this.getAverageLatency('fix_application');
      const rollbackLatency = this.getAverageLatency('rollback');
      const successRate = this.calculateSuccessRate();

      // Calculate rates (events in last minute)
      const bugCaptureRate = this.calculateEventRate('bug_capture');
      const patternDetectionRate = this.calculateEventRate('pattern_detection');
      const rollbackRate = this.calculateEventRate('rollback');

      const metrics: MetricsSnapshot = {
        timestamp: Date.now(),
        bug_capture_rate: bugCaptureRate,
        pattern_detection_rate: patternDetectionRate,
        fix_success_rate: successRate,
        rollback_rate: rollbackRate,
        avg_latencies: {
          bug_capture_ms: bugCaptureLatency,
          pattern_detection_ms: patternDetectionLatency,
          fix_application_ms: fixApplicationLatency,
          rollback_ms: rollbackLatency,
        },
        sla_compliance: {
          bug_capture_latency: bugCaptureLatency < 100,
          pattern_detection_latency: patternDetectionLatency < 500,
          fix_application_latency: fixApplicationLatency < 1000,
          rollback_latency: rollbackLatency < 500,
          success_rate_target: successRate >= 80,
        },
      };

      await this.saveMetricsSnapshot(metrics);
      return metrics;
    } catch (e) {
      console.error('[HealthCheckEndpoint] Error getting metrics snapshot:', e);
      throw e;
    }
  }

  private calculateStorageUsage(): number {
    try {
      const bugHistoryPath = path.join(this.storagePath, 'bug-history.json');
      const auditLogPath = path.join(this.storagePath, 'audit.log');
      const provenancePath = path.join(this.storagePath, 'provenance.json');
      const receiptsPath = path.join(this.storagePath, 'receipts.json');

      let totalSize = 0;

      if (fs.existsSync(bugHistoryPath)) {
        const stats = fs.statSync(bugHistoryPath);
        totalSize += stats.size;
      }

      if (fs.existsSync(auditLogPath)) {
        const stats = fs.statSync(auditLogPath);
        totalSize += stats.size;
      }

      if (fs.existsSync(provenancePath)) {
        const stats = fs.statSync(provenancePath);
        totalSize += stats.size;
      }

      if (fs.existsSync(receiptsPath)) {
        const stats = fs.statSync(receiptsPath);
        totalSize += stats.size;
      }

      return Math.round((totalSize / 1024 / 1024) * 100) / 100;
    } catch (e) {
      console.warn('[HealthCheckEndpoint] Error calculating storage usage:', e);
      return 0;
    }
  }

  private getAverageLatency(metricType: string): number {
    // This would integrate with metrics stored by components
    // For now, return a default value
    const latencies = this.metrics.get(`${metricType}_latencies`) || [];
    if (latencies.length === 0) return 0;
    return Math.round(
      latencies.reduce((a: number, b: number) => a + b, 0) / latencies.length
    );
  }

  private calculateSuccessRate(): number {
    const successCount = (this.metrics.get('fixes_successful') || 0) as number;
    const totalCount = (this.metrics.get('fixes_attempted') || 1) as number;
    return Math.round((successCount / totalCount) * 100);
  }

  private calculateEventRate(eventType: string): number {
    // Get events from last minute
    const recentEvents = (this.metrics.get(`${eventType}_recent`) || []) as any[];
    const oneMinuteAgo = Date.now() - 60000;
    const eventsInLastMinute = recentEvents.filter((e) => e.timestamp > oneMinuteAgo);
    return eventsInLastMinute.length;
  }

  private countErrorsLastHour(): number {
    // This would integrate with audit log
    // For now, return 0
    return 0;
  }

  private async saveHealthCheckReport(report: HealthCheckResponse): Promise<void> {
    try {
      const healthReportPath = path.join(this.storagePath, 'health-check.json');
      fs.writeFileSync(healthReportPath, JSON.stringify(report, null, 2));
    } catch (e) {
      console.error('[HealthCheckEndpoint] Error saving health check report:', e);
    }
  }

  private async saveMetricsSnapshot(metrics: MetricsSnapshot): Promise<void> {
    try {
      const metricsPath = path.join(this.storagePath, 'metrics-snapshot.json');
      fs.writeFileSync(metricsPath, JSON.stringify(metrics, null, 2));
    } catch (e) {
      console.error('[HealthCheckEndpoint] Error saving metrics snapshot:', e);
    }
  }

  recordLatency(metricType: string, latencyMs: number): void {
    const key = `${metricType}_latencies`;
    const latencies = this.metrics.get(key) || [];
    latencies.push(latencyMs);
    // Keep only last 100 measurements
    if (latencies.length > 100) {
      latencies.shift();
    }
    this.metrics.set(key, latencies);
  }

  recordSuccess(metricType: string): void {
    this.metrics.set(
      'fixes_successful',
      ((this.metrics.get('fixes_successful') || 0) as number) + 1
    );
    this.metrics.set(
      'fixes_attempted',
      ((this.metrics.get('fixes_attempted') || 0) as number) + 1
    );
  }

  recordFailure(metricType: string): void {
    this.metrics.set(
      'fixes_attempted',
      ((this.metrics.get('fixes_attempted') || 0) as number) + 1
    );
  }

  recordEvent(eventType: string): void {
    const key = `${eventType}_recent`;
    const events = this.metrics.get(key) || [];
    events.push({ timestamp: Date.now() });
    // Keep only last 1000 events
    if (events.length > 1000) {
      events.shift();
    }
    this.metrics.set(key, events);
  }
}

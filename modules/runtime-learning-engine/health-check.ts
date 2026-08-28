import * as fs from 'fs';
import * as path from 'path';

/**
 * Phase 3.2: Health Check Endpoint
 *
 * Real-time engine status monitoring with SLA compliance tracking.
 * Exposes /health endpoint for external monitoring and alerting.
 */

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'critical';
  engine_running: boolean;
  uptime_ms: number;
  bugs_captured: number;
  patterns_detected: number;
  fixes_applied: number;
  fixes_rolled_back: number;
  success_rate: number;
  last_heartbeat: number;
  watchdog_state: 'STABLE' | 'OBSERVE' | 'DUMP' | 'FAILSAFE';
  sla_violations: {
    critical: number;
    warnings: number;
  };
  memory_usage_mb: number;
  disk_free_mb: number;
  last_bug_capture_ms: number;
  last_pattern_detection_ms: number;
  last_fix_application_ms: number;
}

export class HealthCheckEndpoint {
  private startTime: number = Date.now();
  private metricsPath: string;
  private lastHealthCheck: HealthStatus | null = null;

  constructor(storagePath: string = '/data/local/tmp/frida-learning') {
    this.metricsPath = storagePath;
  }

  /**
   * Get current health status
   */
  getHealth(): HealthStatus {
    const now = Date.now();
    const uptime = now - this.startTime;

    const metrics = this.loadMetrics();
    const watchdogState = this.getWatchdogState();
    const slaViolations = this.checkSLAViolations(metrics);
    const overallStatus = this.determineStatus(slaViolations, watchdogState);

    const health: HealthStatus = {
      status: overallStatus,
      engine_running: true,
      uptime_ms: uptime,
      bugs_captured: metrics.bugsCaptured || 0,
      patterns_detected: metrics.patternsDetected || 0,
      fixes_applied: metrics.fixesApplied || 0,
      fixes_rolled_back: metrics.fixesRolledBack || 0,
      success_rate: this.calculateSuccessRate(metrics),
      last_heartbeat: now,
      watchdog_state: watchdogState,
      sla_violations: slaViolations,
      memory_usage_mb: this.getMemoryUsage(),
      disk_free_mb: this.getDiskFree(),
      last_bug_capture_ms: metrics.lastBugCaptureLatency || 0,
      last_pattern_detection_ms: metrics.lastPatternDetectionLatency || 0,
      last_fix_application_ms: metrics.lastFixApplicationLatency || 0
    };

    this.lastHealthCheck = health;
    return health;
  }

  /**
   * Load metrics from storage
   */
  private loadMetrics(): any {
    try {
      const metricsFile = path.join(this.metricsPath, 'metrics.json');
      if (fs.existsSync(metricsFile)) {
        const content = fs.readFileSync(metricsFile, 'utf-8');
        return JSON.parse(content);
      }
    } catch (e) {
      console.error('[HealthCheck] Failed to load metrics:', e);
    }
    return {};
  }

  /**
   * Determine watchdog state from watchdog-events.json
   */
  private getWatchdogState(): 'STABLE' | 'OBSERVE' | 'DUMP' | 'FAILSAFE' {
    try {
      const watchdogFile = path.join(this.metricsPath, 'watchdog-events.json');
      if (fs.existsSync(watchdogFile)) {
        const content = fs.readFileSync(watchdogFile, 'utf-8');
        const data = JSON.parse(content);
        if (data.state) {
          return data.state;
        }
      }
    } catch (e) {
      console.error('[HealthCheck] Failed to load watchdog state:', e);
    }
    return 'STABLE';
  }

  /**
   * Check for SLA violations
   */
  private checkSLAViolations(metrics: any): { critical: number; warnings: number } {
    let critical = 0;
    let warnings = 0;

    const checks = [
      // Critical: Bug capture > 100ms p99
      { latency: metrics.lastBugCaptureLatency, critical: 100, warning: 80 },
      // Critical: Pattern detection > 500ms p95
      { latency: metrics.lastPatternDetectionLatency, critical: 500, warning: 400 },
      // Critical: Fix application > 1000ms p95
      { latency: metrics.lastFixApplicationLatency, critical: 1000, warning: 800 },
      // Critical: Success rate < 80%
      ...(metrics.successRate && metrics.successRate < 0.80 ? [{ critical: 1, warning: 0 }] : [])
    ];

    for (const check of checks) {
      if (check.latency && check.critical && check.latency > check.critical) {
        critical++;
      } else if (check.latency && check.warning && check.latency > check.warning) {
        warnings++;
      }
    }

    return { critical, warnings };
  }

  /**
   * Determine overall status based on SLA violations and watchdog state
   */
  private determineStatus(
    slaViolations: { critical: number; warnings: number },
    watchdogState: string
  ): 'healthy' | 'degraded' | 'critical' {
    if (watchdogState === 'FAILSAFE' || slaViolations.critical > 0) {
      return 'critical';
    }
    if (slaViolations.warnings > 0) {
      return 'degraded';
    }
    return 'healthy';
  }

  /**
   * Calculate success rate from metrics
   */
  private calculateSuccessRate(metrics: any): number {
    const total = (metrics.fixesApplied || 0) + (metrics.fixesRolledBack || 0);
    if (total === 0) return 100;
    return ((metrics.fixesApplied || 0) / total) * 100;
  }

  /**
   * Get current memory usage in MB
   */
  private getMemoryUsage(): number {
    try {
      if (process.memoryUsage) {
        const usage = process.memoryUsage();
        return Math.round(usage.heapUsed / 1024 / 1024);
      }
    } catch (e) {
      console.error('[HealthCheck] Failed to get memory usage:', e);
    }
    return 0;
  }

  /**
   * Get disk free space in MB (simulated)
   */
  private getDiskFree(): number {
    // In real implementation, would call df or similar
    // For now, return simulated value
    return 500;
  }

  /**
   * Generate JSON response for /health endpoint
   */
  toJSON(): string {
    return JSON.stringify(this.getHealth(), null, 2);
  }

  /**
   * Generate HTTP response
   */
  toHTTPResponse(): { statusCode: number; body: string; headers: Record<string, string> } {
    const health = this.getHealth();
    const statusCode = health.status === 'critical' ? 503 : health.status === 'degraded' ? 429 : 200;

    return {
      statusCode,
      body: this.toJSON(),
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'X-Engine-Status': health.status,
        'X-Watchdog-State': health.watchdog_state
      }
    };
  }

  /**
   * Reset engine uptime counter
   */
  resetUptime(): void {
    this.startTime = Date.now();
  }
}

import * as fs from 'fs';
import * as path from 'path';

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
  watchdog_state: 'STABLE' | 'OBSERVE' | 'DUMP' | 'FAILSAFE' | 'UNKNOWN';
  sla_violations: {
    critical: number;
    warnings: number;
  };
  memory_usage_mb: number;
  disk_free_mb: number;
  last_bug_capture_ms: number;
  last_pattern_detection_ms: number;
  last_fix_application_ms: number;
  evidence_gaps: string[];
}

/**
 * File-backed compatibility health observer used by Phase 3.2 tests and
 * external tooling. The engine-bound primary surface is health-check-endpoint.ts.
 * Unknown evidence is never silently promoted to STABLE/true.
 */
export class HealthCheckEndpoint {
  private startTime: number = Date.now();
  private metricsPath: string;
  private lastHealthCheck: HealthStatus | null = null;

  constructor(
    storagePath: string = '/data/local/tmp/frida-learning',
    private engineRunningProvider?: () => boolean
  ) {
    this.metricsPath = storagePath;
  }

  getHealth(): HealthStatus {
    const now = Date.now();
    const metrics = this.loadMetrics();
    const watchdog = this.getWatchdogObservation();
    const successRate = this.calculateSuccessRate(metrics);
    const slaViolations = this.checkSLAViolations(metrics, successRate);
    const evidenceGaps: string[] = [];

    const engineRunning = this.engineRunningProvider ? this.safeEngineRunning() : false;
    if (!this.engineRunningProvider) evidenceGaps.push('engine_running=TOKEN_VAZIO');
    if (watchdog.state === 'UNKNOWN') evidenceGaps.push('watchdog_state=TOKEN_VAZIO');

    const memoryUsage = this.getMemoryUsage();
    if (memoryUsage < 0) evidenceGaps.push('memory_usage_mb=TOKEN_VAZIO');

    const diskFree = this.getDiskFree();
    if (diskFree < 0) evidenceGaps.push('disk_free_mb=TOKEN_VAZIO');

    const overallStatus = this.determineStatus(slaViolations, watchdog.state, evidenceGaps);

    const health: HealthStatus = {
      status: overallStatus,
      engine_running: engineRunning,
      uptime_ms: now - this.startTime,
      bugs_captured: metrics.bugsCaptured || 0,
      patterns_detected: metrics.patternsDetected || 0,
      fixes_applied: metrics.fixesApplied || 0,
      fixes_rolled_back: metrics.fixesRolledBack || 0,
      success_rate: successRate,
      last_heartbeat: watchdog.lastHeartbeat,
      watchdog_state: watchdog.state,
      sla_violations: slaViolations,
      memory_usage_mb: memoryUsage,
      disk_free_mb: diskFree,
      last_bug_capture_ms: metrics.lastBugCaptureLatency || 0,
      last_pattern_detection_ms: metrics.lastPatternDetectionLatency || 0,
      last_fix_application_ms: metrics.lastFixApplicationLatency || 0,
      evidence_gaps: evidenceGaps
    };

    this.lastHealthCheck = health;
    return health;
  }

  private safeEngineRunning(): boolean {
    try {
      return Boolean(this.engineRunningProvider?.());
    } catch (e) {
      console.error('[HealthCheck] Failed to query engine running state:', e);
      return false;
    }
  }

  private loadMetrics(): any {
    try {
      const metricsFile = path.join(this.metricsPath, 'metrics.json');
      if (fs.existsSync(metricsFile)) {
        return JSON.parse(fs.readFileSync(metricsFile, 'utf-8'));
      }
    } catch (e) {
      console.error('[HealthCheck] Failed to load metrics:', e);
    }
    return {};
  }

  private getWatchdogObservation(): {
    state: 'STABLE' | 'OBSERVE' | 'DUMP' | 'FAILSAFE' | 'UNKNOWN';
    lastHeartbeat: number;
  } {
    try {
      const watchdogFile = path.join(this.metricsPath, 'watchdog-events.json');
      if (!fs.existsSync(watchdogFile)) return { state: 'UNKNOWN', lastHeartbeat: 0 };

      const data = JSON.parse(fs.readFileSync(watchdogFile, 'utf-8'));
      const directState = this.normalizeWatchdogState(data.state);
      if (directState !== 'UNKNOWN') {
        return { state: directState, lastHeartbeat: Number(data.timestamp || 0) };
      }

      if (Array.isArray(data.events) && data.events.length > 0) {
        const latest = data.events[data.events.length - 1];
        return {
          state: this.normalizeWatchdogState(latest?.state),
          lastHeartbeat: Number(latest?.timestamp || 0)
        };
      }
    } catch (e) {
      console.error('[HealthCheck] Failed to load watchdog state:', e);
    }
    return { state: 'UNKNOWN', lastHeartbeat: 0 };
  }

  private normalizeWatchdogState(value: any): 'STABLE' | 'OBSERVE' | 'DUMP' | 'FAILSAFE' | 'UNKNOWN' {
    return ['STABLE', 'OBSERVE', 'DUMP', 'FAILSAFE'].includes(value) ? value : 'UNKNOWN';
  }

  private checkSLAViolations(
    metrics: any,
    successRate: number
  ): { critical: number; warnings: number } {
    let critical = 0;
    let warnings = 0;

    const latencyChecks = [
      { latency: Number(metrics.lastBugCaptureLatency || 0), critical: 100, warning: 80 },
      { latency: Number(metrics.lastPatternDetectionLatency || 0), critical: 500, warning: 400 },
      { latency: Number(metrics.lastFixApplicationLatency || 0), critical: 1000, warning: 800 }
    ];

    for (const check of latencyChecks) {
      if (check.latency <= 0) continue;
      if (check.latency > check.critical) critical++;
      else if (check.latency > check.warning) warnings++;
    }

    const fixesApplied = Number(metrics.fixesApplied || 0);
    const fixesRolledBack = Number(metrics.fixesRolledBack || 0);
    if (fixesApplied + fixesRolledBack > 0) {
      if (successRate < 80) critical++;
      else if (successRate < 90) warnings++;
    }

    return { critical, warnings };
  }

  private determineStatus(
    slaViolations: { critical: number; warnings: number },
    watchdogState: HealthStatus['watchdog_state'],
    evidenceGaps: string[]
  ): 'healthy' | 'degraded' | 'critical' {
    if (watchdogState === 'FAILSAFE' || slaViolations.critical > 0) return 'critical';
    if (watchdogState === 'UNKNOWN' || slaViolations.warnings > 0 || evidenceGaps.length > 0) return 'degraded';
    return 'healthy';
  }

  private calculateSuccessRate(metrics: any): number {
    const applied = Number(metrics.fixesApplied || 0);
    const rolledBack = Number(metrics.fixesRolledBack || 0);
    const total = applied + rolledBack;
    if (total === 0) return 100;
    return (applied / total) * 100;
  }

  private getMemoryUsage(): number {
    try {
      if (typeof process !== 'undefined' && typeof process.memoryUsage === 'function') {
        return Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
      }
    } catch (e) {
      console.error('[HealthCheck] Failed to get memory usage:', e);
    }
    return -1;
  }

  private getDiskFree(): number {
    try {
      const statfsSync = (fs as any).statfsSync as ((target: string) => any) | undefined;
      if (typeof statfsSync !== 'function') return -1;

      let target = this.metricsPath;
      while (!fs.existsSync(target)) {
        const parent = path.dirname(target);
        if (parent === target) return -1;
        target = parent;
      }

      const stats = statfsSync(target);
      const blockSize = Number(stats.bsize || stats.frsize || 0);
      const freeBlocks = Number(stats.bavail ?? stats.bfree ?? 0);
      if (blockSize <= 0 || !Number.isFinite(freeBlocks)) return -1;
      return Math.round(((blockSize * freeBlocks) / 1024 / 1024) * 100) / 100;
    } catch (e) {
      console.error('[HealthCheck] Failed to get disk free space:', e);
      return -1;
    }
  }

  toJSON(): string {
    return JSON.stringify(this.getHealth(), null, 2);
  }

  toHTTPResponse(): { statusCode: number; body: string; headers: Record<string, string> } {
    const health = this.getHealth();
    const statusCode = health.status === 'critical' ? 503 : health.status === 'degraded' ? 429 : 200;

    return {
      statusCode,
      body: JSON.stringify(health, null, 2),
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'X-Engine-Status': health.status,
        'X-Watchdog-State': health.watchdog_state
      }
    };
  }

  resetUptime(): void {
    this.startTime = Date.now();
  }
}

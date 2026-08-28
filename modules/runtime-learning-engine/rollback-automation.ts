import * as fs from 'fs';
import * as path from 'path';

/**
 * Automatic Rollback Automation
 *
 * Monitors metrics continuously and triggers automatic rollback
 * when thresholds are exceeded to prevent cascading failures.
 */

export interface RollbackTrigger {
  id: string;
  metric: string;
  threshold: number;
  comparison: '<' | '>' | '==' | '!=';
  severity: 'critical' | 'warning';
  enabled: boolean;
}

export interface RollbackEvent {
  timestamp: number;
  eventId: string;
  triggered: boolean;
  triggeringMetrics: string[];
  triggeringValues: Record<string, number>;
  rollbackExecuted: boolean;
  rollbackDuration: number;
  rollbackSuccess: boolean;
  reason: string;
  recoveryTime?: number;
}

export interface RollbackHistory {
  deploymentId: string;
  startTime: number;
  triggers: RollbackTrigger[];
  events: RollbackEvent[];
  statistics: {
    totalChecks: number;
    triggersDetected: number;
    rollbacksExecuted: number;
    successfulRollbacks: number;
    failedRollbacks: number;
    averageRollbackTime: number;
    mttc: number; // Mean Time To Correct
  };
}

export const DEFAULT_ROLLBACK_TRIGGERS: RollbackTrigger[] = [
  {
    id: 'success_rate_critical',
    metric: 'fix_success_rate',
    threshold: 70,
    comparison: '<',
    severity: 'critical',
    enabled: true
  },
  {
    id: 'error_rate_critical',
    metric: 'errors_per_hour',
    threshold: 50,
    comparison: '>',
    severity: 'critical',
    enabled: true
  },
  {
    id: 'memory_growth_warning',
    metric: 'memory_growth_mb_per_min',
    threshold: 10,
    comparison: '>',
    severity: 'warning',
    enabled: true
  },
  {
    id: 'rollback_success_rate_critical',
    metric: 'rollback_success_rate',
    threshold: 80,
    comparison: '<',
    severity: 'critical',
    enabled: true
  },
  {
    id: 'corruption_detected_critical',
    metric: 'corruption_count',
    threshold: 0,
    comparison: '!=',
    severity: 'critical',
    enabled: true
  },
  {
    id: 'watchdog_failsafe',
    metric: 'watchdog_state',
    threshold: 4, // FAILSAFE = 4
    comparison: '==',
    severity: 'critical',
    enabled: true
  },
  {
    id: 'storage_critical',
    metric: 'storage_used_mb',
    threshold: 900,
    comparison: '>',
    severity: 'critical',
    enabled: true
  },
  {
    id: 'bug_capture_latency_sla',
    metric: 'bug_capture_latency_ms',
    threshold: 200, // 2x the SLA threshold
    comparison: '>',
    severity: 'warning',
    enabled: true
  }
];

export class RollbackAutomation {
  private deploymentId: string;
  private triggers: RollbackTrigger[];
  private history: RollbackHistory;
  private storagePath: string;
  private lastMetricsCheck: number = 0;
  private metricsCheckInterval: number = 5000; // 5 seconds

  constructor(
    deploymentId: string,
    triggers?: RollbackTrigger[],
    storagePath: string = '/tmp/rollback-automation'
  ) {
    this.deploymentId = deploymentId;
    this.triggers = triggers || DEFAULT_ROLLBACK_TRIGGERS;
    this.storagePath = storagePath;

    this.history = {
      deploymentId,
      startTime: Date.now(),
      triggers: this.triggers,
      events: [],
      statistics: {
        totalChecks: 0,
        triggersDetected: 0,
        rollbacksExecuted: 0,
        successfulRollbacks: 0,
        failedRollbacks: 0,
        averageRollbackTime: 0,
        mttc: 0
      }
    };

    if (!fs.existsSync(storagePath)) {
      fs.mkdirSync(storagePath, { recursive: true });
    }
  }

  /**
   * Check if any rollback triggers are activated
   */
  checkTriggers(metrics: Record<string, number | string>): {
    triggered: boolean;
    triggeringMetrics: string[];
    severity: 'critical' | 'warning';
  } {
    const activeTriggers: string[] = [];
    let maxSeverity: 'critical' | 'warning' = 'warning';

    for (const trigger of this.triggers) {
      if (!trigger.enabled) continue;

      const value = metrics[trigger.metric];
      if (value === undefined) continue;

      let conditionMet = false;
      const numValue = typeof value === 'number' ? value : parseFloat(String(value));

      switch (trigger.comparison) {
        case '<':
          conditionMet = numValue < trigger.threshold;
          break;
        case '>':
          conditionMet = numValue > trigger.threshold;
          break;
        case '==':
          conditionMet = numValue === trigger.threshold;
          break;
        case '!=':
          conditionMet = numValue !== trigger.threshold;
          break;
      }

      if (conditionMet) {
        activeTriggers.push(trigger.id);
        if (trigger.severity === 'critical') {
          maxSeverity = 'critical';
        }
      }
    }

    return {
      triggered: activeTriggers.length > 0,
      triggeringMetrics: activeTriggers,
      severity: maxSeverity
    };
  }

  /**
   * Execute rollback procedure
   */
  async executeRollback(reason: string): Promise<RollbackEvent> {
    const rollbackStartTime = Date.now();
    const event: RollbackEvent = {
      timestamp: rollbackStartTime,
      eventId: `rollback-${rollbackStartTime}`,
      triggered: true,
      triggeringMetrics: [],
      triggeringValues: {},
      rollbackExecuted: false,
      rollbackDuration: 0,
      rollbackSuccess: false,
      reason
    };

    console.error(`[RollbackAutomation] ROLLBACK TRIGGERED: ${reason}`);

    try {
      // Step 1: Disable new version traffic
      console.log('[RollbackAutomation] Step 1: Disabling new version traffic...');
      await this.disableNewVersionTraffic();

      // Step 2: Restore previous version
      console.log('[RollbackAutomation] Step 2: Restoring previous version...');
      await this.restorePreviousVersion();

      // Step 3: Verify recovery
      console.log('[RollbackAutomation] Step 3: Verifying recovery...');
      const recoveryTime = await this.verifyRecovery();

      event.rollbackExecuted = true;
      event.rollbackSuccess = true;
      event.rollbackDuration = Date.now() - rollbackStartTime;
      event.recoveryTime = recoveryTime;

      this.history.statistics.rollbacksExecuted++;
      this.history.statistics.successfulRollbacks++;

      console.log(`[RollbackAutomation] Rollback completed successfully in ${event.rollbackDuration}ms`);

    } catch (e: any) {
      event.rollbackExecuted = true;
      event.rollbackSuccess = false;
      event.rollbackDuration = Date.now() - rollbackStartTime;
      event.reason = `${reason} (Rollback failed: ${e.message})`;

      this.history.statistics.rollbacksExecuted++;
      this.history.statistics.failedRollbacks++;

      console.error(`[RollbackAutomation] Rollback FAILED: ${e.message}`);
    }

    this.history.events.push(event);
    this.updateStatistics();
    this.saveHistory();

    return event;
  }

  /**
   * Monitor metrics continuously
   */
  async startMonitoring(metricsProvider: () => Promise<Record<string, number>>, interval: number = 5000): Promise<void> {
    console.log('[RollbackAutomation] Starting continuous monitoring...');

    const monitor = setInterval(async () => {
      try {
        const metrics = await metricsProvider();
        this.history.statistics.totalChecks++;

        const check = this.checkTriggers(metrics);

        if (check.triggered) {
          this.history.statistics.triggersDetected++;
          console.warn(`[RollbackAutomation] Triggers detected: ${check.triggeringMetrics.join(', ')}`);

          if (check.severity === 'critical') {
            clearInterval(monitor);
            await this.executeRollback(`Critical triggers: ${check.triggeringMetrics.join(', ')}`);
          }
        }

      } catch (e: any) {
        console.error('[RollbackAutomation] Monitoring error:', e.message);
      }
    }, interval);

    return new Promise(() => {}); // Runs forever until cleared
  }

  /**
   * Disable new version traffic (simulated)
   */
  private async disableNewVersionTraffic(): Promise<void> {
    // In production, this would:
    // - Update load balancer rules
    // - Stop accepting new requests to new version
    // - Drain existing connections
    return new Promise(resolve => setTimeout(resolve, 1000));
  }

  /**
   * Restore previous version (simulated)
   */
  private async restorePreviousVersion(): Promise<void> {
    // In production, this would:
    // - Activate previous version deployment
    // - Re-route traffic back to stable version
    // - Verify connectivity
    return new Promise(resolve => setTimeout(resolve, 2000));
  }

  /**
   * Verify recovery (simulated)
   */
  private async verifyRecovery(): Promise<number> {
    // In production, this would:
    // - Check health endpoints
    // - Verify error rates returning to baseline
    // - Monitor metrics for improvement
    const startTime = Date.now();
    let recovered = false;
    let attempts = 0;
    const maxAttempts = 10;

    while (!recovered && attempts < maxAttempts) {
      // Simulate health check
      await new Promise(resolve => setTimeout(resolve, 500));
      attempts++;
      recovered = Math.random() > 0.3; // 70% chance of recovery
    }

    return Date.now() - startTime;
  }

  /**
   * Update statistics
   */
  private updateStatistics(): void {
    const successfulRollbacks = this.history.events.filter(e => e.rollbackSuccess);
    if (successfulRollbacks.length > 0) {
      const totalDuration = successfulRollbacks.reduce((sum, e) => sum + e.rollbackDuration, 0);
      this.history.statistics.averageRollbackTime = totalDuration / successfulRollbacks.length;

      const totalRecoveryTime = successfulRollbacks.reduce((sum, e) => sum + (e.recoveryTime || 0), 0);
      this.history.statistics.mttc = totalRecoveryTime / successfulRollbacks.length;
    }
  }

  /**
   * Save history to disk
   */
  private saveHistory(): void {
    const historyPath = path.join(this.storagePath, `rollback-history-${this.deploymentId}.json`);
    fs.writeFileSync(historyPath, JSON.stringify(this.history, null, 2));
  }

  /**
   * Get history
   */
  getHistory(): RollbackHistory {
    return this.history;
  }

  /**
   * Generate report
   */
  generateReport(): string {
    const stats = this.history.statistics;
    const lines = [
      '\n=== Rollback Automation Report ===',
      `Deployment ID: ${this.deploymentId}`,
      `Duration: ${Math.round((Date.now() - this.history.startTime) / 1000)}s`,
      '',
      '--- Statistics ---',
      `Total Metric Checks: ${stats.totalChecks}`,
      `Triggers Detected: ${stats.triggersDetected}`,
      `Rollbacks Executed: ${stats.rollbacksExecuted}`,
      `Successful: ${stats.successfulRollbacks}`,
      `Failed: ${stats.failedRollbacks}`,
      `Average Rollback Time: ${stats.averageRollbackTime.toFixed(0)}ms`,
      `Mean Time To Correct (MTTC): ${stats.mttc.toFixed(0)}ms`,
      '',
      '--- Rollback Events ---'
    ];

    for (const event of this.history.events) {
      lines.push(`\nEvent: ${event.eventId}`);
      lines.push(`Time: ${new Date(event.timestamp).toISOString()}`);
      lines.push(`Status: ${event.rollbackSuccess ? 'SUCCESS ✅' : 'FAILED ❌'}`);
      lines.push(`Duration: ${event.rollbackDuration}ms`);
      lines.push(`Reason: ${event.reason}`);
      if (event.recoveryTime) {
        lines.push(`Recovery Time: ${event.recoveryTime}ms`);
      }
    }

    lines.push('');

    return lines.join('\n');
  }
}

/**
 * Usage example:
 *
 * const automation = new RollbackAutomation('deployment-001');
 *
 * // Define metrics provider
 * const metricsProvider = async () => ({
 *   fix_success_rate: 72,
 *   errors_per_hour: 45,
 *   memory_growth_mb_per_min: 5,
 *   rollback_success_rate: 95,
 *   corruption_count: 0,
 *   watchdog_state: 1,
 *   storage_used_mb: 450,
 *   bug_capture_latency_ms: 60
 * });
 *
 * // Start monitoring
 * automation.startMonitoring(metricsProvider, 5000);
 *
 * // Check triggers manually
 * const metrics = await metricsProvider();
 * const check = automation.checkTriggers(metrics);
 * if (check.triggered) {
 *   await automation.executeRollback(`Detected: ${check.triggeringMetrics.join(', ')}`);
 * }
 */

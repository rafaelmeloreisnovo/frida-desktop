import * as fs from 'fs';
import * as path from 'path';

export type CanaryStage = 'canary' | 'beta' | 'stable' | 'rollback';

export interface Rollout {
  rollout_id: string;
  version: string;
  stage: CanaryStage;
  traffic_percentage: number;
  start_time: number;
  end_time?: number;
  success_rate: number;
  error_rate: number;
  status: 'in_progress' | 'completed' | 'rolled_back';
  affected_users: number;
  errors: string[];
}

export interface RolloutMetrics {
  timestamp: number;
  rollout_id: string;
  requests_processed: number;
  requests_failed: number;
  errors: { [key: string]: number };
}

export class RolloutManager {
  private storagePath: string;
  private rolloutPath: string;
  private metricsPath: string;
  private currentRollout: Rollout | null = null;
  private metrics: RolloutMetrics[] = [];

  constructor(storagePath: string = '/data/local/tmp/frida-learning') {
    this.storagePath = storagePath;
    this.rolloutPath = path.join(storagePath, 'rollouts.json');
    this.metricsPath = path.join(storagePath, 'rollout-metrics.json');
    this.ensureDirectory();
    this.loadRolloutData();
  }

  private ensureDirectory(): void {
    if (!fs.existsSync(this.storagePath)) {
      fs.mkdirSync(this.storagePath, { recursive: true });
    }
  }

  private loadRolloutData(): void {
    try {
      if (fs.existsSync(this.rolloutPath)) {
        const data = fs.readFileSync(this.rolloutPath, 'utf-8');
        const parsed = JSON.parse(data);
        const rollouts = parsed.rollouts || [];
        if (rollouts.length > 0) {
          this.currentRollout = rollouts[rollouts.length - 1];
        }
      }

      if (fs.existsSync(this.metricsPath)) {
        const data = fs.readFileSync(this.metricsPath, 'utf-8');
        const parsed = JSON.parse(data);
        this.metrics = parsed.metrics || [];
      }
    } catch (e) {
      console.warn('[RolloutManager] Failed to load rollout data:', e);
    }
  }

  private saveRolloutData(): void {
    try {
      if (this.currentRollout) {
        fs.writeFileSync(
          this.rolloutPath,
          JSON.stringify(
            { rollouts: [this.currentRollout] },
            null,
            2
          ),
          'utf-8'
        );
      }

      fs.writeFileSync(
        this.metricsPath,
        JSON.stringify({ metrics: this.metrics.slice(-1000) }, null, 2),
        'utf-8'
      );
    } catch (e) {
      console.error('[RolloutManager] Failed to save rollout data:', e);
    }
  }

  startCanaryRollout(version: string): Rollout {
    const rollout: Rollout = {
      rollout_id: `rollout_${Date.now()}`,
      version,
      stage: 'canary',
      traffic_percentage: 5,
      start_time: Date.now(),
      success_rate: 100,
      error_rate: 0,
      status: 'in_progress',
      affected_users: 0,
      errors: []
    };

    this.currentRollout = rollout;
    this.saveRolloutData();

    console.log(
      `[RolloutManager] Started canary rollout for version ${version}: 5% traffic`
    );

    return rollout;
  }

  async progressRollout(): Promise<Rollout | null> {
    if (!this.currentRollout || this.currentRollout.status !== 'in_progress') {
      return null;
    }

    const now = Date.now();
    const duration = now - this.currentRollout.start_time;
    const stageDurationMs = 5 * 60 * 1000;

    if (duration < stageDurationMs) {
      return this.currentRollout;
    }

    const errorRate = this.currentRollout.error_rate;
    const successRate = this.currentRollout.success_rate;

    if (errorRate > 5 || successRate < 95) {
      console.warn(
        `[RolloutManager] High error rate (${errorRate.toFixed(2)}%) or low success rate (${successRate.toFixed(2)}%) detected`
      );
      return await this.rollback();
    }

    if (this.currentRollout.stage === 'canary' && this.currentRollout.traffic_percentage < 25) {
      this.currentRollout.stage = 'beta';
      this.currentRollout.traffic_percentage = 25;
      this.currentRollout.start_time = now;

      console.log(
        `[RolloutManager] Progressed to beta: 25% traffic for version ${this.currentRollout.version}`
      );
    } else if (this.currentRollout.stage === 'beta' && this.currentRollout.traffic_percentage < 50) {
      this.currentRollout.stage = 'beta';
      this.currentRollout.traffic_percentage = 50;
      this.currentRollout.start_time = now;

      console.log(
        `[RolloutManager] Progressed to 50% beta: version ${this.currentRollout.version}`
      );
    } else if (this.currentRollout.traffic_percentage < 100) {
      this.currentRollout.stage = 'stable';
      this.currentRollout.traffic_percentage = 100;
      this.currentRollout.status = 'completed';
      this.currentRollout.end_time = now;

      console.log(
        `[RolloutManager] Rollout completed to 100% (stable): version ${this.currentRollout.version}`
      );
    }

    this.saveRolloutData();
    return this.currentRollout;
  }

  async rollback(): Promise<Rollout> {
    if (!this.currentRollout) {
      throw new Error('No active rollout to rollback');
    }

    console.warn(
      `[RolloutManager] Rolling back version ${this.currentRollout.version} at stage ${this.currentRollout.stage}`
    );

    this.currentRollout.status = 'rolled_back';
    this.currentRollout.stage = 'rollback';
    this.currentRollout.end_time = Date.now();
    this.currentRollout.traffic_percentage = 0;

    this.saveRolloutData();
    return this.currentRollout;
  }

  recordMetric(
    requestsProcessed: number,
    requestsFailed: number,
    errors: { [key: string]: number } = {}
  ): void {
    if (!this.currentRollout) return;

    const metric: RolloutMetrics = {
      timestamp: Date.now(),
      rollout_id: this.currentRollout.rollout_id,
      requests_processed: requestsProcessed,
      requests_failed: requestsFailed,
      errors
    };

    this.metrics.push(metric);

    const successRate =
      requestsProcessed > 0
        ? ((requestsProcessed - requestsFailed) / requestsProcessed) * 100
        : 100;
    const errorRate =
      requestsProcessed > 0 ? (requestsFailed / requestsProcessed) * 100 : 0;

    this.currentRollout.success_rate = successRate;
    this.currentRollout.error_rate = errorRate;

    for (const [error, count] of Object.entries(errors)) {
      if (count > 5 && !this.currentRollout.errors.includes(error)) {
        this.currentRollout.errors.push(error);
      }
    }

    this.saveRolloutData();
  }

  getCurrentRollout(): Rollout | null {
    return this.currentRollout ? { ...this.currentRollout } : null;
  }

  canDeployVersion(version: string): {
    can_deploy: boolean;
    reason: string;
  } {
    if (!this.currentRollout) {
      return { can_deploy: true, reason: 'No active rollout' };
    }

    if (this.currentRollout.status === 'in_progress') {
      return {
        can_deploy: false,
        reason: `Active rollout for version ${this.currentRollout.version} in progress`
      };
    }

    if (this.currentRollout.status === 'completed') {
      return { can_deploy: true, reason: 'Previous rollout completed successfully' };
    }

    return {
      can_deploy: false,
      reason: 'Previous rollout was rolled back, waiting before retry'
    };
  }

  getRolloutMetrics(): {
    current_stage: CanaryStage | null;
    traffic_percentage: number;
    success_rate: number;
    error_rate: number;
    duration_minutes: number;
    affected_users: number;
  } {
    if (!this.currentRollout) {
      return {
        current_stage: null,
        traffic_percentage: 0,
        success_rate: 100,
        error_rate: 0,
        duration_minutes: 0,
        affected_users: 0
      };
    }

    const duration = (this.currentRollout.end_time || Date.now()) - this.currentRollout.start_time;

    return {
      current_stage: this.currentRollout.stage,
      traffic_percentage: this.currentRollout.traffic_percentage,
      success_rate: this.currentRollout.success_rate,
      error_rate: this.currentRollout.error_rate,
      duration_minutes: Math.floor(duration / 60000),
      affected_users: this.currentRollout.affected_users
    };
  }

  getRecentMetrics(limit: number = 100): RolloutMetrics[] {
    return this.metrics.slice(-limit);
  }

  getPredictedSuccessForNextStage(): number {
    if (!this.currentRollout || this.currentRollout.traffic_percentage >= 100) {
      return 100;
    }

    return Math.max(0, Math.min(100, this.currentRollout.success_rate - (5 - this.currentRollout.traffic_percentage / 20)));
  }
}

export function createRolloutManager(storagePath?: string): RolloutManager {
  return new RolloutManager(storagePath);
}

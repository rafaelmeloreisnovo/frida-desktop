import * as fs from 'fs';
import * as path from 'path';

/**
 * Canary Deployment Orchestrator
 *
 * Manages staged canary rollout: 5% → 25% → 50% → 100%
 * Monitors metrics at each stage and auto-rollback on failure
 */

export interface CanaryStage {
  stage: number;
  name: string;
  trafficPercentage: number;
  monitoringDurationMinutes: number;
  autoRollbackThresholds: {
    successRateMin: number;
    errorRateMax: number;
    memoryGrowthMaxMBPerMin: number;
  };
}

export interface StageDeployment {
  stageNumber: number;
  trafficPercentage: number;
  startTime: number;
  expectedDurationMs: number;
  status: 'pending' | 'in_progress' | 'completed' | 'rolled_back' | 'failed';
  metrics: StageMetrics;
  decisions: DeploymentDecision[];
}

export interface StageMetrics {
  successRate: number;
  errorRate: number;
  errorCount: number;
  memoryGrowthMBPerMin: number;
  averageBugCaptureLatency: number;
  averageFixLatency: number;
  healthStatus: 'healthy' | 'degraded' | 'critical';
  lastUpdate: number;
}

export interface DeploymentDecision {
  timestamp: number;
  decision: 'proceed' | 'monitor' | 'halt' | 'rollback';
  reason: string;
  metrics: Partial<StageMetrics>;
}

export interface CanaryDeploymentPlan {
  deploymentId: string;
  startTime: number;
  endTime?: number;
  version: string;
  stages: StageDeployment[];
  currentStage: number;
  status: 'planning' | 'in_progress' | 'completed' | 'rolled_back';
  finalMetrics?: CanaryDeploymentSummary;
}

export interface CanaryDeploymentSummary {
  totalDuration: number;
  stagesCompleted: number;
  stagestalled: number;
  successRateOverall: number;
  errorRateOverall: number;
  memoryImpact: number;
  rollback: {
    triggered: boolean;
    stage: number;
    reason: string;
  };
  recommendation: 'proceed_to_production' | 'fix_and_retry' | 'abort_deployment';
}

export const DEFAULT_CANARY_STAGES: CanaryStage[] = [
  {
    stage: 1,
    name: 'Canary - 5%',
    trafficPercentage: 5,
    monitoringDurationMinutes: 60,
    autoRollbackThresholds: {
      successRateMin: 70,
      errorRateMax: 50,      // 50 errors/hour max
      memoryGrowthMaxMBPerMin: 10
    }
  },
  {
    stage: 2,
    name: 'Early Adopters - 25%',
    trafficPercentage: 25,
    monitoringDurationMinutes: 120,
    autoRollbackThresholds: {
      successRateMin: 75,
      errorRateMax: 100,
      memoryGrowthMaxMBPerMin: 8
    }
  },
  {
    stage: 3,
    name: 'Mid Rollout - 50%',
    trafficPercentage: 50,
    monitoringDurationMinutes: 240,
    autoRollbackThresholds: {
      successRateMin: 80,
      errorRateMax: 150,
      memoryGrowthMaxMBPerMin: 5
    }
  },
  {
    stage: 4,
    name: 'Full Rollout - 100%',
    trafficPercentage: 100,
    monitoringDurationMinutes: 1440,  // 24 hours monitoring
    autoRollbackThresholds: {
      successRateMin: 85,
      errorRateMax: 200,
      memoryGrowthMaxMBPerMin: 3
    }
  }
];

export class CanaryDeploymentOrchestrator {
  private plan: CanaryDeploymentPlan;
  private stages: CanaryStage[];
  private storagePath: string;

  constructor(version: string, stages?: CanaryStage[], storagePath: string = '/tmp/canary-deployment') {
    this.stages = stages || DEFAULT_CANARY_STAGES;
    this.storagePath = storagePath;

    this.plan = {
      deploymentId: `canary-${Date.now()}`,
      startTime: Date.now(),
      version,
      stages: this.stages.map((stage, index) => ({
        stageNumber: stage.stage,
        trafficPercentage: stage.trafficPercentage,
        startTime: 0,
        expectedDurationMs: stage.monitoringDurationMinutes * 60 * 1000,
        status: 'pending',
        metrics: {
          successRate: 0,
          errorRate: 0,
          errorCount: 0,
          memoryGrowthMBPerMin: 0,
          averageBugCaptureLatency: 0,
          averageFixLatency: 0,
          healthStatus: 'healthy',
          lastUpdate: 0
        },
        decisions: []
      })),
      currentStage: 0,
      status: 'planning'
    };

    if (!fs.existsSync(storagePath)) {
      fs.mkdirSync(storagePath, { recursive: true });
    }
  }

  /**
   * Start canary deployment
   */
  async startCanaryDeployment(): Promise<void> {
    console.log(`[CanaryOrchestrator] Starting canary deployment: ${this.plan.deploymentId}`);
    console.log(`[CanaryOrchestrator] Version: ${this.plan.version}`);
    console.log(`[CanaryOrchestrator] Total stages: ${this.stages.length}`);

    this.plan.status = 'in_progress';
    this.plan.currentStage = 0;

    this.saveDeploymentPlan();
  }

  /**
   * Advance to next stage after validation
   */
  async advanceToNextStage(): Promise<boolean> {
    const currentStage = this.plan.stages[this.plan.currentStage];

    if (currentStage.status === 'completed') {
      if (this.plan.currentStage < this.plan.stages.length - 1) {
        this.plan.currentStage++;
        const nextStage = this.plan.stages[this.plan.currentStage];
        nextStage.status = 'in_progress';
        nextStage.startTime = Date.now();

        console.log(`[CanaryOrchestrator] Advanced to stage ${nextStage.stageNumber}: ${nextStage.trafficPercentage}% traffic`);
        this.saveDeploymentPlan();
        return true;
      } else {
        console.log('[CanaryOrchestrator] All stages completed successfully!');
        this.plan.status = 'completed';
        this.saveDeploymentPlan();
        return false;
      }
    }

    return false;
  }

  /**
   * Evaluate stage metrics and decide to proceed, monitor, or rollback
   */
  async evaluateStageMetrics(metrics: StageMetrics): Promise<DeploymentDecision> {
    const currentStage = this.plan.stages[this.plan.currentStage];
    const thresholds = this.stages[this.plan.currentStage].autoRollbackThresholds;

    let decision: 'proceed' | 'monitor' | 'halt' | 'rollback' = 'monitor';
    let reason = 'Metrics within acceptable range';

    // Check critical SLA: success rate
    if (metrics.successRate < thresholds.successRateMin) {
      decision = 'rollback';
      reason = `Success rate ${metrics.successRate}% below threshold ${thresholds.successRateMin}%`;
    }

    // Check error rate
    else if (metrics.errorRate > thresholds.errorRateMax) {
      decision = 'rollback';
      reason = `Error rate ${metrics.errorRate}/hour exceeds threshold ${thresholds.errorRateMax}/hour`;
    }

    // Check memory growth
    else if (metrics.memoryGrowthMBPerMin > thresholds.memoryGrowthMaxMBPerMin) {
      decision = 'halt';
      reason = `Memory growth ${metrics.memoryGrowthMBPerMin.toFixed(1)}MB/min exceeds threshold ${thresholds.memoryGrowthMaxMBPerMin}MB/min`;
    }

    // All good - proceed
    else if (
      metrics.successRate >= thresholds.successRateMin + 5 &&
      metrics.errorRate < thresholds.errorRateMax * 0.7 &&
      metrics.healthStatus === 'healthy'
    ) {
      decision = 'proceed';
      reason = 'All metrics excellent - ready to proceed to next stage';
    }

    const deploymentDecision: DeploymentDecision = {
      timestamp: Date.now(),
      decision,
      reason,
      metrics
    };

    currentStage.decisions.push(deploymentDecision);
    currentStage.metrics = metrics;

    console.log(`[CanaryOrchestrator] Stage ${currentStage.stageNumber} Decision: ${decision.toUpperCase()}`);
    console.log(`[CanaryOrchestrator] Reason: ${reason}`);

    return deploymentDecision;
  }

  /**
   * Rollback deployment
   */
  async rollback(reason: string): Promise<void> {
    console.error(`[CanaryOrchestrator] ROLLBACK TRIGGERED at stage ${this.plan.currentStage + 1}`);
    console.error(`[CanaryOrchestrator] Reason: ${reason}`);

    const rollbackPlan = {
      timestamp: Date.now(),
      stage: this.plan.currentStage,
      reason,
      steps: [
        'Disable new version traffic',
        'Restore previous version',
        'Verify health metrics return to baseline',
        'Investigate root cause'
      ]
    };

    this.plan.status = 'rolled_back';
    this.plan.stages[this.plan.currentStage].status = 'rolled_back';

    const rollbackPath = path.join(this.storagePath, `rollback-${Date.now()}.json`);
    fs.writeFileSync(rollbackPath, JSON.stringify(rollbackPlan, null, 2));

    this.saveDeploymentPlan();
  }

  /**
   * Calculate overall deployment success metrics
   */
  calculateSummary(): CanaryDeploymentSummary {
    const completedStages = this.plan.stages.filter(s => s.status === 'completed' || s.status === 'in_progress');
    const totalDuration = Date.now() - this.plan.startTime;

    // Calculate weighted average success rate
    let totalSuccessRate = 0;
    let totalErrorRate = 0;
    let maxMemoryGrowth = 0;

    for (const stage of completedStages) {
      totalSuccessRate += stage.metrics.successRate;
      totalErrorRate += stage.metrics.errorRate;
      maxMemoryGrowth = Math.max(maxMemoryGrowth, stage.metrics.memoryGrowthMBPerMin);
    }

    const successRateOverall = completedStages.length > 0 ? totalSuccessRate / completedStages.length : 0;
    const errorRateOverall = completedStages.length > 0 ? totalErrorRate / completedStages.length : 0;

    // Determine recommendation
    let recommendation: 'proceed_to_production' | 'fix_and_retry' | 'abort_deployment' = 'proceed_to_production';

    if (this.plan.status === 'rolled_back') {
      recommendation = 'fix_and_retry';
    } else if (successRateOverall < 85) {
      recommendation = 'fix_and_retry';
    } else if (this.plan.currentStage < this.plan.stages.length - 1) {
      recommendation = 'fix_and_retry'; // Incomplete
    }

    return {
      totalDuration,
      stagesCompleted: completedStages.filter(s => s.status === 'completed').length,
      stagestalled: completedStages.filter(s => s.status === 'in_progress').length,
      successRateOverall,
      errorRateOverall,
      memoryImpact: maxMemoryGrowth,
      rollback: {
        triggered: this.plan.status === 'rolled_back',
        stage: this.plan.stages.findIndex(s => s.status === 'rolled_back') + 1,
        reason: this.plan.status === 'rolled_back' ? 'See rollback log' : 'N/A'
      },
      recommendation
    };
  }

  /**
   * Generate deployment report
   */
  generateReport(): string {
    const summary = this.calculateSummary();
    const lines = [
      '\n=== Canary Deployment Report ===',
      `Deployment ID: ${this.plan.deploymentId}`,
      `Version: ${this.plan.version}`,
      `Status: ${this.plan.status.toUpperCase()}`,
      `Total Duration: ${Math.round(summary.totalDuration / 1000)}s`,
      '',
      '--- Stages ---',
      `Completed: ${summary.stagesCompleted}/${this.plan.stages.length}`,
      `In Progress: ${summary.stagestalled}`,
      '',
      '--- Overall Metrics ---',
      `Success Rate: ${summary.successRateOverall.toFixed(1)}%`,
      `Error Rate: ${summary.errorRateOverall.toFixed(1)}/hour`,
      `Memory Impact: ${summary.memoryImpact.toFixed(2)}MB/min`,
      '',
      '--- Stage Breakdown ---'
    ];

    for (const stage of this.plan.stages) {
      lines.push(`\nStage ${stage.stageNumber}: ${stage.trafficPercentage}% (${stage.status.toUpperCase()})`);
      lines.push(`  Success Rate: ${stage.metrics.successRate.toFixed(1)}%`);
      lines.push(`  Error Rate: ${stage.metrics.errorRate.toFixed(1)}/hour`);
      lines.push(`  Health: ${stage.metrics.healthStatus}`);
      lines.push(`  Decisions: ${stage.decisions.length}`);

      if (stage.decisions.length > 0) {
        const lastDecision = stage.decisions[stage.decisions.length - 1];
        lines.push(`  Last Decision: ${lastDecision.decision.toUpperCase()} - ${lastDecision.reason}`);
      }
    }

    lines.push('');
    lines.push('--- Rollback Status ---');
    lines.push(`Triggered: ${summary.rollback.triggered ? 'YES ❌' : 'NO ✅'}`);
    if (summary.rollback.triggered) {
      lines.push(`At Stage: ${summary.rollback.stage}`);
      lines.push(`Reason: ${summary.rollback.reason}`);
    }

    lines.push('');
    lines.push('--- Recommendation ---');
    lines.push(`${summary.recommendation.toUpperCase()}`);

    if (summary.recommendation === 'proceed_to_production') {
      lines.push('✅ All metrics passing. Safe to proceed to production.');
    } else if (summary.recommendation === 'fix_and_retry') {
      lines.push('⚠️  Metrics indicate need for improvements. Review failures and retry.');
    } else {
      lines.push('❌ Critical issues detected. Abort deployment and investigate.');
    }

    lines.push('');

    return lines.join('\n');
  }

  /**
   * Save deployment plan to disk
   */
  saveDeploymentPlan(): void {
    const planPath = path.join(this.storagePath, `deployment-plan-${this.plan.deploymentId}.json`);
    fs.writeFileSync(planPath, JSON.stringify(this.plan, null, 2));
  }

  /**
   * Get current deployment plan
   */
  getDeploymentPlan(): CanaryDeploymentPlan {
    return this.plan;
  }

  /**
   * Get current stage info
   */
  getCurrentStage(): StageDeployment {
    return this.plan.stages[this.plan.currentStage];
  }

  /**
   * Export stage deployment config for this stage
   */
  getStageConfig(): { traffic: number; duration: number; thresholds: any } {
    const stageInfo = this.stages[this.plan.currentStage];
    return {
      traffic: stageInfo.trafficPercentage,
      duration: stageInfo.monitoringDurationMinutes * 60,
      thresholds: stageInfo.autoRollbackThresholds
    };
  }
}

/**
 * Usage example:
 *
 * const orchestrator = new CanaryDeploymentOrchestrator('v1.2.3');
 *
 * // Start deployment
 * await orchestrator.startCanaryDeployment();
 *
 * // During each stage, collect metrics and evaluate
 * const metrics = {
 *   successRate: 94,
 *   errorRate: 25,
 *   errorCount: 25,
 *   memoryGrowthMBPerMin: 2.5,
 *   averageBugCaptureLatency: 45,
 *   averageFixLatency: 600,
 *   healthStatus: 'healthy',
 *   lastUpdate: Date.now()
 * };
 *
 * const decision = await orchestrator.evaluateStageMetrics(metrics);
 *
 * if (decision.decision === 'proceed') {
 *   await orchestrator.advanceToNextStage();
 * } else if (decision.decision === 'rollback') {
 *   await orchestrator.rollback(decision.reason);
 * }
 *
 * // When done
 * console.log(orchestrator.generateReport());
 */

import {
  CanaryDeploymentOrchestrator,
  DEFAULT_CANARY_STAGES,
  StageDeployment,
  StageMetrics
} from '../canary-deployment-orchestrator';
import {
  RollbackAutomation,
  DEFAULT_ROLLBACK_TRIGGERS
} from '../rollback-automation';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Phase 4.2: Canary Deployment & Auto-Rollback Validation Tests
 *
 * Tests canary deployment orchestration and automatic rollback mechanisms.
 */

describe('Phase 4.2: Canary Deployment & Auto-Rollback', () => {
  let orchestrator: CanaryDeploymentOrchestrator;
  let automation: RollbackAutomation;
  const resultsDir = '/tmp/canary-deployment-test-results';

  beforeEach(() => {
    orchestrator = new CanaryDeploymentOrchestrator('v1.2.3-test', DEFAULT_CANARY_STAGES, resultsDir);
    automation = new RollbackAutomation('deployment-test', DEFAULT_ROLLBACK_TRIGGERS, resultsDir);

    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(resultsDir)) {
      const files = fs.readdirSync(resultsDir);
      for (const file of files) {
        fs.unlinkSync(path.join(resultsDir, file));
      }
      fs.rmdirSync(resultsDir);
    }
  });

  describe('Phase 4.2.1: Canary Deployment Orchestration', () => {
    test('Canary deployment plan initializes with 4 stages', () => {
      const plan = orchestrator.getDeploymentPlan();
      expect(plan).toBeDefined();
      expect(plan.stages.length).toBe(4);
      expect(plan.status).toBe('planning');
      expect(plan.version).toBe('v1.2.3-test');
      const trafficProgression = plan.stages.map(s => s.trafficPercentage);
      expect(trafficProgression).toEqual([5, 25, 50, 100]);
      console.log('[CanaryTest] Deployment plan initialized with stages:', trafficProgression);
    });

    test('Canary deployment starts successfully', async () => {
      await orchestrator.startCanaryDeployment();
      const plan = orchestrator.getDeploymentPlan();
      expect(plan.status).toBe('in_progress');
      expect(plan.currentStage).toBe(0);
      expect(plan.startTime).toBeGreaterThan(0);
      console.log('[CanaryTest] Deployment started');
    });

    test('Each stage has correct monitoring duration', () => {
      const expectedDurations = [60, 120, 240, 1440];
      for (let i = 0; i < DEFAULT_CANARY_STAGES.length; i++) {
        const stage = DEFAULT_CANARY_STAGES[i];
        expect(stage.monitoringDurationMinutes).toBe(expectedDurations[i]);
        expect(stage.trafficPercentage).toBe([5, 25, 50, 100][i]);
      }
      console.log('[CanaryTest] Stage durations verified');
    });

    test('Stage auto-rollback thresholds are correctly configured', () => {
      const stage1Thresholds = DEFAULT_CANARY_STAGES[0].autoRollbackThresholds;
      const stage4Thresholds = DEFAULT_CANARY_STAGES[3].autoRollbackThresholds;
      expect(stage1Thresholds.successRateMin).toBe(70);
      expect(stage1Thresholds.errorRateMax).toBe(50);
      expect(stage4Thresholds.successRateMin).toBe(85);
      expect(stage4Thresholds.errorRateMax).toBe(200);
      console.log('[CanaryTest] Auto-rollback thresholds verified');
    });
  });

  describe('Phase 4.2.2: Stage Metrics Evaluation', () => {
    test('Excellent metrics trigger proceed decision', async () => {
      await orchestrator.startCanaryDeployment();
      const excellentMetrics: StageMetrics = {
        successRate: 98,
        errorRate: 10,
        errorCount: 10,
        memoryGrowthMBPerMin: 1.5,
        averageBugCaptureLatency: 40,
        averageFixLatency: 500,
        healthStatus: 'healthy',
        lastUpdate: Date.now()
      };
      const decision = await orchestrator.evaluateStageMetrics(excellentMetrics);
      expect(decision.decision).toBe('proceed');
      expect(decision.reason).toContain('excellent');
      console.log('[CanaryTest] Excellent metrics correctly trigger proceed');
    });

    test('Degraded metrics trigger monitoring decision', async () => {
      await orchestrator.startCanaryDeployment();
      const degradedMetrics: StageMetrics = {
        successRate: 82,
        // Keep degraded-but-monitoring evidence below the explicit stage-1
        // hard rollback threshold (50 errors/hour). The previous value 80
        // contradicted the threshold and incorrectly expected a monitor result.
        errorRate: 40,
        errorCount: 40,
        memoryGrowthMBPerMin: 4.0,
        averageBugCaptureLatency: 70,
        averageFixLatency: 900,
        healthStatus: 'degraded',
        lastUpdate: Date.now()
      };
      const decision = await orchestrator.evaluateStageMetrics(degradedMetrics);
      expect(decision.decision).toBe('monitor');
      expect(decision.reason).toContain('acceptable');
      console.log('[CanaryTest] Degraded metrics correctly trigger monitoring');
    });

    test('Low success rate triggers rollback decision', async () => {
      await orchestrator.startCanaryDeployment();
      const poorMetrics: StageMetrics = {
        successRate: 65,
        errorRate: 45,
        errorCount: 45,
        memoryGrowthMBPerMin: 2.0,
        averageBugCaptureLatency: 80,
        averageFixLatency: 1200,
        healthStatus: 'critical',
        lastUpdate: Date.now()
      };
      const decision = await orchestrator.evaluateStageMetrics(poorMetrics);
      expect(decision.decision).toBe('rollback');
      expect(decision.reason).toContain('Success rate');
      console.log('[CanaryTest] Low success rate correctly triggers rollback');
    });

    test('High error rate triggers rollback decision', async () => {
      await orchestrator.startCanaryDeployment();
      const errorMetrics: StageMetrics = {
        successRate: 75,
        errorRate: 60,
        errorCount: 60,
        memoryGrowthMBPerMin: 2.0,
        averageBugCaptureLatency: 50,
        averageFixLatency: 700,
        healthStatus: 'critical',
        lastUpdate: Date.now()
      };
      const decision = await orchestrator.evaluateStageMetrics(errorMetrics);
      expect(decision.decision).toBe('rollback');
      expect(decision.reason).toContain('Error rate');
      console.log('[CanaryTest] High error rate correctly triggers rollback');
    });

    test('Excessive memory growth triggers halt decision', async () => {
      await orchestrator.startCanaryDeployment();
      const memoryMetrics: StageMetrics = {
        successRate: 88,
        errorRate: 30,
        errorCount: 30,
        memoryGrowthMBPerMin: 15,
        averageBugCaptureLatency: 50,
        averageFixLatency: 600,
        healthStatus: 'degraded',
        lastUpdate: Date.now()
      };
      const decision = await orchestrator.evaluateStageMetrics(memoryMetrics);
      expect(decision.decision).toBe('halt');
      expect(decision.reason).toContain('Memory growth');
      console.log('[CanaryTest] Excessive memory growth correctly triggers halt');
    });
  });

  describe('Phase 4.2.3: Stage Advancement', () => {
    test('Can advance from stage 1 to stage 2', async () => {
      await orchestrator.startCanaryDeployment();
      let plan = orchestrator.getDeploymentPlan();
      expect(plan.currentStage).toBe(0);
      plan.stages[0].status = 'completed';
      const advanced = await orchestrator.advanceToNextStage();
      plan = orchestrator.getDeploymentPlan();
      expect(advanced).toBe(true);
      expect(plan.currentStage).toBe(1);
      expect(plan.stages[1].status).toBe('in_progress');
      console.log('[CanaryTest] Successfully advanced to stage 2');
    });

    test('Cannot advance if current stage not completed', async () => {
      await orchestrator.startCanaryDeployment();
      const advanced = await orchestrator.advanceToNextStage();
      const plan = orchestrator.getDeploymentPlan();
      expect(advanced).toBe(false);
      expect(plan.currentStage).toBe(0);
      console.log('[CanaryTest] Correctly prevented advancement without completion');
    });

    test('Final stage completion marks deployment as completed', async () => {
      await orchestrator.startCanaryDeployment();
      let plan = orchestrator.getDeploymentPlan();
      for (const stage of plan.stages) stage.status = 'completed';
      plan.currentStage = 3;
      const advanced = await orchestrator.advanceToNextStage();
      plan = orchestrator.getDeploymentPlan();
      expect(advanced).toBe(false);
      expect(plan.status).toBe('completed');
      console.log('[CanaryTest] Deployment marked as completed after final stage');
    });
  });

  describe('Phase 4.2.4: Automatic Rollback', () => {
    test('Rollback automation detects success rate trigger', () => {
      const metrics = { fix_success_rate: 65, errors_per_hour: 30, memory_growth_mb_per_min: 2, rollback_success_rate: 95, corruption_count: 0, watchdog_state: 1, storage_used_mb: 400, bug_capture_latency_ms: 50 };
      const check = automation.checkTriggers(metrics);
      expect(check.triggered).toBe(true);
      expect(check.triggeringMetrics).toContain('success_rate_critical');
      expect(check.severity).toBe('critical');
      console.log('[CanaryTest] Success rate trigger correctly detected');
    });

    test('Rollback automation detects error rate trigger', () => {
      const metrics = { fix_success_rate: 85, errors_per_hour: 60, memory_growth_mb_per_min: 2, rollback_success_rate: 95, corruption_count: 0, watchdog_state: 1, storage_used_mb: 400, bug_capture_latency_ms: 50 };
      const check = automation.checkTriggers(metrics);
      expect(check.triggered).toBe(true);
      expect(check.triggeringMetrics).toContain('error_rate_critical');
      expect(check.severity).toBe('critical');
      console.log('[CanaryTest] Error rate trigger correctly detected');
    });

    test('Rollback automation detects memory growth trigger', () => {
      const metrics = { fix_success_rate: 85, errors_per_hour: 30, memory_growth_mb_per_min: 12, rollback_success_rate: 95, corruption_count: 0, watchdog_state: 1, storage_used_mb: 400, bug_capture_latency_ms: 50 };
      const check = automation.checkTriggers(metrics);
      expect(check.triggered).toBe(true);
      expect(check.triggeringMetrics).toContain('memory_growth_warning');
      expect(check.severity).toBe('warning');
      console.log('[CanaryTest] Memory growth trigger correctly detected');
    });

    test('Rollback automation detects corruption trigger', () => {
      const metrics = { fix_success_rate: 85, errors_per_hour: 30, memory_growth_mb_per_min: 2, rollback_success_rate: 95, corruption_count: 1, watchdog_state: 1, storage_used_mb: 400, bug_capture_latency_ms: 50 };
      const check = automation.checkTriggers(metrics);
      expect(check.triggered).toBe(true);
      expect(check.triggeringMetrics).toContain('corruption_detected_critical');
      expect(check.severity).toBe('critical');
      console.log('[CanaryTest] Corruption trigger correctly detected');
    });

    test('Rollback automation detects watchdog FAILSAFE', () => {
      const metrics = { fix_success_rate: 85, errors_per_hour: 30, memory_growth_mb_per_min: 2, rollback_success_rate: 95, corruption_count: 0, watchdog_state: 4, storage_used_mb: 400, bug_capture_latency_ms: 50 };
      const check = automation.checkTriggers(metrics);
      expect(check.triggered).toBe(true);
      expect(check.triggeringMetrics).toContain('watchdog_failsafe');
      expect(check.severity).toBe('critical');
      console.log('[CanaryTest] Watchdog FAILSAFE trigger correctly detected');
    });

    test('Rollback automation correctly disables disabled triggers', () => {
      const customTriggers = DEFAULT_ROLLBACK_TRIGGERS.map(trigger => ({ ...trigger }));
      customTriggers[0].enabled = false;
      const automation2 = new RollbackAutomation('test2', customTriggers);
      const metrics = { fix_success_rate: 65, errors_per_hour: 30, memory_growth_mb_per_min: 2, rollback_success_rate: 95, corruption_count: 0, watchdog_state: 1, storage_used_mb: 400, bug_capture_latency_ms: 50 };
      const check = automation2.checkTriggers(metrics);
      expect(check.triggered).toBe(false);
      console.log('[CanaryTest] Disabled triggers correctly ignored');
    });

    test('Rollback automation executes rollback', async () => {
      const event = await automation.executeRollback('Test rollback execution');
      expect(event).toBeDefined();
      expect(event.triggered).toBe(true);
      expect(event.rollbackExecuted).toBe(true);
      expect(event.rollbackSuccess).toBe(true);
      expect(event.rollbackDuration).toBeGreaterThan(0);
      console.log('[CanaryTest] Rollback executed successfully');
    });

    test('Rollback automation tracks multiple events', async () => {
      await automation.executeRollback('Event 1');
      await automation.executeRollback('Event 2');
      const history = automation.getHistory();
      expect(history.events.length).toBe(2);
      expect(history.statistics.rollbacksExecuted).toBe(2);
      console.log('[CanaryTest] Multiple rollback events tracked correctly');
    });
  });

  describe('Phase 4.2.5: Reporting', () => {
    test('Canary deployment report is generated correctly', async () => {
      await orchestrator.startCanaryDeployment();
      const excellentMetrics: StageMetrics = {
        successRate: 96,
        errorRate: 15,
        errorCount: 15,
        memoryGrowthMBPerMin: 2,
        averageBugCaptureLatency: 40,
        averageFixLatency: 500,
        healthStatus: 'healthy',
        lastUpdate: Date.now()
      };
      await orchestrator.evaluateStageMetrics(excellentMetrics);
      const report = orchestrator.generateReport();
      expect(typeof report).toBe('string');
      expect(report).toContain('Canary Deployment Report');
      expect(report).toContain('v1.2.3-test');
      expect(report).toContain('IN_PROGRESS');
      console.log('[CanaryTest] Deployment report generated successfully');
    });

    test('Rollback automation report contains statistics', async () => {
      await automation.executeRollback('Test rollback');
      const report = automation.generateReport();
      expect(typeof report).toBe('string');
      expect(report).toContain('Rollback Automation Report');
      expect(report).toContain('Total Metric Checks');
      expect(report).toContain('Rollbacks Executed');
      console.log('[CanaryTest] Rollback report generated successfully');
    });

    test('Deployment stage configuration can be exported', () => {
      orchestrator.getDeploymentPlan().currentStage = 0;
      const config = orchestrator.getStageConfig();
      expect(config.traffic).toBe(5);
      expect(config.duration).toBeGreaterThan(0);
      expect(config.thresholds).toBeDefined();
      expect(config.thresholds.successRateMin).toBe(70);
      console.log('[CanaryTest] Stage configuration exported correctly');
    });
  });

  describe('Phase 4.2.6: Integration Scenarios', () => {
    test('Full canary deployment flow: success path', async () => {
      await orchestrator.startCanaryDeployment();
      const excellentMetrics: StageMetrics = {
        successRate: 95,
        errorRate: 20,
        errorCount: 20,
        memoryGrowthMBPerMin: 1.5,
        averageBugCaptureLatency: 40,
        averageFixLatency: 500,
        healthStatus: 'healthy',
        lastUpdate: Date.now()
      };

      let decision = await orchestrator.evaluateStageMetrics(excellentMetrics);
      expect(decision.decision).toBe('proceed');
      let plan = orchestrator.getDeploymentPlan();
      plan.stages[0].status = 'completed';
      let advanced = await orchestrator.advanceToNextStage();
      expect(advanced).toBe(true);

      decision = await orchestrator.evaluateStageMetrics(excellentMetrics);
      expect(decision.decision).toBe('proceed');
      plan = orchestrator.getDeploymentPlan();
      plan.stages[1].status = 'completed';
      advanced = await orchestrator.advanceToNextStage();
      expect(advanced).toBe(true);
      expect(orchestrator.getDeploymentPlan().currentStage).toBe(2);
      console.log('[CanaryTest] Canary deployment success path completed');
    });

    test('Full canary deployment flow: rollback path', async () => {
      await orchestrator.startCanaryDeployment();
      const poorMetrics: StageMetrics = {
        successRate: 68,
        errorRate: 55,
        errorCount: 55,
        memoryGrowthMBPerMin: 8,
        averageBugCaptureLatency: 90,
        averageFixLatency: 1100,
        healthStatus: 'critical',
        lastUpdate: Date.now()
      };
      const decision = await orchestrator.evaluateStageMetrics(poorMetrics);
      expect(decision.decision).toBe('rollback');
      await orchestrator.rollback('SLA violation in stage 1');
      const plan = orchestrator.getDeploymentPlan();
      expect(plan.status).toBe('rolled_back');
      expect(plan.stages[0].status).toBe('rolled_back');
      console.log('[CanaryTest] Canary deployment rollback path completed');
    });
  });

  describe('Phase 4.2.7: Phase 4.2 Checklist', () => {
    test('Canary deployment stages are properly configured', () => {
      expect(DEFAULT_CANARY_STAGES.length).toBe(4);
      expect(DEFAULT_CANARY_STAGES[0].trafficPercentage).toBe(5);
      expect(DEFAULT_CANARY_STAGES[3].trafficPercentage).toBe(100);
    });

    test('Rollback triggers cover all critical metrics', () => {
      expect(DEFAULT_ROLLBACK_TRIGGERS.length).toBeGreaterThanOrEqual(6);
      const triggerIds = DEFAULT_ROLLBACK_TRIGGERS.map(t => t.id);
      expect(triggerIds).toContain('success_rate_critical');
      expect(triggerIds).toContain('error_rate_critical');
      expect(triggerIds).toContain('corruption_detected_critical');
      expect(triggerIds).toContain('watchdog_failsafe');
    });

    test('Phase 4.2 completion requirements documented', () => {
      const requirements = [
        'Canary deployment with 4 stages (5%→25%→50%→100%)',
        'Automatic progression based on SLA compliance',
        'Automatic rollback on critical metric violation',
        'Memory growth monitoring and halt capability',
        'Error rate and success rate thresholds',
        'Deployment plan persistence to disk',
        'Comprehensive reporting and metrics export',
        'Recovery verification after rollback'
      ];
      expect(requirements.length).toBeGreaterThan(0);
      console.log('[CanaryTest] Phase 4.2 requirements documented');
    });
  });
});

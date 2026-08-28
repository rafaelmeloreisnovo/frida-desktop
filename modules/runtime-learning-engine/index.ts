import { BugEvent, BugPattern, LearningEngineConfig, FixEvent } from './types';
import { BugCaptureImpl } from './bug-capture';
import { BugStoreImpl } from './bug-store';
import { PatternDetectorImpl } from './pattern-detector';
import { AutoFixerImpl } from './auto-fixer';
import { RollbackEngineImpl } from './rollback-engine';
import { WatchdogMonitorImpl } from './watchdog-monitor';
import { TestSuiteImpl } from './test-suite';
import { CompatibilityChecker } from './compatibility-checker';
import { HealthCheckEndpoint } from './health-check-endpoint';
import { MetricsCollector } from './metrics-exporter';
import { AlertManager } from './alert-manager';
import { RuntimeSafetyMesh, RuntimeSafetySnapshot } from './runtime-safety-mesh';
import { generateEventId } from './utils';

export class RuntimeLearningEngine {
  private config: LearningEngineConfig;
  private bugCapture: BugCaptureImpl;
  private bugStore: BugStoreImpl;
  private patternDetector: PatternDetectorImpl;
  private autoFixer: AutoFixerImpl;
  private rollbackEngine: RollbackEngineImpl;
  private watchdogMonitor: WatchdogMonitorImpl;
  private testSuite: TestSuiteImpl;
  private compatibilityChecker: CompatibilityChecker;
  private healthCheckEndpoint: HealthCheckEndpoint;
  private metricsCollector: MetricsCollector;
  private alertManager: AlertManager;
  private safetyMesh: RuntimeSafetyMesh;

  private running = false;
  private recentBugs: BugEvent[] = [];
  private pendingRollbacks: Map<string, FixEvent> = new Map();
  private patternsDetectedTotal = 0;
  private fixesAppliedTotal = 0;
  private rollbacksTriggeredTotal = 0;
  private rollbackFailuresTotal = 0;

  constructor(config?: Partial<LearningEngineConfig>) {
    this.config = {
      storage_path: '/data/local/tmp/frida-learning',
      bug_capacity: 512,
      confidence_threshold: 0.75,
      min_occurrences_before_fix: 3,
      heartbeat_interval_ms: 1000,
      epoch_timeout_ms: 5000,
      journal_size: 4096,
      max_rollback_attempts: 3,
      ...config
    };

    this.bugCapture = new BugCaptureImpl();
    this.bugStore = new BugStoreImpl(this.config.storage_path, this.config.bug_capacity);
    this.patternDetector = new PatternDetectorImpl({
      confidence_threshold: this.config.confidence_threshold,
      min_occurrences: this.config.min_occurrences_before_fix
    });
    this.autoFixer = new AutoFixerImpl();
    this.rollbackEngine = new RollbackEngineImpl(
      this.config.storage_path,
      this.config.journal_size,
      this.config.max_rollback_attempts
    );
    this.watchdogMonitor = new WatchdogMonitorImpl(
      this.config.storage_path,
      this.config.heartbeat_interval_ms,
      this.config.epoch_timeout_ms
    );
    this.testSuite = new TestSuiteImpl();
    this.compatibilityChecker = new CompatibilityChecker(this.config.storage_path);
    this.healthCheckEndpoint = new HealthCheckEndpoint(this, this.config.storage_path);
    this.metricsCollector = new MetricsCollector(this.config.storage_path);
    this.alertManager = new AlertManager(this.config.storage_path);
    this.safetyMesh = new RuntimeSafetyMesh(this.config.storage_path);

    this.setupWatchdogCallback();
  }

  async start(): Promise<void> {
    if (this.running) {
      console.warn('[RuntimeLearningEngine] Engine already running');
      return;
    }

    console.log('[RuntimeLearningEngine] Starting engine...');

    try {
      console.log('[RuntimeLearningEngine] Running compatibility checks...');
      await this.compatibilityChecker.checkCompatibility();

      if (!this.compatibilityChecker.canProceedWithDeployment()) {
        console.error('[RuntimeLearningEngine] INCOMPATIBLE ENVIRONMENT - Cannot proceed with deployment');
        console.error('[RuntimeLearningEngine] See compatibility-report.json for details');
        this.running = false;
        return;
      }

      console.log('[RuntimeLearningEngine] Compatibility check passed - proceeding with startup');

      this.bugCapture.setBugCapturedCallback(async (event: BugEvent) => {
        await this.captureBug(event);
      });

      await this.alertManager.loadAlerts();

      // Set running before hooks are installed so events emitted during hook
      // activation cannot be silently dropped. Any startup failure resets it.
      this.running = true;
      await this.bugCapture.startCapture();
      await this.watchdogMonitor.startWatchdog();
      await this.loadHistoryAndDetectPatterns();
      await this.refreshObservability();

      console.log('[RuntimeLearningEngine] Engine started successfully');
    } catch (e) {
      console.error('[RuntimeLearningEngine] Failed to start engine:', e);
      this.running = false;
    }
  }

  async stop(): Promise<void> {
    if (!this.running) return;

    console.log('[RuntimeLearningEngine] Stopping engine...');

    try {
      await this.bugCapture.stopCapture();
      await this.watchdogMonitor.stopWatchdog();
      await this.metricsCollector.exportMetrics('json');
      await this.alertManager.saveAlerts();

      this.running = false;
      console.log('[RuntimeLearningEngine] Engine stopped');
    } catch (e) {
      console.error('[RuntimeLearningEngine] Error stopping engine:', e);
    }
  }

  async captureBug(event: Partial<BugEvent>): Promise<void> {
    if (!this.running) {
      console.warn('[RuntimeLearningEngine] Engine not running, skipping bug capture');
      return;
    }

    const captureStartedAt = Date.now();
    const bugEvent: BugEvent = {
      id: generateEventId(),
      timestamp: Date.now(),
      bug_type: event.bug_type || 'crash',
      class: event.class || 'unknown',
      method: event.method || 'unknown',
      exception_type: event.exception_type,
      stack_hash: event.stack_hash || '',
      severity: event.severity || 'medium',
      status: 'new',
      thread_id: event.thread_id,
      process_id: event.process_id
    };

    console.log(`[RuntimeLearningEngine] Capturing bug: ${bugEvent.bug_type}`);

    try {
      await this.bugStore.appendEvent(bugEvent);
      this.recentBugs.push(bugEvent);

      if (this.recentBugs.length > 10) {
        this.recentBugs.shift();
      }

      const captureLatency = Date.now() - captureStartedAt;
      this.metricsCollector.recordBugCapture(captureLatency);
      this.healthCheckEndpoint.recordLatency('bug_capture', captureLatency);
      this.healthCheckEndpoint.recordEvent('bug_capture');

      await this.processBugEvent(bugEvent);
      await this.refreshObservability();
    } catch (e) {
      console.error('[RuntimeLearningEngine] Failed to capture bug:', e);
      await this.refreshObservability();
    }
  }

  private async processBugEvent(event: BugEvent): Promise<void> {
    const patternStartedAt = Date.now();
    const patterns = await this.patternDetector.detectPatterns(this.recentBugs);
    const patternLatency = Date.now() - patternStartedAt;

    this.patternsDetectedTotal += patterns.length;
    const confidence = patterns.length > 0 ? Math.max(...patterns.map(pattern => pattern.confidence)) : 0;
    this.metricsCollector.recordPatternDetection(patternLatency, confidence);
    this.healthCheckEndpoint.recordLatency('pattern_detection', patternLatency);
    if (patterns.length > 0) {
      this.healthCheckEndpoint.recordEvent('pattern_detection');
    }

    for (const pattern of patterns) {
      const shouldFix = await this.patternDetector.shouldApplyFix(pattern);
      if (!shouldFix) continue;

      const safety = this.getSafetySnapshot();
      const mutationBlocked =
        safety.memory.features_disabled.includes('fix_application') ||
        safety.disk.evidence === 'FAILED' ||
        safety.corruption.evidence === 'FAILED';

      if (mutationBlocked) {
        console.error(
          `[RuntimeLearningEngine] Mutation gate blocked fix ${pattern.pattern_id}: ` +
          `memory=${safety.memory.pressure_level}, disk=${safety.disk.evidence}, corruption=${safety.corruption.evidence}`
        );
        this.watchdogMonitor.setState('FAILSAFE');
        continue;
      }

      await this.applyFixWithRollback(pattern);
    }
  }

  private async applyFixWithRollback(pattern: BugPattern): Promise<void> {
    console.log(`[RuntimeLearningEngine] Attempting fix for pattern: ${pattern.pattern_id}`);
    const fixStartedAt = Date.now();

    try {
      this.watchdogMonitor.setState('OBSERVE');

      const fixEvent = await this.autoFixer.applyFix(pattern);
      const fixLatency = Date.now() - fixStartedAt;

      if (fixEvent.status === 'failed') {
        this.metricsCollector.recordFixApplication(false, fixLatency);
        this.healthCheckEndpoint.recordLatency('fix_application', fixLatency);
        this.healthCheckEndpoint.recordFailure('fix_application');
        this.watchdogMonitor.setState('FAILSAFE');
        return;
      }

      const testResults = await this.testSuite.runAfterFix(fixEvent);
      fixEvent.test_results = testResults;
      const allTestsPassed = testResults.every(result => result.state === 'PASS' || result.state === 'SKIPPED');

      this.healthCheckEndpoint.recordLatency('fix_application', fixLatency);

      if (!allTestsPassed) {
        console.warn(`[RuntimeLearningEngine] Tests failed after ${fixEvent.fix_id}; executing rollback now`);
        fixEvent.rollback_reason = 'post_fix_test_failure';
        this.metricsCollector.recordFixApplication(false, fixLatency);
        this.healthCheckEndpoint.recordFailure('fix_application');

        const rollbackVerified = await this.executeRollback(fixEvent);
        if (!rollbackVerified) {
          this.pendingRollbacks.set(fixEvent.fix_id, fixEvent);
          this.watchdogMonitor.setState('FAILSAFE');
          this.watchdogMonitor.incrementTrapCount();
        }
      } else {
        console.log(`[RuntimeLearningEngine] Fix ${fixEvent.fix_id} passed post-fix tests`);
        this.fixesAppliedTotal++;
        fixEvent.status = 'applied';
        this.metricsCollector.recordFixApplication(true, fixLatency);
        this.healthCheckEndpoint.recordSuccess('fix_application');
        this.watchdogMonitor.setState('STABLE');
      }
    } catch (e) {
      console.error('[RuntimeLearningEngine] Error during fix application:', e);
      this.watchdogMonitor.setState('FAILSAFE');
      this.watchdogMonitor.incrementTrapCount();
    } finally {
      await this.refreshObservability();
    }
  }

  private async executeRollback(fixEvent: FixEvent): Promise<boolean> {
    const rollbackStartedAt = Date.now();
    this.rollbacksTriggeredTotal++;

    let verified = false;

    if (this.autoFixer.canRollbackFix(fixEvent.fix_id)) {
      verified = await this.autoFixer.rollbackFix(fixEvent.fix_id);
    }

    if (!verified) {
      const matchingJournals = this.rollbackEngine
        .getAllJournals()
        .filter(journal => journal.fix_id === fixEvent.fix_id);

      for (const journal of matchingJournals) {
        if (await this.rollbackEngine.rollback(journal)) {
          verified = true;
          break;
        }
      }
    }

    const rollbackLatency = Date.now() - rollbackStartedAt;
    this.metricsCollector.recordRollback(verified, rollbackLatency);
    this.healthCheckEndpoint.recordLatency('rollback', rollbackLatency);
    this.healthCheckEndpoint.recordEvent('rollback');

    fixEvent.rollback_verified = verified;

    if (verified) {
      fixEvent.status = 'rolled_back';
      this.pendingRollbacks.delete(fixEvent.fix_id);
      this.watchdogMonitor.setState('STABLE');
      console.log(`[RuntimeLearningEngine] Rollback verified for ${fixEvent.fix_id}`);
      return true;
    }

    this.rollbackFailuresTotal++;
    console.error(
      `[RuntimeLearningEngine] Rollback for ${fixEvent.fix_id} is not verified; remaining in FAILSAFE/TOKEN_VAZIO`
    );
    return false;
  }

  private async loadHistoryAndDetectPatterns(): Promise<void> {
    try {
      const store = await this.bugStore.loadHistory();

      console.log(
        `[RuntimeLearningEngine] Loaded history: ` +
        `${store.events.length} events, ` +
        `${store.patterns.length} patterns`
      );

      if (store.events.length > 0) {
        this.recentBugs = store.events.slice(-10);

        const patterns = await this.patternDetector.detectPatterns(store.events);
        this.patternsDetectedTotal += patterns.length;

        for (const pattern of patterns) {
          const updated = await this.patternDetector.updateConfidence(pattern);
          console.log(
            `[RuntimeLearningEngine] Pattern ${pattern.pattern_id}: ` +
            `confidence=${updated.toFixed(2)}, occurrences=${pattern.occurrences}`
          );
        }
      }
    } catch (e) {
      console.error('[RuntimeLearningEngine] Failed to load history:', e);
    }
  }

  private setupWatchdogCallback(): void {
    this.watchdogMonitor.setRollbackCallback(async () => {
      console.log('[RuntimeLearningEngine] Watchdog requested rollback of pending fixes');

      const pending = Array.from(this.pendingRollbacks.values());
      for (const fixEvent of pending) {
        try {
          this.watchdogMonitor.setState('FAILSAFE');
          const verified = await this.executeRollback(fixEvent);
          if (!verified) {
            console.error(`[RuntimeLearningEngine] Watchdog rollback still unverified for ${fixEvent.fix_id}`);
          }
        } catch (e) {
          console.error(`[RuntimeLearningEngine] Watchdog rollback failed for ${fixEvent.fix_id}:`, e);
          this.watchdogMonitor.setState('FAILSAFE');
        }
      }

      await this.refreshObservability();
    });
  }

  private async refreshObservability(): Promise<void> {
    try {
      const watchdogStats = this.watchdogMonitor.getStats();
      const safety = this.safetyMesh.snapshot(this.running, watchdogStats.current_state);
      const health = await this.healthCheckEndpoint.getHealthStatus();
      const metricsSnapshot = await this.healthCheckEndpoint.getMetricsSnapshot();

      this.metricsCollector.recordSystemMetrics(
        health.memory_usage_mb,
        health.storage_used_mb,
        watchdogStats.current_state
      );
      await this.metricsCollector.exportMetrics('json');

      const rollbackAttempts = this.rollbacksTriggeredTotal;
      const rollbackSuccessRate =
        rollbackAttempts === 0
          ? 100
          : ((rollbackAttempts - this.rollbackFailuresTotal) / rollbackAttempts) * 100;

      const normalizedMetrics: Record<string, any> = {
        bug_capture_latency_ms: metricsSnapshot.avg_latencies.bug_capture_ms,
        pattern_detection_latency_ms: metricsSnapshot.avg_latencies.pattern_detection_ms,
        fix_application_latency_ms: metricsSnapshot.avg_latencies.fix_application_ms,
        fix_success_rate: metricsSnapshot.fix_success_rate,
        memory_usage_mb: health.memory_usage_mb,
        storage_usage_mb: health.storage_used_mb,
        watchdog_state: watchdogStats.current_state,
        errors_last_hour: health.errors_last_hour,
        rollback_success_rate: rollbackSuccessRate
      };

      const managerAlerts = this.alertManager.evaluateRules(normalizedMetrics);
      if (managerAlerts.length > 0) {
        await this.alertManager.saveAlerts();
      }

      const watchdogNumeric: Record<string, number> = {
        STABLE: 1,
        OBSERVE: 2,
        DUMP: 3,
        FAILSAFE: 4
      };

      this.safetyMesh.evaluateOperationalMetrics({
        frida_bug_capture_latency_ms: metricsSnapshot.avg_latencies.bug_capture_ms,
        frida_pattern_detection_latency_ms: metricsSnapshot.avg_latencies.pattern_detection_ms,
        frida_fix_application_latency_ms: metricsSnapshot.avg_latencies.fix_application_ms,
        frida_success_rate: metricsSnapshot.fix_success_rate,
        frida_memory_usage_mb: health.memory_usage_mb,
        frida_disk_free_mb: safety.disk.free_mb,
        frida_watchdog_state: watchdogNumeric[watchdogStats.current_state],
        frida_sla_total_violations: health.sla_violations.critical + health.sla_violations.warnings
      });
    } catch (e) {
      console.error('[RuntimeLearningEngine] Observability refresh failed:', e);
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  getStats() {
    const watchdogStats = this.watchdogMonitor.getStats();
    return {
      running: this.running,
      recentBugsCount: this.recentBugs.length,
      pendingRollbacks: this.pendingRollbacks.size,
      patternsCount: this.patternsDetectedTotal,
      fixesApplied: this.fixesAppliedTotal,
      rollbacksTriggered: this.rollbacksTriggeredTotal,
      rollbackFailures: this.rollbackFailuresTotal,
      lastHeartbeat: watchdogStats.last_heartbeat_time,
      watchdogState: watchdogStats.current_state,
      watchdogStats
    };
  }

  getSafetySnapshot(): RuntimeSafetySnapshot {
    const watchdogState = this.watchdogMonitor.getStats().current_state;
    return this.safetyMesh.snapshot(this.running, watchdogState);
  }

  async shutdown(): Promise<void> {
    await this.stop();
    console.log('[RuntimeLearningEngine] Engine shutdown complete');
  }

  getHealthCheckEndpoint(): HealthCheckEndpoint {
    return this.healthCheckEndpoint;
  }

  getMetricsCollector(): MetricsCollector {
    return this.metricsCollector;
  }

  getAlertManager(): AlertManager {
    return this.alertManager;
  }

  getRuntimeSafetyMesh(): RuntimeSafetyMesh {
    return this.safetyMesh;
  }
}

let engine: RuntimeLearningEngine | null = null;

export async function initializeEngine(config?: Partial<LearningEngineConfig>): Promise<RuntimeLearningEngine> {
  if (engine) {
    console.warn('[RuntimeLearningEngine] Engine already initialized');
    return engine;
  }

  engine = new RuntimeLearningEngine(config);
  await engine.start();

  return engine;
}

export function getEngine(): RuntimeLearningEngine | null {
  return engine;
}

export async function shutdownEngine(): Promise<void> {
  if (engine) {
    await engine.shutdown();
    engine = null;
  }
}

export { RuntimeSafetyMesh } from './runtime-safety-mesh';
export { AlertRulesEngine } from './alert-rules-3-2';

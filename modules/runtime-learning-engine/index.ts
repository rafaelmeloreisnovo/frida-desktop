import { BugEvent, BugPattern, LearningEngineConfig, WatchdogState, FixEvent } from './types';
import { BugCaptureImpl } from './bug-capture';
import { BugStoreImpl } from './bug-store';
import { PatternDetectorImpl } from './pattern-detector';
import { AutoFixerImpl } from './auto-fixer';
import { RollbackEngineImpl } from './rollback-engine';
import { WatchdogMonitorImpl } from './watchdog-monitor';
import { TestSuiteImpl } from './test-suite';
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

  private running = false;
  private recentBugs: BugEvent[] = [];
  private pendingRollbacks: Map<string, FixEvent> = new Map();

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
    this.bugStore = new BugStoreImpl();
    this.patternDetector = new PatternDetectorImpl({
      confidence_threshold: this.config.confidence_threshold,
      min_occurrences: this.config.min_occurrences_before_fix
    });
    this.autoFixer = new AutoFixerImpl();
    this.rollbackEngine = new RollbackEngineImpl();
    this.watchdogMonitor = new WatchdogMonitorImpl();
    this.testSuite = new TestSuiteImpl();

    this.setupWatchdogCallback();
  }

  async start(): Promise<void> {
    if (this.running) {
      console.warn('[RuntimeLearningEngine] Engine already running');
      return;
    }

    console.log('[RuntimeLearningEngine] Starting engine...');

    try {
      (this.bugCapture as any).setBugCapturedCallback(async (event: BugEvent) => {
        await this.captureBug(event);
      });

      await this.bugCapture.startCapture();
      await this.watchdogMonitor.startWatchdog();

      await this.loadHistoryAndDetectPatterns();

      this.running = true;
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

      await this.processBugEvent(bugEvent);
    } catch (e) {
      console.error('[RuntimeLearningEngine] Failed to capture bug:', e);
    }
  }

  private async processBugEvent(event: BugEvent): Promise<void> {
    const patterns = await this.patternDetector.detectPatterns(this.recentBugs);

    for (const pattern of patterns) {
      const shouldFix = await this.patternDetector.shouldApplyFix(pattern);

      if (shouldFix) {
        await this.applyFixWithRollback(pattern);
      }
    }
  }

  private async applyFixWithRollback(pattern: BugPattern): Promise<void> {
    const fixId = `fix_${Date.now()}`;

    console.log(`[RuntimeLearningEngine] Attempting fix for pattern: ${pattern.pattern_id}`);

    try {
      this.watchdogMonitor.setState('OBSERVE');

      const fixEvent = await this.autoFixer.applyFix(pattern);

      const testResults = await this.testSuite.runAfterFix(fixEvent);
      const allTestsPassed = testResults.every(r => r.state === 'PASS' || r.state === 'SKIPPED');

      if (!allTestsPassed) {
        console.warn('[RuntimeLearningEngine] Tests failed after fix, triggering rollback');

        this.watchdogMonitor.setState('FAILSAFE');
        this.watchdogMonitor.incrementTrapCount();

        this.pendingRollbacks.set(fixId, fixEvent);

        console.log('[RuntimeLearningEngine] Rollback triggered due to test failure');
      } else {
        console.log('[RuntimeLearningEngine] Fix applied successfully, all tests passed');

        this.watchdogMonitor.setState('STABLE');

        fixEvent.status = 'applied';
      }
    } catch (e) {
      console.error('[RuntimeLearningEngine] Error during fix application:', e);

      this.watchdogMonitor.setState('FAILSAFE');
      this.watchdogMonitor.incrementTrapCount();
    }
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
      console.log('[RuntimeLearningEngine] Watchdog triggered rollback!');

      for (const [fixId, fixEvent] of this.pendingRollbacks) {
        try {
          console.log(`[RuntimeLearningEngine] Rolling back fix ${fixId}`);

          this.watchdogMonitor.setState('FAILSAFE');

          const journals = this.rollbackEngine.getAllJournals();
          for (const journal of journals) {
            if (journal.fix_id === fixId) {
              const rollbackSuccess = await this.rollbackEngine.rollback(journal);
              if (!rollbackSuccess) {
                console.error(
                  `[RuntimeLearningEngine] Rollback verification failed for ${fixId}. ` +
                  'Staying in FAILSAFE mode.'
                );
              } else {
                console.log(`[RuntimeLearningEngine] Rollback verified for ${fixId}`);
              }
            }
          }

          console.log(`[RuntimeLearningEngine] Rollback for ${fixId} completed`);

          this.pendingRollbacks.delete(fixId);
        } catch (e) {
          console.error(`[RuntimeLearningEngine] Rollback failed for ${fixId}:`, e);
          this.watchdogMonitor.setState('FAILSAFE');
        }
      }
    });
  }

  isRunning(): boolean {
    return this.running;
  }

  getStats() {
    return {
      running: this.running,
      recentBugsCount: this.recentBugs.length,
      pendingRollbacks: this.pendingRollbacks.size,
      watchdogStats: (this.watchdogMonitor as any).getStats?.() || {}
    };
  }

  async shutdown(): Promise<void> {
    await this.stop();
    console.log('[RuntimeLearningEngine] Engine shutdown complete');
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

console.log('[RuntimeLearningEngine] Module loaded, ready for initialization');

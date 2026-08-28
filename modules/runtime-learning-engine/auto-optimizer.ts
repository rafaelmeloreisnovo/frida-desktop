import * as fs from 'fs';
import * as path from 'path';
import { FeedbackCollector } from './feedback-collector';

export interface OptimizationConfig {
  confidence_threshold: number;
  min_occurrences_before_fix: number;
  preferred_strategy: 'try_catch_with_fallback' | 'monkey_patch_from_journal' | 'component_restart';
}

export interface OptimizationLog {
  timestamp: number;
  type: 'threshold_adjustment' | 'min_occurrences_adjustment' | 'strategy_change';
  previous_value: number | string;
  new_value: number | string;
  reason: string;
  metrics: Record<string, any>;
}

export class AutoOptimizer {
  private storagePath: string;
  private logPath: string;
  private feedbackCollector: FeedbackCollector;
  private config: OptimizationConfig;
  private optimizationLog: OptimizationLog[] = [];

  constructor(
    storagePath: string = '/data/local/tmp/frida-learning',
    initialConfig: OptimizationConfig = {
      confidence_threshold: 0.75,
      min_occurrences_before_fix: 3,
      preferred_strategy: 'monkey_patch_from_journal'
    }
  ) {
    this.storagePath = storagePath;
    this.logPath = path.join(storagePath, 'optimization-log.json');
    this.config = initialConfig;
    this.feedbackCollector = new FeedbackCollector(storagePath);
    this.ensureDirectory();
    this.loadOptimizationLog();
  }

  private ensureDirectory(): void {
    if (!fs.existsSync(this.storagePath)) {
      fs.mkdirSync(this.storagePath, { recursive: true });
    }
  }

  private loadOptimizationLog(): void {
    try {
      if (fs.existsSync(this.logPath)) {
        const data = fs.readFileSync(this.logPath, 'utf-8');
        this.optimizationLog = JSON.parse(data);
      }
    } catch (e) {
      console.warn('[AutoOptimizer] Failed to load optimization log:', e);
    }
  }

  private saveOptimizationLog(): void {
    try {
      fs.writeFileSync(this.logPath, JSON.stringify(this.optimizationLog, null, 2), 'utf-8');
    } catch (e) {
      console.error('[AutoOptimizer] Failed to save optimization log:', e);
    }
  }

  async evaluateAndOptimize(): Promise<OptimizationConfig> {
    const metrics = this.feedbackCollector.getEngineMetrics();
    const summary = this.feedbackCollector.getSummary();

    console.log('[AutoOptimizer] Evaluating metrics for optimization...');

    if (summary.success_rate < 70) {
      console.log('[AutoOptimizer] Low success rate detected, reducing confidence threshold');
      await this.adjustConfidenceThreshold(-0.05);
    } else if (summary.success_rate > 90) {
      console.log('[AutoOptimizer] High success rate, increasing confidence threshold');
      await this.adjustConfidenceThreshold(0.05);
    }

    if (summary.success_rate < 60 && this.config.min_occurrences_before_fix > 1) {
      console.log('[AutoOptimizer] Reducing min_occurrences to catch issues faster');
      await this.adjustMinOccurrences(-1);
    } else if (summary.success_rate > 95 && this.config.min_occurrences_before_fix < 2) {
      console.log('[AutoOptimizer] Increasing min_occurrences for more confident patterns');
      await this.adjustMinOccurrences(1);
    }

    const successful = this.feedbackCollector.getHighestSuccessPatterns(5);
    if (successful.length > 0) {
      await this.optimizeStrategyForPatterns(successful);
    }

    if (summary.rollback_rate > 30) {
      console.warn('[AutoOptimizer] High rollback rate detected, reducing confidence threshold');
      await this.adjustConfidenceThreshold(-0.1);
    }

    return { ...this.config };
  }

  private async adjustConfidenceThreshold(delta: number): Promise<void> {
    const oldThreshold = this.config.confidence_threshold;
    const newThreshold = Math.max(0.1, Math.min(0.99, oldThreshold + delta));

    if (newThreshold !== oldThreshold) {
      this.config.confidence_threshold = newThreshold;

      const log: OptimizationLog = {
        timestamp: Date.now(),
        type: 'threshold_adjustment',
        previous_value: oldThreshold,
        new_value: newThreshold,
        reason: delta > 0 ? 'Success rate high' : 'Success rate low',
        metrics: this.feedbackCollector.getEngineMetrics()
      };

      this.optimizationLog.push(log);
      this.saveOptimizationLog();

      console.log(
        `[AutoOptimizer] Confidence threshold: ${oldThreshold.toFixed(2)} → ${newThreshold.toFixed(2)}`
      );
    }
  }

  private async adjustMinOccurrences(delta: number): Promise<void> {
    const oldMin = this.config.min_occurrences_before_fix;
    const newMin = Math.max(1, oldMin + delta);

    if (newMin !== oldMin) {
      this.config.min_occurrences_before_fix = newMin;

      const log: OptimizationLog = {
        timestamp: Date.now(),
        type: 'min_occurrences_adjustment',
        previous_value: oldMin,
        new_value: newMin,
        reason: delta > 0 ? 'High confidence' : 'Need faster detection',
        metrics: this.feedbackCollector.getEngineMetrics()
      };

      this.optimizationLog.push(log);
      this.saveOptimizationLog();

      console.log(
        `[AutoOptimizer] Min occurrences before fix: ${oldMin} → ${newMin}`
      );
    }
  }

  private async optimizeStrategyForPatterns(patterns: any[]): Promise<void> {
    for (const pattern of patterns) {
      const fixes = this.feedbackCollector.getFixesForPattern(pattern.pattern_id);
      if (fixes.length === 0) continue;

      const byCatchCount = fixes.filter(f => f.fix_id.includes('try_catch')).length;
      const monkeyPatchCount = fixes.filter(f => f.fix_id.includes('monkey_patch')).length;
      const restartCount = fixes.filter(f => f.fix_id.includes('restart')).length;

      const mostSuccessful = [
        { strategy: 'try_catch_with_fallback', count: byCatchCount },
        { strategy: 'monkey_patch_from_journal', count: monkeyPatchCount },
        { strategy: 'component_restart', count: restartCount }
      ]
        .filter(s => s.count > 0)
        .sort((a, b) => b.count - a.count)[0];

      if (mostSuccessful && mostSuccessful.strategy !== this.config.preferred_strategy) {
        console.log(
          `[AutoOptimizer] Pattern ${pattern.pattern_id}: ${mostSuccessful.strategy} is most successful`
        );
      }
    }
  }

  getConfig(): OptimizationConfig {
    return { ...this.config };
  }

  getOptimizationHistory(limit: number = 50): OptimizationLog[] {
    return this.optimizationLog.slice(-limit);
  }

  getOptimizationStats(): {
    total_optimizations: number;
    threshold_adjustments: number;
    min_occurrences_adjustments: number;
    strategy_changes: number;
    last_optimization: number;
  } {
    return {
      total_optimizations: this.optimizationLog.length,
      threshold_adjustments: this.optimizationLog.filter(l => l.type === 'threshold_adjustment').length,
      min_occurrences_adjustments: this.optimizationLog.filter(l => l.type === 'min_occurrences_adjustment').length,
      strategy_changes: this.optimizationLog.filter(l => l.type === 'strategy_change').length,
      last_optimization: this.optimizationLog.length > 0 ? this.optimizationLog[this.optimizationLog.length - 1].timestamp : 0
    };
  }

  async schedulePeriodicOptimization(intervalMs: number = 300000): Promise<() => void> {
    let running = true;

    const optimize = async () => {
      if (!running) return;

      try {
        await this.evaluateAndOptimize();
      } catch (e) {
        console.error('[AutoOptimizer] Periodic optimization error:', e);
      }

      if (running) {
        setTimeout(optimize, intervalMs);
      }
    };

    optimize();

    return () => {
      running = false;
    };
  }
}

export function createAutoOptimizer(storagePath?: string, config?: OptimizationConfig): AutoOptimizer {
  return new AutoOptimizer(storagePath, config);
}

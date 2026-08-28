import * as fs from 'fs';
import * as path from 'path';

export interface FixMetrics {
  pattern_id: string;
  fix_id: string;
  applied_at: number;
  success: boolean;
  test_passed: boolean;
  rolled_back: boolean;
  duration_ms: number;
  performance_impact: number;
  regression_detected: boolean;
  error?: string;
}

export interface PatternMetrics {
  pattern_id: string;
  occurrences: number;
  fixes_attempted: number;
  fixes_succeeded: number;
  success_rate: number;
  average_fix_time: number;
  last_seen: number;
}

export interface EngineMetrics {
  timestamp: number;
  total_bugs_captured: number;
  total_patterns_detected: number;
  total_fixes_applied: number;
  total_rollbacks: number;
  overall_success_rate: number;
  average_fix_latency: number;
  memory_usage_mb: number;
  regression_rate: number;
}

export class FeedbackCollector {
  private storagePath: string;
  private metricsPath: string;
  private fixMetrics: FixMetrics[] = [];
  private patternMetrics: Map<string, PatternMetrics> = new Map();

  constructor(storagePath: string = '/data/local/tmp/frida-learning') {
    this.storagePath = storagePath;
    this.metricsPath = path.join(storagePath, 'metrics.json');
    this.ensureDirectory();
    this.loadMetrics();
  }

  private ensureDirectory(): void {
    if (!fs.existsSync(this.storagePath)) {
      fs.mkdirSync(this.storagePath, { recursive: true });
    }
  }

  private loadMetrics(): void {
    try {
      if (fs.existsSync(this.metricsPath)) {
        const data = fs.readFileSync(this.metricsPath, 'utf-8');
        const parsed = JSON.parse(data);
        this.fixMetrics = parsed.fixes || [];

        for (const pattern of parsed.patterns || []) {
          this.patternMetrics.set(pattern.pattern_id, pattern);
        }
      }
    } catch (e) {
      console.warn('[FeedbackCollector] Failed to load metrics, starting fresh:', e);
    }
  }

  private saveMetrics(): void {
    try {
      const data = {
        timestamp: Date.now(),
        fixes: this.fixMetrics,
        patterns: Array.from(this.patternMetrics.values())
      };
      fs.writeFileSync(this.metricsPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
      console.error('[FeedbackCollector] Failed to save metrics:', e);
    }
  }

  recordFixAttempt(
    patternId: string,
    fixId: string,
    success: boolean,
    testPassed: boolean,
    rolledBack: boolean,
    duration: number,
    performanceImpact: number = 0,
    regressionDetected: boolean = false,
    error?: string
  ): void {
    const metric: FixMetrics = {
      pattern_id: patternId,
      fix_id: fixId,
      applied_at: Date.now(),
      success,
      test_passed: testPassed,
      rolled_back: rolledBack,
      duration_ms: duration,
      performance_impact: performanceImpact,
      regression_detected: regressionDetected,
      error
    };

    this.fixMetrics.push(metric);

    const patternMetric = this.patternMetrics.get(patternId) || {
      pattern_id: patternId,
      occurrences: 0,
      fixes_attempted: 0,
      fixes_succeeded: 0,
      success_rate: 0,
      average_fix_time: 0,
      last_seen: Date.now()
    };

    patternMetric.fixes_attempted++;
    if (success && testPassed) {
      patternMetric.fixes_succeeded++;
    }
    patternMetric.success_rate =
      patternMetric.fixes_attempted > 0
        ? (patternMetric.fixes_succeeded / patternMetric.fixes_attempted) * 100
        : 0;
    patternMetric.average_fix_time =
      (patternMetric.average_fix_time + duration) / 2;
    patternMetric.last_seen = Date.now();

    this.patternMetrics.set(patternId, patternMetric);
    this.saveMetrics();

    console.log(
      `[FeedbackCollector] Recorded fix attempt for pattern ${patternId}: ` +
      `${success ? 'SUCCESS' : 'FAILED'} (${duration}ms)`
    );
  }

  getPatternMetrics(patternId: string): PatternMetrics | undefined {
    return this.patternMetrics.get(patternId);
  }

  getFixesForPattern(patternId: string): FixMetrics[] {
    return this.fixMetrics.filter(m => m.pattern_id === patternId);
  }

  getEngineMetrics(): EngineMetrics {
    const successfulFixes = this.fixMetrics.filter(m => m.success && m.test_passed).length;
    const rolledBack = this.fixMetrics.filter(m => m.rolled_back).length;
    const regressions = this.fixMetrics.filter(m => m.regression_detected).length;

    const avgLatency = this.fixMetrics.length > 0
      ? this.fixMetrics.reduce((sum, m) => sum + m.duration_ms, 0) / this.fixMetrics.length
      : 0;

    return {
      timestamp: Date.now(),
      total_bugs_captured: 0,
      total_patterns_detected: this.patternMetrics.size,
      total_fixes_applied: this.fixMetrics.length,
      total_rollbacks: rolledBack,
      overall_success_rate:
        this.fixMetrics.length > 0
          ? (successfulFixes / this.fixMetrics.length) * 100
          : 0,
      average_fix_latency: avgLatency,
      memory_usage_mb: 0,
      regression_rate:
        this.fixMetrics.length > 0
          ? (regressions / this.fixMetrics.length) * 100
          : 0
    };
  }

  getHighestSuccessPatterns(limit: number = 10): PatternMetrics[] {
    return Array.from(this.patternMetrics.values())
      .sort((a, b) => b.success_rate - a.success_rate)
      .slice(0, limit);
  }

  getLowestSuccessPatterns(limit: number = 10): PatternMetrics[] {
    return Array.from(this.patternMetrics.values())
      .sort((a, b) => a.success_rate - b.success_rate)
      .slice(0, limit);
  }

  getMostRecentRegressions(limit: number = 10): FixMetrics[] {
    return this.fixMetrics
      .filter(m => m.regression_detected)
      .sort((a, b) => b.applied_at - a.applied_at)
      .slice(0, limit);
  }

  calculateSuccessRateForPattern(patternId: string): number {
    const metrics = this.getFixesForPattern(patternId);
    if (metrics.length === 0) return 0;

    const successful = metrics.filter(m => m.success && m.test_passed).length;
    return (successful / metrics.length) * 100;
  }

  calculateAverageFixTimeForPattern(patternId: string): number {
    const metrics = this.getFixesForPattern(patternId);
    if (metrics.length === 0) return 0;

    return metrics.reduce((sum, m) => sum + m.duration_ms, 0) / metrics.length;
  }

  identifyProblematicPatterns(): string[] {
    const problematic: string[] = [];

    for (const [patternId, metrics] of this.patternMetrics) {
      if (metrics.success_rate < 50 && metrics.fixes_attempted >= 3) {
        problematic.push(patternId);
      }
    }

    return problematic;
  }

  identifySuccessfulPatterns(): string[] {
    const successful: string[] = [];

    for (const [patternId, metrics] of this.patternMetrics) {
      if (metrics.success_rate > 90 && metrics.fixes_attempted >= 3) {
        successful.push(patternId);
      }
    }

    return successful;
  }

  getRecentPerformanceImpact(minutes: number = 60): number {
    const cutoff = Date.now() - minutes * 60 * 1000;
    const recent = this.fixMetrics.filter(m => m.applied_at > cutoff);

    if (recent.length === 0) return 0;

    return recent.reduce((sum, m) => sum + m.performance_impact, 0) / recent.length;
  }

  getSummary(): {
    total_fixes: number;
    success_rate: number;
    rollback_rate: number;
    regression_rate: number;
    patterns_tracked: number;
    average_fix_time: number;
  } {
    const successful = this.fixMetrics.filter(m => m.success && m.test_passed).length;
    const rolledBack = this.fixMetrics.filter(m => m.rolled_back).length;
    const regressions = this.fixMetrics.filter(m => m.regression_detected).length;
    const avgTime =
      this.fixMetrics.length > 0
        ? this.fixMetrics.reduce((sum, m) => sum + m.duration_ms, 0) / this.fixMetrics.length
        : 0;

    return {
      total_fixes: this.fixMetrics.length,
      success_rate:
        this.fixMetrics.length > 0 ? (successful / this.fixMetrics.length) * 100 : 0,
      rollback_rate:
        this.fixMetrics.length > 0 ? (rolledBack / this.fixMetrics.length) * 100 : 0,
      regression_rate:
        this.fixMetrics.length > 0 ? (regressions / this.fixMetrics.length) * 100 : 0,
      patterns_tracked: this.patternMetrics.size,
      average_fix_time: avgTime
    };
  }
}

export function createFeedbackCollector(storagePath?: string): FeedbackCollector {
  return new FeedbackCollector(storagePath);
}

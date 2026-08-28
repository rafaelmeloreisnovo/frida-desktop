import { BugEvent, BugPattern, PatternDetector, FixStrategy } from './types';
import {
  generatePatternId,
  calculateConfidence,
  calculateSeverity,
  detectBugCluster,
  filterByTimeWindow,
  compareStackTraces
} from './utils';

export class PatternDetectorImpl implements PatternDetector {
  private confidence_threshold: number = 0.75;
  private min_occurrences: number = 3;

  constructor(config?: { confidence_threshold?: number; min_occurrences?: number }) {
    if (config?.confidence_threshold) {
      this.confidence_threshold = config.confidence_threshold;
    }
    if (config?.min_occurrences) {
      this.min_occurrences = config.min_occurrences;
    }
  }

  async detectPatterns(events: BugEvent[]): Promise<BugPattern[]> {
    console.log(`[PatternDetector] Analyzing ${events.length} events...`);

    if (events.length < this.min_occurrences) {
      console.log('[PatternDetector] Not enough events for pattern detection');
      return [];
    }

    const clusters = detectBugCluster(events);
    const patterns: BugPattern[] = [];

    for (const [key, cluster] of clusters) {
      if (cluster.length < this.min_occurrences) {
        continue;
      }

      const pattern = this.analyzeCluster(cluster);

      if (pattern && pattern.confidence >= this.confidence_threshold) {
        patterns.push(pattern);
        console.log(
          `[PatternDetector] Found pattern: ${pattern.bug_type} in ${pattern.class}.${pattern.method} ` +
          `(${pattern.occurrences} occurrences, confidence: ${pattern.confidence.toFixed(2)})`
        );
      }
    }

    return patterns.sort((a, b) => b.confidence - a.confidence);
  }

  async updateConfidence(pattern: BugPattern): Promise<number> {
    const recencyBoost = this.calculateRecencyBoost(pattern.last_seen);
    const newConfidence = Math.min(1, pattern.confidence + recencyBoost * 0.1);

    console.log(`[PatternDetector] Updated confidence for ${pattern.pattern_id}: ${newConfidence.toFixed(2)}`);
    return newConfidence;
  }

  async shouldApplyFix(pattern: BugPattern): Promise<boolean> {
    const shouldApply =
      pattern.confidence >= this.confidence_threshold &&
      pattern.occurrences >= this.min_occurrences;

    console.log(
      `[PatternDetector] Should apply fix for ${pattern.pattern_id}: ${shouldApply} ` +
      `(confidence: ${pattern.confidence.toFixed(2)}, occurrences: ${pattern.occurrences})`
    );

    return shouldApply;
  }

  private analyzeCluster(cluster: BugEvent[]): BugPattern | null {
    const first = cluster[0];
    const timeSpan = cluster[cluster.length - 1].timestamp - cluster[0].timestamp;
    const confidence = calculateConfidence(cluster.length, timeSpan);

    if (confidence < this.confidence_threshold) {
      return null;
    }

    const strategy = this.selectStrategy(first.bug_type, cluster.length);

    return {
      pattern_id: generatePatternId(),
      bug_type: first.bug_type,
      class: first.class,
      method: first.method,
      exception_type: first.exception_type,
      occurrences: cluster.length,
      confidence,
      last_seen: cluster[cluster.length - 1].timestamp,
      suggested_fix: this.generateFixSuggestion(first),
      fix_strategy: strategy
    };
  }

  private selectStrategy(bugType: string, occurrences: number): FixStrategy {
    switch (bugType) {
      case 'crash':
        return occurrences > 5 ? 'monkey_patch_from_journal' : 'try_catch_with_fallback';
      case 'anr':
        return 'component_restart';
      case 'memory_leak':
        return 'monkey_patch_from_journal';
      case 'deadlock':
        return 'try_catch_with_fallback';
      default:
        return 'try_catch_with_fallback';
    }
  }

  private generateFixSuggestion(event: BugEvent): string {
    return `Fix for ${event.exception_type || 'unknown'} in ${event.class}.${event.method}`;
  }

  private calculateRecencyBoost(lastSeen: number): number {
    const age = Date.now() - lastSeen;
    const oneDayMs = 24 * 60 * 60 * 1000;

    if (age < oneDayMs) {
      return 1.0;
    } else if (age < 7 * oneDayMs) {
      return 0.7;
    } else if (age < 30 * oneDayMs) {
      return 0.3;
    }

    return 0;
  }
}

export function createPatternDetector(config?: any): PatternDetector {
  return new PatternDetectorImpl(config);
}

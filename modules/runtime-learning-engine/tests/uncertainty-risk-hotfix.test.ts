import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { deriveOptimizationRiskAdjustment, OptimizationConfig } from '../auto-optimizer';
import { PatternDetectorImpl } from '../pattern-detector';
import { IntegrityVerifier } from '../integrity-verifier';
import { BugEvent } from '../types';

describe('uncertainty risk hotfix', () => {
  test('high rollback or low success can only tighten automatic actuation', () => {
    const config: OptimizationConfig = {
      confidence_threshold: 0.75,
      min_occurrences_before_fix: 3,
      preferred_strategy: 'monkey_patch_from_journal'
    };

    const stressed = deriveOptimizationRiskAdjustment(
      { success_rate: 55, rollback_rate: 40 },
      config
    );
    expect(stressed.confidence_delta).toBeGreaterThan(0);
    expect(stressed.min_occurrences_delta).toBeGreaterThan(0);

    const strong = deriveOptimizationRiskAdjustment(
      { success_rate: 99, rollback_rate: 0 },
      config
    );
    expect(strong.confidence_delta).toBe(0);
    expect(strong.min_occurrences_delta).toBe(0);
  });

  test('heuristic observation-only clusters never authorize automatic mutation', async () => {
    const detector = new PatternDetectorImpl({ confidence_threshold: 0.1, min_occurrences: 3 });
    const events: BugEvent[] = [0, 1, 2].map(index => ({
      id: `evt-${index}`,
      timestamp: 1000 + index,
      bug_type: 'memory_leak',
      class: 'java.lang.Runtime',
      method: 'gc',
      exception_type: 'MemoryPressureObserved',
      stack_hash: `stack-${index}`,
      severity: 'high',
      actionability: 'OBSERVATION_ONLY',
      status: 'new'
    }));

    const patterns = await detector.detectPatterns(events);
    expect(patterns).toHaveLength(1);
    expect(patterns[0].actionability).toBe('OBSERVATION_ONLY');
    expect(await detector.shouldApplyFix(patterns[0])).toBe(false);
  });

  test('integrity verifier uses SHA-256 while fast routing hashes remain separate', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frida-integrity-'));
    try {
      const body = JSON.stringify({ schema: 1, events: [] });
      fs.writeFileSync(path.join(dir, 'bug-history.json'), body, 'utf8');
      const verifier = new IntegrityVerifier(dir);
      const report = await verifier.verifyIntegrity();
      const check = report.checks.find(item => item.file === 'bug-history.json');
      const expected = crypto.createHash('sha256').update(body, 'utf8').digest('hex');

      expect(check).toBeDefined();
      expect(check?.hash_algorithm).toBe('sha256');
      expect(check?.hash).toBe(expected);
      expect(check?.hash).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

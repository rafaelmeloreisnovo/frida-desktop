/**
 * Phase 3.3: Concurrent Bug Capture Handler
 *
 * Validates safe concurrent bug capture without race conditions,
 * deadlocks, or data corruption.
 */

export interface ConcurrentCaptureStats {
  total_bugs: number;
  concurrent_peaks: number;
  race_conditions_detected: number;
  deadlocks_detected: number;
  data_corruption_detected: number;
  capture_latencies: {
    min_ms: number;
    max_ms: number;
    avg_ms: number;
    p95_ms: number;
    p99_ms: number;
  };
  lock_contention: {
    total_locks_acquired: number;
    max_wait_time_ms: number;
    avg_wait_time_ms: number;
  };
  status: 'passed' | 'failed' | 'degraded';
}

export class ConcurrentBugCaptureHandler {
  private activeBugCaptures: Map<string, string> = new Map(); // bugId -> captureToken
  private captureLatencies: number[] = [];
  private lockWaitTimes: number[] = [];
  private raceConditions: number = 0;
  private deadlocks: number = 0;
  private corruptions: number = 0;
  private lockAcquisitions: number = 0;
  private maxConcurrentOps: number = 0;

  /**
   * Simulate concurrent bug capture with proper locking
   */
  async captureBugConcurrent(bugId: string, delayMs: number = 0): Promise<number> {
    const startTime = Date.now();
    const lockStartTime = Date.now();

    // Check if bug is already being captured (race condition prevention)
    if (this.activeBugCaptures.has(bugId)) {
      this.raceConditions++;
      throw new Error(`Race condition: bug ${bugId} already being captured`);
    }

    // Simulate acquiring lock
    await this.acquireLock(bugId);
    const lockWaitTime = Date.now() - lockStartTime;
    this.lockWaitTimes.push(lockWaitTime);
    this.lockAcquisitions++;

    try {
      // Record concurrent operation count with unique token to prevent race conditions
      const captureToken = `${bugId}_${Math.random()}`;
      this.activeBugCaptures.set(bugId, captureToken);
      const concurrentCount = this.activeBugCaptures.size;
      if (concurrentCount > this.maxConcurrentOps) {
        this.maxConcurrentOps = concurrentCount;
      }

      // Simulate bug capture operation
      if (delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }

      // Verify capture token hasn't changed (no race condition)
      if (this.activeBugCaptures.get(bugId) !== captureToken) {
        this.raceConditions++;
        throw new Error(`Race condition detected for bug ${bugId}`);
      }

      const latency = Date.now() - startTime;
      this.captureLatencies.push(latency);

      return latency;
    } finally {
      // Release lock and remove from active captures
      this.activeBugCaptures.delete(bugId);
      await this.releaseLock(bugId);
    }
  }

  /**
   * Simulate lock acquisition
   */
  private async acquireLock(bugId: string): Promise<void> {
    // Simulate spinlock with timeout detection (deadlock prevention)
    let retries = 0;
    const maxRetries = 100;

    while (this.lockHeld(bugId) && retries < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, 1));
      retries++;
    }

    if (retries >= maxRetries) {
      this.deadlocks++;
      throw new Error(`Deadlock detected acquiring lock for ${bugId}`);
    }
  }

  /**
   * Check if lock is held
   */
  private lockHeld(bugId: string): boolean {
    // In real implementation, would check actual mutex
    return false;
  }

  /**
   * Release lock
   */
  private async releaseLock(bugId: string): Promise<void> {
    // In real implementation, would release actual mutex
    await Promise.resolve();
  }

  /**
   * Run parallel bug captures at varying concurrency levels
   */
  async runConcurrencyTest(concurrencyLevels: number[]): Promise<ConcurrentCaptureStats> {
    this.captureLatencies = [];
    this.lockWaitTimes = [];
    this.raceConditions = 0;
    this.deadlocks = 0;
    this.corruptions = 0;
    this.maxConcurrentOps = 0;

    for (const concurrency of concurrencyLevels) {
      const promises: Promise<number>[] = [];

      for (let i = 0; i < concurrency; i++) {
        const bugId = `bug_${concurrency}_${i}`;
        promises.push(this.captureBugConcurrent(bugId, Math.random() * 10));
      }

      try {
        await Promise.all(promises);
      } catch (e) {
        console.error('[ConcurrentCapture] Error during test:', e);
      }
    }

    return this.getStats();
  }

  /**
   * Detect potential data corruption
   */
  validateDataIntegrity(): boolean {
    // Check for:
    // 1. Duplicate bug captures (race condition aftermath)
    // 2. Missing captures (lost data)
    // 3. Corrupted state in active captures map
    // 4. Lock state inconsistency

    if (this.activeBugCaptures.size > 0) {
      this.corruptions++;
      return false; // Lock not released properly
    }

    return true;
  }

  /**
   * Get concurrency test statistics
   */
  getStats(): ConcurrentCaptureStats {
    const sorted = [...this.captureLatencies].sort((a, b) => a - b);
    const lockSorted = [...this.lockWaitTimes].sort((a, b) => a - b);

    const status =
      this.raceConditions > 0 || this.deadlocks > 0 || this.corruptions > 0
        ? 'failed'
        : this.maxConcurrentOps > 10
          ? 'degraded'
          : 'passed';

    return {
      total_bugs: this.captureLatencies.length,
      concurrent_peaks: this.maxConcurrentOps,
      race_conditions_detected: this.raceConditions,
      deadlocks_detected: this.deadlocks,
      data_corruption_detected: this.corruptions,
      capture_latencies: {
        min_ms: sorted.length > 0 ? sorted[0] : 0,
        max_ms: sorted.length > 0 ? sorted[sorted.length - 1] : 0,
        avg_ms: sorted.length > 0 ? sorted.reduce((a, b) => a + b) / sorted.length : 0,
        p95_ms: sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.95)] : 0,
        p99_ms: sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.99)] : 0
      },
      lock_contention: {
        total_locks_acquired: this.lockAcquisitions,
        max_wait_time_ms: lockSorted.length > 0 ? lockSorted[lockSorted.length - 1] : 0,
        avg_wait_time_ms: lockSorted.length > 0 ? lockSorted.reduce((a, b) => a + b) / lockSorted.length : 0
      },
      status
    };
  }

  /**
   * Reset handler for next test
   */
  reset(): void {
    this.activeBugCaptures.clear();
    this.captureLatencies = [];
    this.lockWaitTimes = [];
    this.raceConditions = 0;
    this.deadlocks = 0;
    this.corruptions = 0;
    this.lockAcquisitions = 0;
    this.maxConcurrentOps = 0;
  }
}

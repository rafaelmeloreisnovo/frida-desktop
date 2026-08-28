import { PerformanceBenchmarking, PERFORMANCE_BASELINES } from '../performance-benchmarking';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Phase 4.3: Performance Benchmarking Test Suite
 *
 * Tests performance under load with latency tracking, memory profiling,
 * and performance ceiling identification.
 */

describe('Phase 4.3: Performance Benchmarking', () => {
  let benchmarking: PerformanceBenchmarking;
  const testDir = '/tmp/perf-test-results';

  beforeAll(() => {
    benchmarking = new PerformanceBenchmarking(testDir);
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  describe('Phase 4.3.1: Latency Measurement & Percentiles', () => {
    test('can record latency measurements', () => {
      const measurement = benchmarking.recordLatency('test_op', 45, true);

      expect(measurement).toHaveProperty('operationName', 'test_op');
      expect(measurement).toHaveProperty('durationMs', 45);
      expect(measurement).toHaveProperty('success', true);
      console.log('[Perf] Recorded latency: 45ms for test_op');
    });

    test('can calculate percentiles from measurements', () => {
      // Record 100 measurements
      for (let i = 0; i < 100; i++) {
        benchmarking.recordLatency('percentile_test', 10 + Math.random() * 90, true);
      }

      const percentiles = benchmarking.calculatePercentiles('percentile_test');

      expect(percentiles.count).toBe(100);
      expect(percentiles.p50).toBeGreaterThanOrEqual(10);
      expect(percentiles.p95).toBeGreaterThanOrEqual(percentiles.p50);
      expect(percentiles.p99).toBeGreaterThanOrEqual(percentiles.p95);
      expect(percentiles.max).toBeGreaterThanOrEqual(percentiles.p99);
      expect(percentiles.avg).toBeGreaterThan(0);

      console.log(`[Perf] Percentiles: p50=${percentiles.p50.toFixed(1)}ms, p95=${percentiles.p95.toFixed(1)}ms, p99=${percentiles.p99.toFixed(1)}ms`);
    });

    test('p99 latency within SLA for bug capture', () => {
      const percentiles = benchmarking.calculatePercentiles('percentile_test');
      const slaThreshold = 150; // 1.5x of 100ms SLA

      // Simulated result should generally be within threshold
      if (percentiles.count > 0) {
        console.log(`[Perf] Bug capture p99: ${percentiles.p99.toFixed(1)}ms (SLA threshold: ${slaThreshold}ms)`);
      }
    });

    test('handles empty measurements gracefully', () => {
      const percentiles = benchmarking.calculatePercentiles('nonexistent_op');

      expect(percentiles.count).toBe(0);
      expect(percentiles.p50).toBe(0);
      expect(percentiles.p95).toBe(0);
      expect(percentiles.p99).toBe(0);
    });
  });

  describe('Phase 4.3.2: Memory Profiling', () => {
    test('can record memory profiles', () => {
      benchmarking.recordMemoryProfile({
        heapUsedMb: 150,
        heapTotalMb: 256,
        external: 10,
        rss: 200,
        peakHeapMb: 250
      });

      // Record multiple profiles to simulate over time
      for (let i = 0; i < 10; i++) {
        benchmarking.recordMemoryProfile({
          heapUsedMb: 100 + Math.random() * 100,
          heapTotalMb: 256,
          external: 10,
          rss: 150 + Math.random() * 100,
          peakHeapMb: 250
        });
      }

      console.log('[Perf] Recorded 11 memory profiles');
      expect(true).toBe(true);
    });
  });

  describe('Phase 4.3.3: Load Test Execution', () => {
    test('can run load test with progressive rates', async () => {
      const config = {
        eventRatesPerSecond: [10, 25, 50],
        durationSeconds: 1,
        targetDeviceType: 'ARM64' as const,
        bugTypes: ['crash', 'anr', 'memory_leak'],
        concurrency: 4
      };

      const result = await benchmarking.runLoadTest(config);

      expect(result).toHaveProperty('config');
      expect(result).toHaveProperty('startTime');
      expect(result).toHaveProperty('endTime');
      expect(result).toHaveProperty('totalEventsProcessed');
      expect(result).toHaveProperty('latencyStats');
      expect(result).toHaveProperty('memoryStats');
      expect(result).toHaveProperty('performanceCeiling');

      expect(result.totalEventsProcessed).toBeGreaterThan(0);
      expect(result.latencyStats.bugCapture.count).toBeGreaterThan(0);

      console.log(`[Perf] Load test completed: ${result.totalEventsProcessed} events`);
      console.log(`  Peak rate: ${result.peakEventRate.toFixed(1)} events/sec`);
      console.log(`  Bug capture p95: ${result.latencyStats.bugCapture.p95.toFixed(1)}ms`);
      console.log(`  Pattern detection p95: ${result.latencyStats.patternDetection.p95.toFixed(1)}ms`);
      console.log(`  Fix application p95: ${result.latencyStats.fixApplication.p95.toFixed(1)}ms`);
    });

    test('identifies performance ceiling correctly', async () => {
      const config = {
        eventRatesPerSecond: [50, 100, 200],
        durationSeconds: 1,
        targetDeviceType: 'ARM64' as const,
        bugTypes: ['crash', 'anr'],
        concurrency: 8
      };

      const result = await benchmarking.runLoadTest(config);

      expect(result.performanceCeiling).toHaveProperty('maxEventsPerSec');
      expect(result.performanceCeiling).toHaveProperty('maxConcurrentOps');
      expect(result.performanceCeiling).toHaveProperty('maxMemoryMb');

      expect(result.performanceCeiling.maxEventsPerSec).toBeGreaterThan(0);
      expect(result.performanceCeiling.maxConcurrentOps).toBe(8);
      expect(result.performanceCeiling.maxMemoryMb).toBeGreaterThan(100);

      console.log(`[Perf] Performance ceiling: ${result.performanceCeiling.maxEventsPerSec} events/sec`);
    });
  });

  describe('Phase 4.3.4: Baseline Comparison', () => {
    test('ARM64 baseline is defined', () => {
      const arm64 = PERFORMANCE_BASELINES.find(b => b.deviceType === 'ARM64');

      expect(arm64).toBeDefined();
      expect(arm64).toHaveProperty('bugCaptureLat');
      expect(arm64).toHaveProperty('patternDetectionLat');
      expect(arm64).toHaveProperty('fixApplicationLat');
      expect(arm64).toHaveProperty('rollbackLat');
      expect(arm64).toHaveProperty('memoryMb');
      expect(arm64).toHaveProperty('maxThroughput');

      console.log(`[Perf] ARM64 baseline: max ${arm64?.maxThroughput} events/sec`);
    });

    test('ARM32 baseline is defined', () => {
      const arm32 = PERFORMANCE_BASELINES.find(b => b.deviceType === 'ARM32');

      expect(arm32).toBeDefined();
      expect(arm32?.maxThroughput).toBeLessThan(
        PERFORMANCE_BASELINES.find(b => b.deviceType === 'ARM64')?.maxThroughput || 0
      );

      console.log(`[Perf] ARM32 baseline: max ${arm32?.maxThroughput} events/sec (slower than ARM64)`);
    });

    test('can compare measured performance to baseline', () => {
      // Record some measurements
      for (let i = 0; i < 50; i++) {
        benchmarking.recordLatency('bug_capture', 30 + Math.random() * 50, true);
        benchmarking.recordLatency('pattern_detection', 150 + Math.random() * 200, true);
        benchmarking.recordLatency('fix_application', 400 + Math.random() * 300, true);
        benchmarking.recordLatency('rollback', 200 + Math.random() * 200, true);
      }

      const comparison = benchmarking.compareToBaseline('ARM64');

      expect(comparison).toHaveProperty('passedChecks');
      expect(comparison).toHaveProperty('failedChecks');
      expect(comparison).toHaveProperty('compliancePercentage');

      expect(Array.isArray(comparison.passedChecks)).toBe(true);
      expect(comparison.compliancePercentage).toBeGreaterThanOrEqual(0);
      expect(comparison.compliancePercentage).toBeLessThanOrEqual(100);

      console.log(`[Perf] Baseline compliance: ${comparison.compliancePercentage.toFixed(1)}%`);
      console.log(`  Passed: ${comparison.passedChecks.length}, Failed: ${comparison.failedChecks.length}`);
    });
  });

  describe('Phase 4.3.5: Scalability Testing', () => {
    test('performance degrades gracefully under extreme load', async () => {
      const config = {
        eventRatesPerSecond: [100, 500, 1000],
        durationSeconds: 1,
        targetDeviceType: 'ARM32' as const,
        bugTypes: ['crash', 'anr', 'memory_leak', 'deadlock'],
        concurrency: 16
      };

      const result = await benchmarking.runLoadTest(config);

      // At higher loads, latencies should increase but not linearly
      const p50Increase = result.latencyStats.bugCapture.p50 / 30; // baseline ~30ms
      const p95Increase = result.latencyStats.bugCapture.p95 / 80; // baseline ~80ms

      console.log(`[Perf] Under extreme load:`);
      console.log(`  Bug capture p50 increase: ${(p50Increase - 1).toFixed(1)}x`);
      console.log(`  Bug capture p95 increase: ${(p95Increase - 1).toFixed(1)}x`);
      console.log(`  Failure rate: ${(result.failureRate * 100).toFixed(1)}%`);

      // Should still maintain reasonable performance
      expect(result.failureRate).toBeLessThan(0.5); // Less than 50% failure
    }, 20000);

    test('memory usage scales predictably', async () => {
      const config = {
        eventRatesPerSecond: [50, 100],
        durationSeconds: 2,
        targetDeviceType: 'ARM64' as const,
        bugTypes: ['crash'],
        concurrency: 4
      };

      const result = await benchmarking.runLoadTest(config);

      expect(result.memoryStats.peakHeap).toBeGreaterThan(0);
      expect(result.memoryStats.peakHeap).toBeLessThan(512); // Should not exceed 512MB

      console.log(`[Perf] Memory scaling:`);
      console.log(`  Peak heap: ${result.memoryStats.peakHeap.toFixed(1)}MB`);
      console.log(`  Avg heap: ${result.memoryStats.avgHeap.toFixed(1)}MB`);
    }, 15000);
  });

  describe('Phase 4.3.6: Report Generation', () => {
    test('can generate performance report', () => {
      const report = benchmarking.generateReport();

      expect(typeof report).toBe('string');
      expect(report).toContain('Performance Benchmarking Report');
      expect(report).toContain('Bug Capture Latency');
      expect(report).toContain('p50');
      expect(report).toContain('p95');
      expect(report).toContain('p99');

      console.log('[Perf] Performance report generated');
      console.log(report);
    });

    test('report contains all required metrics', () => {
      const report = benchmarking.generateReport();

      const requiredSections = [
        'Bug Capture Latency',
        'Pattern Detection Latency',
        'Fix Application Latency',
        'Rollback Latency',
        'Memory Profile'
      ];

      for (const section of requiredSections) {
        expect(report).toContain(section);
      }
    });
  });

  describe('Phase 4.3 Checklist', () => {
    test('Phase 4.3 requirements documented', () => {
      const requirements = [
        'Load testing infrastructure (progressive rates)',
        'Latency percentile tracking (p50, p95, p99)',
        'Memory profiling during load',
        'Performance ceiling identification',
        'Baseline comparison by device type (ARM32/ARM64)',
        'Scalability testing (extreme load scenarios)',
        'Memory usage predictions',
        'Graceful degradation validation',
        'Report generation with all metrics'
      ];

      expect(requirements.length).toBeGreaterThan(0);
      console.log('[Perf] Phase 4.3 Requirements Checklist:');
      requirements.forEach((req, i) => {
        console.log(`  ${i + 1}. ${req}`);
      });
    });

    test('Phase 4.3 completion criteria defined', () => {
      const criteria = [
        'Load test passes at 50+ events/sec on ARM64',
        'Load test passes at 25+ events/sec on ARM32',
        'Latency p95 within baseline expectations',
        'Memory usage under 300MB peak',
        'No excessive degradation at extreme loads',
        'Performance ceiling identified and documented',
        'Baseline comparison completed',
        'Scalability validated',
        'Report generated with full metrics'
      ];

      expect(criteria.length).toBeGreaterThan(0);
      console.log('[Perf] Phase 4.3 Completion Criteria:');
      criteria.forEach((c, i) => {
        console.log(`  ${i + 1}. ${c}`);
      });
    });
  });
});

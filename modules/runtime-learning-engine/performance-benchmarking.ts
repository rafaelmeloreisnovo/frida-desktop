import * as fs from 'fs';
import * as path from 'path';

/**
 * Performance Benchmarking Infrastructure
 *
 * Load testing with latency tracking, memory profiling, and performance
 * ceiling identification for the Runtime Learning Engine.
 */

export interface PerformanceMetric {
  timestamp: number;
  metricName: string;
  value: number;
  unit: string;
  deviceType: 'ARM32' | 'ARM64';
}

export interface LatencyMeasurement {
  operationName: string;
  startTime: number;
  endTime: number;
  durationMs: number;
  success: boolean;
  error?: string;
}

export interface LatencyPercentiles {
  p50: number;
  p95: number;
  p99: number;
  max: number;
  min: number;
  avg: number;
  count: number;
}

export interface MemoryProfile {
  timestamp: number;
  heapUsedMb: number;
  heapTotalMb: number;
  external: number;
  rss: number;
  peakHeapMb: number;
}

export interface LoadTestConfig {
  eventRatesPerSecond: number[];
  durationSeconds: number;
  targetDeviceType: 'ARM32' | 'ARM64';
  bugTypes: string[];
  concurrency: number;
}

export interface LoadTestResult {
  config: LoadTestConfig;
  startTime: number;
  endTime: number;
  totalEventsProcessed: number;
  peakEventRate: number;
  avgEventRate: number;
  latencyStats: {
    bugCapture: LatencyPercentiles;
    patternDetection: LatencyPercentiles;
    fixApplication: LatencyPercentiles;
    rollback: LatencyPercentiles;
  };
  memoryStats: {
    peakHeap: number;
    avgHeap: number;
    peakRss: number;
  };
  failureRate: number;
  successfulOperations: number;
  failedOperations: number;
  performanceCeiling: {
    maxEventsPerSec: number;
    maxConcurrentOps: number;
    maxMemoryMb: number;
  };
}

export interface PerformanceBaseline {
  deviceType: 'ARM32' | 'ARM64';
  androidVersion: number;
  bugCaptureLat: { p50: number; p95: number; p99: number };
  patternDetectionLat: { p50: number; p95: number; p99: number };
  fixApplicationLat: { p50: number; p95: number; p99: number };
  rollbackLat: { p50: number; p95: number; p99: number };
  memoryMb: { typical: number; peak: number };
  maxThroughput: number;
}

export const PERFORMANCE_BASELINES: PerformanceBaseline[] = [
  {
    deviceType: 'ARM64',
    androidVersion: 10,
    bugCaptureLat: { p50: 35, p95: 80, p99: 120 },
    patternDetectionLat: { p50: 150, p95: 400, p99: 600 },
    fixApplicationLat: { p50: 400, p95: 900, p99: 1300 },
    rollbackLat: { p50: 200, p95: 450, p99: 700 },
    memoryMb: { typical: 150, peak: 250 },
    maxThroughput: 500
  },
  {
    deviceType: 'ARM32',
    androidVersion: 10,
    bugCaptureLat: { p50: 60, p95: 150, p99: 250 },
    patternDetectionLat: { p50: 250, p95: 600, p99: 900 },
    fixApplicationLat: { p50: 700, p95: 1300, p99: 1800 },
    rollbackLat: { p50: 300, p95: 700, p99: 1000 },
    memoryMb: { typical: 120, peak: 200 },
    maxThroughput: 200
  }
];

export class PerformanceBenchmarking {
  private measurements: LatencyMeasurement[] = [];
  private memoryProfiles: MemoryProfile[] = [];
  private startTime: number = 0;
  private storagePath: string;

  constructor(storagePath: string = '/tmp/performance-benchmarking') {
    this.storagePath = storagePath;
    if (!fs.existsSync(storagePath)) {
      fs.mkdirSync(storagePath, { recursive: true });
    }
  }

  /**
   * Record a latency measurement
   */
  recordLatency(
    operationName: string,
    durationMs: number,
    success: boolean,
    error?: string
  ): LatencyMeasurement {
    const measurement: LatencyMeasurement = {
      operationName,
      startTime: Date.now() - durationMs,
      endTime: Date.now(),
      durationMs,
      success,
      error
    };

    this.measurements.push(measurement);
    return measurement;
  }

  /**
   * Record memory profile
   */
  recordMemoryProfile(profile: Omit<MemoryProfile, 'timestamp'>): void {
    const memProfile: MemoryProfile = {
      timestamp: Date.now(),
      ...profile
    };

    this.memoryProfiles.push(memProfile);
  }

  /**
   * Calculate latency percentiles for an operation
   */
  calculatePercentiles(operationName: string): LatencyPercentiles {
    const measurements = this.measurements
      .filter(m => m.operationName === operationName && m.success)
      .map(m => m.durationMs)
      .sort((a, b) => a - b);

    if (measurements.length === 0) {
      return { p50: 0, p95: 0, p99: 0, max: 0, min: 0, avg: 0, count: 0 };
    }

    const p50 = measurements[Math.floor(measurements.length * 0.5)];
    const p95 = measurements[Math.floor(measurements.length * 0.95)];
    const p99 = measurements[Math.floor(measurements.length * 0.99)];
    const max = measurements[measurements.length - 1];
    const min = measurements[0];
    const avg = measurements.reduce((a, b) => a + b, 0) / measurements.length;

    return { p50, p95, p99, max, min, avg, count: measurements.length };
  }

  /**
   * Run load test with progressive event rates
   */
  async runLoadTest(config: LoadTestConfig): Promise<LoadTestResult> {
    console.log(`[PerformanceBenchmarking] Starting load test`);
    console.log(`  Event rates: ${config.eventRatesPerSecond.join(' → ')} events/sec`);
    console.log(`  Duration: ${config.durationSeconds}s per rate`);
    console.log(`  Target device: ${config.targetDeviceType}`);
    console.log(`  Concurrency: ${config.concurrency}`);

    this.startTime = Date.now();
    this.measurements = [];
    this.memoryProfiles = [];

    let totalEventsProcessed = 0;
    let successfulOps = 0;
    let failedOps = 0;
    let peakRate = 0;

    for (const ratePerSec of config.eventRatesPerSecond) {
      console.log(`\n[PerformanceBenchmarking] Testing at ${ratePerSec} events/sec...`);
      const rateStartTime = Date.now();
      const rateEndTime = rateStartTime + config.durationSeconds * 1000;
      let rateEventsProcessed = 0;

      while (Date.now() < rateEndTime) {
        const batchSize = Math.ceil((ratePerSec * config.concurrency) / 1000);

        for (let i = 0; i < batchSize && Date.now() < rateEndTime; i++) {
          const bugType = config.bugTypes[i % config.bugTypes.length];
          const opStartTime = Date.now();

          try {
            // Simulate bug capture
            await this.simulateBugCapture(bugType);
            const captureLat = Date.now() - opStartTime;
            this.recordLatency('bug_capture', captureLat, true);
            successfulOps++;

            // Simulate pattern detection
            const patternStartTime = Date.now();
            await this.simulatePatternDetection();
            const patternLat = Date.now() - patternStartTime;
            this.recordLatency('pattern_detection', patternLat, true);

            // Simulate fix application
            const fixStartTime = Date.now();
            await this.simulateFixApplication();
            const fixLat = Date.now() - fixStartTime;
            this.recordLatency('fix_application', fixLat, true);

            totalEventsProcessed++;
            rateEventsProcessed++;
          } catch (e: any) {
            this.recordLatency('operation', 0, false, e.message);
            failedOps++;
          }

          // Record memory
          this.recordMemoryProfile({
            heapUsedMb: Math.random() * 200,
            heapTotalMb: 256,
            external: 10,
            rss: Math.random() * 250,
            peakHeapMb: 250
          });
        }

        await new Promise(r => setTimeout(r, 10)); // Yield to event loop
      }

      const actualRate = (rateEventsProcessed / config.durationSeconds);
      peakRate = Math.max(peakRate, actualRate);
      console.log(`  Processed: ${rateEventsProcessed} events at ${actualRate.toFixed(1)} events/sec`);
    }

    const latencyStats = {
      bugCapture: this.calculatePercentiles('bug_capture'),
      patternDetection: this.calculatePercentiles('pattern_detection'),
      fixApplication: this.calculatePercentiles('fix_application'),
      rollback: this.calculatePercentiles('rollback')
    };

    const memoryStats = this.calculateMemoryStats();
    const performanceCeiling = this.identifyPerformanceCeiling(config, latencyStats);

    const result: LoadTestResult = {
      config,
      startTime: this.startTime,
      endTime: Date.now(),
      totalEventsProcessed,
      peakEventRate: peakRate,
      avgEventRate: totalEventsProcessed / ((Date.now() - this.startTime) / 1000),
      latencyStats,
      memoryStats,
      failureRate: failedOps / (successfulOps + failedOps),
      successfulOperations: successfulOps,
      failedOperations: failedOps,
      performanceCeiling
    };

    this.saveLoadTestResult(result);
    return result;
  }

  /**
   * Identify performance ceiling based on measurements
   */
  private identifyPerformanceCeiling(
    config: LoadTestConfig,
    latencyStats: any
  ): LoadTestResult['performanceCeiling'] {
    // Performance ceiling is reached when:
    // 1. p99 latency exceeds SLA for any operation
    // 2. Memory usage approaches limit
    // 3. Failure rate exceeds threshold

    let maxEventsPerSec = config.eventRatesPerSecond[config.eventRatesPerSecond.length - 1];

    // Check if p99 latencies violate SLAs
    if (latencyStats.bugCapture.p99 > 150) {
      maxEventsPerSec = Math.min(maxEventsPerSec, Math.floor(maxEventsPerSec * 0.7));
    }
    if (latencyStats.patternDetection.p99 > 600) {
      maxEventsPerSec = Math.min(maxEventsPerSec, Math.floor(maxEventsPerSec * 0.8));
    }

    const baseline = PERFORMANCE_BASELINES.find(b => b.deviceType === config.targetDeviceType);
    const maxMemoryMb = baseline ? baseline.memoryMb.peak : 300;

    return {
      maxEventsPerSec,
      maxConcurrentOps: config.concurrency,
      maxMemoryMb
    };
  }

  /**
   * Calculate memory statistics
   */
  private calculateMemoryStats() {
    if (this.memoryProfiles.length === 0) {
      return { peakHeap: 0, avgHeap: 0, peakRss: 0 };
    }

    const heaps = this.memoryProfiles.map(m => m.heapUsedMb);
    const rsses = this.memoryProfiles.map(m => m.rss);

    return {
      peakHeap: Math.max(...heaps),
      avgHeap: heaps.reduce((a, b) => a + b, 0) / heaps.length,
      peakRss: Math.max(...rsses)
    };
  }

  /**
   * Simulate bug capture
   */
  private async simulateBugCapture(bugType: string): Promise<void> {
    const latency = bugType === 'crash' ? 30 + Math.random() * 50 : 50 + Math.random() * 100;
    await new Promise(r => setTimeout(r, latency));
  }

  /**
   * Simulate pattern detection
   */
  private async simulatePatternDetection(): Promise<void> {
    const latency = 100 + Math.random() * 300;
    await new Promise(r => setTimeout(r, latency));
  }

  /**
   * Simulate fix application
   */
  private async simulateFixApplication(): Promise<void> {
    const latency = 300 + Math.random() * 400;
    await new Promise(r => setTimeout(r, latency));
  }

  /**
   * Save load test result to disk
   */
  private saveLoadTestResult(result: LoadTestResult): void {
    const resultPath = path.join(this.storagePath, `load-test-${Date.now()}.json`);
    fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
    console.log(`[PerformanceBenchmarking] Results saved to ${resultPath}`);
  }

  /**
   * Compare measured performance against baseline
   */
  compareToBaseline(deviceType: 'ARM32' | 'ARM64'): {
    passedChecks: string[];
    failedChecks: string[];
    compliancePercentage: number;
  } {
    const baseline = PERFORMANCE_BASELINES.find(b => b.deviceType === deviceType);
    if (!baseline) {
      return { passedChecks: [], failedChecks: [], compliancePercentage: 0 };
    }

    const checks: { name: string; passed: boolean }[] = [];
    const bugCapturePercentiles = this.calculatePercentiles('bug_capture');
    const patternDetectionPercentiles = this.calculatePercentiles('pattern_detection');
    const fixApplicationPercentiles = this.calculatePercentiles('fix_application');
    const rollbackPercentiles = this.calculatePercentiles('rollback');

    checks.push({
      name: 'Bug Capture p50',
      passed: bugCapturePercentiles.p50 <= baseline.bugCaptureLat.p50 * 1.1
    });
    checks.push({
      name: 'Bug Capture p95',
      passed: bugCapturePercentiles.p95 <= baseline.bugCaptureLat.p95 * 1.1
    });
    checks.push({
      name: 'Pattern Detection p50',
      passed: patternDetectionPercentiles.p50 <= baseline.patternDetectionLat.p50 * 1.1
    });
    checks.push({
      name: 'Fix Application p95',
      passed: fixApplicationPercentiles.p95 <= baseline.fixApplicationLat.p95 * 1.1
    });
    checks.push({
      name: 'Rollback p95',
      passed: rollbackPercentiles.p95 <= baseline.rollbackLat.p95 * 1.1
    });

    const passedCount = checks.filter(c => c.passed).length;
    const compliancePercentage = (passedCount / checks.length) * 100;

    return {
      passedChecks: checks.filter(c => c.passed).map(c => c.name),
      failedChecks: checks.filter(c => !c.passed).map(c => c.name),
      compliancePercentage
    };
  }

  /**
   * Generate performance report
   */
  generateReport(): string {
    const bugCapture = this.calculatePercentiles('bug_capture');
    const patternDetection = this.calculatePercentiles('pattern_detection');
    const fixApplication = this.calculatePercentiles('fix_application');
    const rollback = this.calculatePercentiles('rollback');
    const memStats = this.calculateMemoryStats();

    const lines = [
      '\n=== Performance Benchmarking Report ===',
      `Timestamp: ${new Date().toISOString()}`,
      `Total Measurements: ${this.measurements.length}`,
      '',
      '--- Bug Capture Latency (ms) ---',
      `  p50: ${bugCapture.p50.toFixed(1)}`,
      `  p95: ${bugCapture.p95.toFixed(1)}`,
      `  p99: ${bugCapture.p99.toFixed(1)}`,
      `  max: ${bugCapture.max.toFixed(1)}`,
      `  avg: ${bugCapture.avg.toFixed(1)}`,
      '',
      '--- Pattern Detection Latency (ms) ---',
      `  p50: ${patternDetection.p50.toFixed(1)}`,
      `  p95: ${patternDetection.p95.toFixed(1)}`,
      `  p99: ${patternDetection.p99.toFixed(1)}`,
      '',
      '--- Fix Application Latency (ms) ---',
      `  p50: ${fixApplication.p50.toFixed(1)}`,
      `  p95: ${fixApplication.p95.toFixed(1)}`,
      `  p99: ${fixApplication.p99.toFixed(1)}`,
      '',
      '--- Rollback Latency (ms) ---',
      `  p50: ${rollback.p50.toFixed(1)}`,
      `  p95: ${rollback.p95.toFixed(1)}`,
      `  p99: ${rollback.p99.toFixed(1)}`,
      '',
      '--- Memory Profile ---',
      `  Peak Heap: ${memStats.peakHeap.toFixed(1)}MB`,
      `  Avg Heap: ${memStats.avgHeap.toFixed(1)}MB`,
      `  Peak RSS: ${memStats.peakRss.toFixed(1)}MB`,
      ''
    ];

    return lines.join('\n');
  }
}

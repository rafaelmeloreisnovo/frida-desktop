import * as fs from 'fs';
import * as path from 'path';

/**
 * Performance Benchmarking Infrastructure
 *
 * Hosted tests use a deterministic synthetic workload. The numbers produced by
 * runLoadTest() are simulation evidence only and must never be promoted to
 * physical ARM/Android performance evidence.
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

  recordLatency(operationName: string, durationMs: number, success: boolean, error?: string): LatencyMeasurement {
    const endTime = Date.now();
    const measurement: LatencyMeasurement = {
      operationName,
      startTime: endTime - durationMs,
      endTime,
      durationMs,
      success,
      error
    };
    this.measurements.push(measurement);
    return measurement;
  }

  recordMemoryProfile(profile: Omit<MemoryProfile, 'timestamp'>): void {
    this.memoryProfiles.push({ timestamp: Date.now(), ...profile });
  }

  calculatePercentiles(operationName: string): LatencyPercentiles {
    const measurements = this.measurements
      .filter(m => m.operationName === operationName && m.success)
      .map(m => m.durationMs)
      .sort((a, b) => a - b);

    if (measurements.length === 0) {
      return { p50: 0, p95: 0, p99: 0, max: 0, min: 0, avg: 0, count: 0 };
    }

    const at = (fraction: number) => measurements[Math.min(measurements.length - 1, Math.floor(measurements.length * fraction))];
    const avg = measurements.reduce((a, b) => a + b, 0) / measurements.length;
    return {
      p50: at(0.5),
      p95: at(0.95),
      p99: at(0.99),
      max: measurements[measurements.length - 1],
      min: measurements[0],
      avg,
      count: measurements.length
    };
  }

  /**
   * Deterministic hosted synthetic load. This intentionally avoids wall-clock
   * sleeps and Math.random(): regression CI must be repeatable and fast.
   */
  async runLoadTest(config: LoadTestConfig): Promise<LoadTestResult> {
    console.log('[PerformanceBenchmarking] Starting deterministic hosted load test');
    console.log(`  Event rates: ${config.eventRatesPerSecond.join(' → ')} events/sec`);
    console.log(`  Synthetic duration: ${config.durationSeconds}s per rate`);
    console.log(`  Target profile: ${config.targetDeviceType}`);
    console.log(`  Concurrency: ${config.concurrency}`);

    this.startTime = Date.now();
    this.measurements = [];
    this.memoryProfiles = [];

    let totalEventsProcessed = 0;
    let successfulOps = 0;
    const failedOps = 0;
    let peakRate = 0;

    const deviceFactor = config.targetDeviceType === 'ARM32' ? 1.55 : 1.0;

    for (const ratePerSec of config.eventRatesPerSecond) {
      const eventCount = Math.max(1, Math.round(ratePerSec * Math.max(config.durationSeconds, 0.01)));
      for (let i = 0; i < eventCount; i++) {
        const bugType = config.bugTypes[i % Math.max(1, config.bugTypes.length)] || 'crash';
        const pressure = 1 + Math.max(0, ratePerSec - 50) / 500;
        const captureLatency = Math.round((bugType === 'crash' ? 35 : 55) * deviceFactor * pressure + (i % 7));
        const patternLatency = Math.round(150 * deviceFactor * pressure + (i % 11) * 2);
        const fixLatency = Math.round(420 * deviceFactor * pressure + (i % 13) * 3);

        this.recordLatency('bug_capture', captureLatency, true);
        this.recordLatency('pattern_detection', patternLatency, true);
        this.recordLatency('fix_application', fixLatency, true);
        successfulOps++;
        totalEventsProcessed++;

        const heap = Math.min(245, 80 + ratePerSec * 0.25 + config.concurrency * 0.5 + (i % 5));
        const rss = Math.min(295, heap + 35);
        this.recordMemoryProfile({
          heapUsedMb: heap,
          heapTotalMb: 256,
          external: 10,
          rss,
          peakHeapMb: 250
        });
      }
      peakRate = Math.max(peakRate, ratePerSec);
    }

    const latencyStats = {
      bugCapture: this.calculatePercentiles('bug_capture'),
      patternDetection: this.calculatePercentiles('pattern_detection'),
      fixApplication: this.calculatePercentiles('fix_application'),
      rollback: this.calculatePercentiles('rollback')
    };
    const memoryStats = this.calculateMemoryStats();
    const performanceCeiling = this.identifyPerformanceCeiling(config, latencyStats);
    const syntheticSeconds = Math.max(0.001, config.durationSeconds * Math.max(1, config.eventRatesPerSecond.length));

    const result: LoadTestResult = {
      config,
      startTime: this.startTime,
      endTime: this.startTime + syntheticSeconds * 1000,
      totalEventsProcessed,
      peakEventRate: peakRate,
      avgEventRate: totalEventsProcessed / syntheticSeconds,
      latencyStats,
      memoryStats,
      failureRate: failedOps / Math.max(1, successfulOps + failedOps),
      successfulOperations: successfulOps,
      failedOperations: failedOps,
      performanceCeiling
    };

    this.saveLoadTestResult(result);
    return result;
  }

  private identifyPerformanceCeiling(config: LoadTestConfig, latencyStats: any): LoadTestResult['performanceCeiling'] {
    let maxEventsPerSec = config.eventRatesPerSecond[config.eventRatesPerSecond.length - 1] || 1;
    if (latencyStats.bugCapture.p99 > 150) {
      maxEventsPerSec = Math.min(maxEventsPerSec, Math.max(1, Math.floor(maxEventsPerSec * 0.7)));
    }
    if (latencyStats.patternDetection.p99 > 600) {
      maxEventsPerSec = Math.min(maxEventsPerSec, Math.max(1, Math.floor(maxEventsPerSec * 0.8)));
    }

    const baseline = PERFORMANCE_BASELINES.find(b => b.deviceType === config.targetDeviceType);
    return {
      maxEventsPerSec,
      maxConcurrentOps: config.concurrency,
      maxMemoryMb: baseline ? baseline.memoryMb.peak : 300
    };
  }

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

  private saveLoadTestResult(result: LoadTestResult): void {
    const resultPath = path.join(this.storagePath, `load-test-${Date.now()}.json`);
    fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
    console.log(`[PerformanceBenchmarking] Synthetic hosted results saved to ${resultPath}`);
  }

  compareToBaseline(deviceType: 'ARM32' | 'ARM64'): {
    passedChecks: string[];
    failedChecks: string[];
    compliancePercentage: number;
  } {
    const baseline = PERFORMANCE_BASELINES.find(b => b.deviceType === deviceType);
    if (!baseline) return { passedChecks: [], failedChecks: [], compliancePercentage: 0 };

    const bugCapturePercentiles = this.calculatePercentiles('bug_capture');
    const patternDetectionPercentiles = this.calculatePercentiles('pattern_detection');
    const fixApplicationPercentiles = this.calculatePercentiles('fix_application');
    const rollbackPercentiles = this.calculatePercentiles('rollback');
    const checks = [
      { name: 'Bug Capture p50', passed: bugCapturePercentiles.p50 <= baseline.bugCaptureLat.p50 * 1.1 },
      { name: 'Bug Capture p95', passed: bugCapturePercentiles.p95 <= baseline.bugCaptureLat.p95 * 1.1 },
      { name: 'Pattern Detection p50', passed: patternDetectionPercentiles.p50 <= baseline.patternDetectionLat.p50 * 1.1 },
      { name: 'Fix Application p95', passed: fixApplicationPercentiles.p95 <= baseline.fixApplicationLat.p95 * 1.1 },
      { name: 'Rollback p95', passed: rollbackPercentiles.p95 <= baseline.rollbackLat.p95 * 1.1 }
    ];

    const passedCount = checks.filter(c => c.passed).length;
    return {
      passedChecks: checks.filter(c => c.passed).map(c => c.name),
      failedChecks: checks.filter(c => !c.passed).map(c => c.name),
      compliancePercentage: (passedCount / checks.length) * 100
    };
  }

  generateReport(): string {
    const bugCapture = this.calculatePercentiles('bug_capture');
    const patternDetection = this.calculatePercentiles('pattern_detection');
    const fixApplication = this.calculatePercentiles('fix_application');
    const rollback = this.calculatePercentiles('rollback');
    const memStats = this.calculateMemoryStats();

    return [
      '\n=== Performance Benchmarking Report ===',
      'Evidence Surface: HOSTED_DETERMINISTIC_SYNTHETIC (not physical ARM/Android evidence)',
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
    ].join('\n');
  }
}

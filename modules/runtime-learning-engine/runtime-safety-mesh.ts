import * as fs from 'fs';
import * as path from 'path';
import { AlertCondition, AlertRulesEngine } from './alert-rules-3-2';
import { CorruptionDetection, CorruptionRecoveryHandler } from './corruption-recovery';
import { DiskExhaustionHandler } from './disk-exhaustion-handler';
import { MemoryPressureHandler, MemoryPressureMetrics } from './memory-pressure-handler';

export type IntegrationEvidenceState =
  | 'OPERATIONAL'
  | 'DEGRADED'
  | 'FAILED'
  | 'TOKEN_VAZIO'
  | 'TEST_HARNESS_ONLY';

export interface DiskObservation {
  evidence: IntegrationEvidenceState;
  free_mb: number | null;
  total_mb: number | null;
  pressure_level: 'healthy' | 'warning' | 'critical' | 'unknown';
}

export interface CorruptionObservation {
  evidence: IntegrationEvidenceState;
  checked_files: number;
  corrupt_files: number;
  findings: CorruptionDetection[];
}

export interface RuntimeIntegrationComponent {
  component: string;
  role: string;
  evidence: IntegrationEvidenceState;
  note: string;
}

export interface RuntimeSafetySnapshot {
  timestamp: number;
  engine_running: boolean;
  watchdog_state: string;
  memory: MemoryPressureMetrics;
  disk: DiskObservation;
  corruption: CorruptionObservation;
  components: RuntimeIntegrationComponent[];
  device_runtime_verified: false;
  physical_device_smoke: 'TOKEN_VAZIO';
  claim_allowed: false;
}

/**
 * RuntimeSafetyMesh is the convergence layer between the core engine and the
 * Phase 3.2/3.3 safety modules. It only promotes components to OPERATIONAL when
 * they observe real process/filesystem state. Simulation-oriented handlers stay
 * explicitly classified as TEST_HARNESS_ONLY.
 */
export class RuntimeSafetyMesh {
  private alertRules = new AlertRulesEngine();
  private memoryPressure = new MemoryPressureHandler();
  private diskPressure: DiskExhaustionHandler;
  private corruptionRecovery = new CorruptionRecoveryHandler();

  constructor(private storagePath: string = '/data/local/tmp/frida-learning') {
    this.diskPressure = new DiskExhaustionHandler(storagePath);
  }

  observeMemory(): MemoryPressureMetrics {
    try {
      const usage = process.memoryUsage();
      return this.memoryPressure.getMemoryMetrics(
        usage.heapUsed / 1024 / 1024,
        usage.heapTotal / 1024 / 1024
      );
    } catch (e) {
      console.error('[RuntimeSafetyMesh] Memory observation failed:', e);
      return this.memoryPressure.getMemoryMetrics(0, 0);
    }
  }

  observeDisk(): DiskObservation {
    try {
      const statfsSync = (fs as any).statfsSync as ((target: string) => any) | undefined;
      if (typeof statfsSync !== 'function') {
        return {
          evidence: 'TOKEN_VAZIO',
          free_mb: null,
          total_mb: null,
          pressure_level: 'unknown'
        };
      }

      const target = this.resolveObservablePath();
      if (!target) {
        return {
          evidence: 'TOKEN_VAZIO',
          free_mb: null,
          total_mb: null,
          pressure_level: 'unknown'
        };
      }

      const stats = statfsSync(target);
      const blockSize = Number(stats.bsize || stats.frsize || 0);
      const availableBlocks = Number(stats.bavail ?? stats.bfree ?? 0);
      const totalBlocks = Number(stats.blocks || 0);

      if (!Number.isFinite(blockSize) || blockSize <= 0 || !Number.isFinite(availableBlocks)) {
        return {
          evidence: 'TOKEN_VAZIO',
          free_mb: null,
          total_mb: null,
          pressure_level: 'unknown'
        };
      }

      const freeMb = (availableBlocks * blockSize) / 1024 / 1024;
      const totalMb = totalBlocks > 0 ? (totalBlocks * blockSize) / 1024 / 1024 : null;
      const pressure = this.diskPressure.getDiskMetrics(freeMb).pressure_level;

      return {
        evidence: pressure === 'critical' ? 'FAILED' : pressure === 'warning' ? 'DEGRADED' : 'OPERATIONAL',
        free_mb: Math.round(freeMb * 100) / 100,
        total_mb: totalMb === null ? null : Math.round(totalMb * 100) / 100,
        pressure_level: pressure
      };
    } catch (e) {
      console.error('[RuntimeSafetyMesh] Disk observation failed:', e);
      return {
        evidence: 'TOKEN_VAZIO',
        free_mb: null,
        total_mb: null,
        pressure_level: 'unknown'
      };
    }
  }

  inspectCriticalFiles(): CorruptionObservation {
    const candidates = [
      'bug-history.json',
      'rollback-journal.json',
      'watchdog-events.json',
      'provenance.json',
      'receipts.json',
      'metrics.json'
    ];

    const findings: CorruptionDetection[] = [];
    let checkedFiles = 0;

    for (const fileName of candidates) {
      const filePath = path.join(this.storagePath, fileName);
      if (!fs.existsSync(filePath)) continue;

      checkedFiles++;
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const finding = this.corruptionRecovery.detectInvalidJSON(content);
        if (finding.detected) {
          findings.push({ ...finding, file_name: fileName });
        }
      } catch (e) {
        findings.push({
          file_name: fileName,
          corruption_type: 'invalid_json',
          severity: 'critical',
          detected: true,
          error_message: `Read failure: ${e}`,
          recovery_possible: false
        });
      }
    }

    if (checkedFiles === 0) {
      return {
        evidence: 'TOKEN_VAZIO',
        checked_files: 0,
        corrupt_files: 0,
        findings: []
      };
    }

    return {
      evidence: findings.length > 0 ? 'FAILED' : 'OPERATIONAL',
      checked_files: checkedFiles,
      corrupt_files: findings.length,
      findings
    };
  }

  evaluateAlertMetric(metric: string, value: number): AlertCondition[] {
    if (!Number.isFinite(value)) return [];
    return this.alertRules.evaluateMetric(metric, value);
  }

  evaluateOperationalMetrics(metrics: Record<string, number | undefined | null>): AlertCondition[] {
    const triggered: AlertCondition[] = [];
    for (const [metric, value] of Object.entries(metrics)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      triggered.push(...this.alertRules.evaluateMetric(metric, value));
    }
    return triggered;
  }

  getAlertRulesEngine(): AlertRulesEngine {
    return this.alertRules;
  }

  getIntegrationRegistry(): RuntimeIntegrationComponent[] {
    return [
      {
        component: 'RuntimeLearningEngine',
        role: 'orchestrator',
        evidence: 'OPERATIONAL',
        note: 'core lifecycle owner'
      },
      {
        component: 'HealthCheckEndpoint',
        role: 'engine-bound health observer',
        evidence: 'OPERATIONAL',
        note: 'primary health surface; file-only health-check.ts remains compatibility surface'
      },
      {
        component: 'AlertManager',
        role: 'alert persistence and notification queue',
        evidence: 'OPERATIONAL',
        note: 'receives normalized runtime metrics'
      },
      {
        component: 'AlertRulesEngine',
        role: 'SLA threshold source',
        evidence: 'OPERATIONAL',
        note: 'single threshold evaluator for Phase 3.2 rules'
      },
      {
        component: 'MemoryPressureHandler',
        role: 'real process memory observer',
        evidence: 'OPERATIONAL',
        note: 'driven by process.memoryUsage()'
      },
      {
        component: 'DiskExhaustionHandler',
        role: 'filesystem pressure classifier',
        evidence: typeof (fs as any).statfsSync === 'function' ? 'OPERATIONAL' : 'TOKEN_VAZIO',
        note: 'classification is driven by observed statfs free bytes when available'
      },
      {
        component: 'CorruptionRecoveryHandler',
        role: 'read-only corruption detector',
        evidence: 'OPERATIONAL',
        note: 'automatic destructive recovery is deliberately disabled'
      },
      {
        component: 'ConcurrentBugCaptureHandler',
        role: 'concurrency test harness',
        evidence: 'TEST_HARNESS_ONLY',
        note: 'contains simulated lock/delay logic and is not promoted to the live hot path'
      },
      {
        component: 'AndroidPhysicalRuntime',
        role: 'device execution evidence',
        evidence: 'TOKEN_VAZIO',
        note: 'requires a physical-device receipt; CI is not physical proof'
      }
    ];
  }

  snapshot(engineRunning: boolean, watchdogState: string): RuntimeSafetySnapshot {
    return {
      timestamp: Date.now(),
      engine_running: engineRunning,
      watchdog_state: watchdogState,
      memory: this.observeMemory(),
      disk: this.observeDisk(),
      corruption: this.inspectCriticalFiles(),
      components: this.getIntegrationRegistry(),
      device_runtime_verified: false,
      physical_device_smoke: 'TOKEN_VAZIO',
      claim_allowed: false
    };
  }

  private resolveObservablePath(): string | null {
    let current = this.storagePath;
    for (let i = 0; i < 8; i++) {
      if (fs.existsSync(current)) return current;
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return fs.existsSync(process.cwd()) ? process.cwd() : null;
  }
}

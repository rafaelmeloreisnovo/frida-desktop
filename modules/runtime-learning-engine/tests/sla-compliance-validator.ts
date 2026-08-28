import * as fs from 'fs';
import * as path from 'path';

/**
 * SLA Compliance Validator
 *
 * Validates that measured SLAs from device match expected thresholds.
 * Compares actual performance against defined SLA baselines.
 */

export interface SLADefinition {
  id: string;
  name: string;
  description: string;
  threshold: number; // milliseconds or percentage
  metric: string;
  severity: 'critical' | 'warning';
  expectedUnits: string;
}

export interface SLAMeasurement {
  slaId: string;
  measured: number;
  expected: number;
  threshold: number;
  unit: string;
  passed: boolean;
  margin: number; // how much over/under
  percentile?: string; // p50, p95, p99
}

export interface SLAComplianceReport {
  timestamp: number;
  reportId: string;
  totalSLAs: number;
  passedSLAs: number;
  failedSLAs: number;
  compliancePercentage: number;
  measurements: SLAMeasurement[];
  summary: {
    critical: { passed: number; failed: number };
    warning: { passed: number; failed: number };
  };
}

export const DEFAULT_SLAS: SLADefinition[] = [
  {
    id: 'bug_capture_latency',
    name: 'Bug Capture Latency SLA',
    description: 'Bug must be captured in < 100ms',
    threshold: 100,
    metric: 'bug_capture_latency_ms',
    severity: 'critical',
    expectedUnits: 'milliseconds'
  },
  {
    id: 'pattern_detection_latency',
    name: 'Pattern Detection Latency SLA',
    description: 'Pattern must be detected in < 500ms',
    threshold: 500,
    metric: 'pattern_detection_latency_ms',
    severity: 'warning',
    expectedUnits: 'milliseconds'
  },
  {
    id: 'fix_application_latency',
    name: 'Fix Application Latency SLA',
    description: 'Fix must be applied in < 1000ms',
    threshold: 1000,
    metric: 'fix_application_latency_ms',
    severity: 'warning',
    expectedUnits: 'milliseconds'
  },
  {
    id: 'rollback_latency',
    name: 'Rollback Completion Latency SLA',
    description: 'Rollback must complete in < 500ms',
    threshold: 500,
    metric: 'rollback_latency_ms',
    severity: 'critical',
    expectedUnits: 'milliseconds'
  },
  {
    id: 'fix_success_rate',
    name: 'Fix Success Rate SLA',
    description: 'At least 80% of fixes must succeed',
    threshold: 80,
    metric: 'fix_success_rate',
    severity: 'critical',
    expectedUnits: 'percentage'
  },
  {
    id: 'rollback_success_rate',
    name: 'Rollback Success Rate SLA',
    description: 'At least 95% of rollbacks must succeed',
    threshold: 95,
    metric: 'rollback_success_rate',
    severity: 'critical',
    expectedUnits: 'percentage'
  },
  {
    id: 'audit_completeness',
    name: 'Audit Trail Completeness SLA',
    description: 'At least 99% of actions must be logged',
    threshold: 99,
    metric: 'audit_completeness',
    severity: 'warning',
    expectedUnits: 'percentage'
  },
  {
    id: 'memory_usage',
    name: 'Memory Usage SLA',
    description: 'Memory usage must be < 500MB',
    threshold: 500,
    metric: 'memory_usage_mb',
    severity: 'warning',
    expectedUnits: 'megabytes'
  },
  {
    id: 'data_integrity',
    name: 'Data Integrity SLA',
    description: 'Zero data corruption detected',
    threshold: 0,
    metric: 'corruption_count',
    severity: 'critical',
    expectedUnits: 'count'
  }
];

export class SLAComplianceValidator {
  private slas: SLADefinition[];
  private measurements: Map<string, SLAMeasurement> = new Map();

  constructor(customSLAs?: SLADefinition[]) {
    this.slas = customSLAs || DEFAULT_SLAS;
  }

  /**
   * Validate a single metric against SLA threshold
   */
  validateMetric(slaId: string, measured: number): SLAMeasurement | null {
    const sla = this.slas.find(s => s.id === slaId);
    if (!sla) return null;

    let passed = false;
    let margin = 0;

    // Different comparison logic based on metric type
    if (sla.metric.includes('rate') || sla.metric.includes('completeness')) {
      // For percentages: measured should be >= threshold
      passed = measured >= sla.threshold;
      margin = measured - sla.threshold;
    } else if (sla.metric === 'corruption_count') {
      // For counts: measured should be 0
      passed = measured === 0;
      margin = measured;
    } else {
      // For latencies: measured should be <= threshold
      passed = measured <= sla.threshold;
      margin = sla.threshold - measured;
    }

    const measurement: SLAMeasurement = {
      slaId,
      measured,
      expected: sla.threshold,
      threshold: sla.threshold,
      unit: sla.expectedUnits,
      passed,
      margin
    };

    this.measurements.set(slaId, measurement);
    return measurement;
  }

  /**
   * Validate metrics from device health check JSON
   */
  validateFromHealthCheck(healthCheckPath: string): SLAComplianceReport {
    const measurements: SLAMeasurement[] = [];

    try {
      if (!fs.existsSync(healthCheckPath)) {
        throw new Error(`Health check file not found at ${healthCheckPath}`);
      }

      const healthData = JSON.parse(fs.readFileSync(healthCheckPath, 'utf-8'));

      // Map health check fields to SLA metrics
      const metricMap: Record<string, string> = {
        bug_capture_latency: 'bug_capture_latency_ms',
        pattern_detection_latency: 'pattern_detection_latency_ms',
        fix_application_latency: 'fix_application_latency_ms',
        rollback_latency: 'rollback_latency_ms',
        success_rate: 'fix_success_rate',
        rollback_success_rate: 'rollback_success_rate',
        memory_usage_mb: 'memory_usage_mb'
      };

      for (const sla of this.slas) {
        let measured: number | undefined;

        // Find corresponding metric in health check
        for (const [key, value] of Object.entries(metricMap)) {
          if (value === sla.metric) {
            measured = (healthData as any)[key];
            break;
          }
        }

        if (measured !== undefined) {
          const measurement = this.validateMetric(sla.id, measured);
          if (measurement) {
            measurements.push(measurement);
          }
        }
      }

    } catch (e: any) {
      console.error('[SLAComplianceValidator] Error reading health check:', e.message);
    }

    return this.generateReport(measurements);
  }

  /**
   * Validate metrics from device metrics JSON
   */
  validateFromMetrics(metricsPath: string): SLAComplianceReport {
    const measurements: SLAMeasurement[] = [];

    try {
      if (!fs.existsSync(metricsPath)) {
        throw new Error(`Metrics file not found at ${metricsPath}`);
      }

      const metricsData = JSON.parse(fs.readFileSync(metricsPath, 'utf-8'));

      for (const sla of this.slas) {
        const measured = metricsData[sla.metric];

        if (measured !== undefined) {
          const measurement = this.validateMetric(sla.id, measured);
          if (measurement) {
            measurements.push(measurement);
          }
        }
      }

    } catch (e: any) {
      console.error('[SLAComplianceValidator] Error reading metrics:', e.message);
    }

    return this.generateReport(measurements);
  }

  /**
   * Validate integrity checks
   */
  validateIntegrityChecks(integrityPath: string): { passed: boolean; errors: string[] } {
    const errors: string[] = [];

    try {
      if (!fs.existsSync(integrityPath)) {
        // If no integrity file, we can't validate corruption count
        return { passed: true, errors: [] };
      }

      const integrityData = JSON.parse(fs.readFileSync(integrityPath, 'utf-8'));

      // Check for any detected corruptions
      if (integrityData.corruption_detected) {
        errors.push(`Data corruption detected: ${integrityData.corruption_detected}`);
        this.validateMetric('data_integrity', 1);
      } else {
        this.validateMetric('data_integrity', 0);
      }

      // Check for failed integrity checks
      if (Array.isArray(integrityData.failed_checks)) {
        for (const check of integrityData.failed_checks) {
          errors.push(`Integrity check failed: ${check.file} (${check.reason})`);
        }
      }

    } catch (e: any) {
      console.error('[SLAComplianceValidator] Error validating integrity:', e.message);
    }

    return {
      passed: errors.length === 0,
      errors
    };
  }

  /**
   * Generate compliance report from measurements
   */
  private generateReport(measurements: SLAMeasurement[]): SLAComplianceReport {
    const passedSLAs = measurements.filter(m => m.passed).length;
    const failedSLAs = measurements.filter(m => !m.passed).length;

    const summary = {
      critical: {
        passed: measurements.filter(m => m.passed && this.slas.find(s => s.id === m.slaId)?.severity === 'critical').length,
        failed: measurements.filter(m => !m.passed && this.slas.find(s => s.id === m.slaId)?.severity === 'critical').length
      },
      warning: {
        passed: measurements.filter(m => m.passed && this.slas.find(s => s.id === m.slaId)?.severity === 'warning').length,
        failed: measurements.filter(m => !m.passed && this.slas.find(s => s.id === m.slaId)?.severity === 'warning').length
      }
    };

    return {
      timestamp: Date.now(),
      reportId: `sla-report-${Date.now()}`,
      totalSLAs: measurements.length,
      passedSLAs,
      failedSLAs,
      compliancePercentage: measurements.length > 0 ? (passedSLAs / measurements.length) * 100 : 0,
      measurements,
      summary
    };
  }

  /**
   * Format report as human-readable summary
   */
  formatReport(report: SLAComplianceReport): string {
    const lines = [
      '\n=== SLA Compliance Report ===',
      `Report ID: ${report.reportId}`,
      `Timestamp: ${new Date(report.timestamp).toISOString()}`,
      '',
      '--- Overall Compliance ---',
      `Total SLAs Validated: ${report.totalSLAs}`,
      `Passed: ${report.passedSLAs} ✅`,
      `Failed: ${report.failedSLAs} ❌`,
      `Compliance Rate: ${report.compliancePercentage.toFixed(1)}%`,
      '',
      '--- By Severity ---',
      `CRITICAL - Passed: ${report.summary.critical.passed}, Failed: ${report.summary.critical.failed}`,
      `WARNING - Passed: ${report.summary.warning.passed}, Failed: ${report.summary.warning.failed}`,
      '',
      '--- Individual SLA Results ---'
    ];

    for (const m of report.measurements) {
      const sla = this.slas.find(s => s.id === m.slaId);
      const status = m.passed ? '✅' : '❌';
      const detail = `${status} ${sla?.name}: ${m.measured.toFixed(2)} ${m.unit} (threshold: ${m.expected})`;
      lines.push(detail);

      if (!m.passed) {
        const overBy = Math.abs(m.margin);
        lines.push(`   ⚠️  Over threshold by ${overBy.toFixed(2)} ${m.unit}`);
      }
    }

    lines.push('');

    return lines.join('\n');
  }

  /**
   * Save report to file
   */
  saveReport(report: SLAComplianceReport, outputPath: string): void {
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    console.log(`[SLAComplianceValidator] Report saved to ${outputPath}`);
  }

  /**
   * Check if compliance is acceptable (all critical SLAs passed)
   */
  isCompliantWithCriticals(report: SLAComplianceReport): boolean {
    return report.summary.critical.failed === 0;
  }

  /**
   * Get detailed breakdown of failures
   */
  getFailureBreakdown(report: SLAComplianceReport): Record<string, string[]> {
    const breakdown: Record<string, string[]> = {
      critical: [],
      warning: []
    };

    for (const m of report.measurements) {
      if (!m.passed) {
        const sla = this.slas.find(s => s.id === m.slaId);
        const severity = sla?.severity || 'unknown';
        const message = `${sla?.name}: ${m.measured} ${m.unit} > ${m.threshold} ${m.unit}`;
        breakdown[severity].push(message);
      }
    }

    return breakdown;
  }
}

/**
 * Usage example:
 *
 * const validator = new SLAComplianceValidator();
 *
 * // Validate from health check
 * const report1 = validator.validateFromHealthCheck('/data/local/tmp/frida-learning/health-check.json');
 * console.log(validator.formatReport(report1));
 * validator.saveReport(report1, '/tmp/sla-compliance-report.json');
 *
 * // Validate from metrics
 * const report2 = validator.validateFromMetrics('/data/local/tmp/frida-learning/metrics.json');
 *
 * // Validate integrity
 * const integrity = validator.validateIntegrityChecks('/data/local/tmp/frida-learning/integrity-checks.json');
 *
 * // Check compliance
 * if (validator.isCompliantWithCriticals(report1)) {
 *   console.log('✅ All critical SLAs passed!');
 * } else {
 *   console.log('❌ Critical SLA violations detected');
 *   const failures = validator.getFailureBreakdown(report1);
 *   console.log('Critical failures:', failures.critical);
 * }
 */

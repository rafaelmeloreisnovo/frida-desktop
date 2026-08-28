import * as fs from 'fs';
import * as path from 'path';

export interface SLADefinition {
  name: string;
  target: string;
  metric: string;
  threshold_ms?: number;
  threshold_percent?: number;
  critical: boolean;
}

export interface SLAViolation {
  sla_name: string;
  timestamp: number;
  expected: string;
  actual: string;
  severity: 'warning' | 'critical';
}

export interface ComplianceReport {
  timestamp: number;
  total_checks: number;
  passed: number;
  failed: number;
  critical_violations: number;
  warnings: number;
  violations: SLAViolation[];
  compliance_percentage: number;
}

export class ContractVerifier {
  private storagePath: string;
  private reportPath: string;
  private slas: Map<string, SLADefinition> = new Map();
  private violations: SLAViolation[] = [];

  constructor(storagePath: string = '/data/local/tmp/frida-learning') {
    this.storagePath = storagePath;
    this.reportPath = path.join(storagePath, 'sla-compliance.json');
    this.ensureDirectory();
    this.initializeSLAs();
  }

  private ensureDirectory(): void {
    if (!fs.existsSync(this.storagePath)) {
      fs.mkdirSync(this.storagePath, { recursive: true });
    }
  }

  private initializeSLAs(): void {
    const slas: SLADefinition[] = [
      {
        name: 'bug-capture-latency',
        target: '< 100ms from exception to BugEvent',
        metric: 'Time from hook fire to event instantiation',
        threshold_ms: 100,
        critical: true
      },
      {
        name: 'pattern-detection-latency',
        target: '< 500ms to detect pattern',
        metric: 'Time from bug append to pattern detection',
        threshold_ms: 500,
        critical: true
      },
      {
        name: 'fix-application-latency',
        target: '< 1000ms to apply fix',
        metric: 'Time from AutoFixer.applyFix() to completion',
        threshold_ms: 1000,
        critical: true
      },
      {
        name: 'rollback-completion',
        target: '< 500ms to complete rollback',
        metric: 'Time from rollback trigger to state change',
        threshold_ms: 500,
        critical: true
      },
      {
        name: 'overall-success-rate',
        target: '> 80% success without regression',
        metric: 'successful_fixes / total_fixes * 100',
        threshold_percent: 80,
        critical: true
      },
      {
        name: 'data-integrity',
        target: 'Zero corruption, 100% checksum match',
        metric: 'Valid checksums across all files',
        threshold_percent: 100,
        critical: true
      },
      {
        name: 'audit-completeness',
        target: '100% of actions logged',
        metric: 'Audit log entries / total actions',
        threshold_percent: 100,
        critical: true
      },
      {
        name: 'fix-regression-rate',
        target: '< 10% regression rate',
        metric: 'fixes_with_regression / total_fixes * 100',
        threshold_percent: 10,
        critical: false
      },
      {
        name: 'rollback-success-rate',
        target: '> 95% rollback success',
        metric: 'successful_rollbacks / total_rollbacks * 100',
        threshold_percent: 95,
        critical: true
      }
    ];

    for (const sla of slas) {
      this.slas.set(sla.name, sla);
    }
  }

  async verifyCompliance(metrics: {
    bug_capture_latency?: number;
    pattern_detection_latency?: number;
    fix_application_latency?: number;
    rollback_latency?: number;
    success_rate?: number;
    regression_rate?: number;
    data_integrity_valid?: boolean;
    audit_completeness?: number;
    rollback_success_rate?: number;
  }): Promise<ComplianceReport> {
    const violations: SLAViolation[] = [];
    let passed = 0;
    let failed = 0;
    let criticalViolations = 0;

    if (metrics.bug_capture_latency !== undefined) {
      if (metrics.bug_capture_latency > 100) {
        violations.push({
          sla_name: 'bug-capture-latency',
          timestamp: Date.now(),
          expected: '< 100ms',
          actual: `${metrics.bug_capture_latency}ms`,
          severity: 'critical'
        });
        failed++;
        criticalViolations++;
      } else {
        passed++;
      }
    }

    if (metrics.pattern_detection_latency !== undefined) {
      if (metrics.pattern_detection_latency > 500) {
        violations.push({
          sla_name: 'pattern-detection-latency',
          timestamp: Date.now(),
          expected: '< 500ms',
          actual: `${metrics.pattern_detection_latency}ms`,
          severity: 'critical'
        });
        failed++;
        criticalViolations++;
      } else {
        passed++;
      }
    }

    if (metrics.fix_application_latency !== undefined) {
      if (metrics.fix_application_latency > 1000) {
        violations.push({
          sla_name: 'fix-application-latency',
          timestamp: Date.now(),
          expected: '< 1000ms',
          actual: `${metrics.fix_application_latency}ms`,
          severity: 'critical'
        });
        failed++;
        criticalViolations++;
      } else {
        passed++;
      }
    }

    if (metrics.rollback_latency !== undefined) {
      if (metrics.rollback_latency > 500) {
        violations.push({
          sla_name: 'rollback-completion',
          timestamp: Date.now(),
          expected: '< 500ms',
          actual: `${metrics.rollback_latency}ms`,
          severity: 'critical'
        });
        failed++;
        criticalViolations++;
      } else {
        passed++;
      }
    }

    if (metrics.success_rate !== undefined) {
      if (metrics.success_rate < 80) {
        violations.push({
          sla_name: 'overall-success-rate',
          timestamp: Date.now(),
          expected: '> 80%',
          actual: `${metrics.success_rate.toFixed(2)}%`,
          severity: 'critical'
        });
        failed++;
        criticalViolations++;
      } else {
        passed++;
      }
    }

    if (metrics.data_integrity_valid !== undefined) {
      if (!metrics.data_integrity_valid) {
        violations.push({
          sla_name: 'data-integrity',
          timestamp: Date.now(),
          expected: '100% valid checksums',
          actual: 'Checksum mismatch detected',
          severity: 'critical'
        });
        failed++;
        criticalViolations++;
      } else {
        passed++;
      }
    }

    if (metrics.audit_completeness !== undefined) {
      if (metrics.audit_completeness < 99) {
        violations.push({
          sla_name: 'audit-completeness',
          timestamp: Date.now(),
          expected: '> 99%',
          actual: `${metrics.audit_completeness.toFixed(2)}%`,
          severity: 'warning'
        });
        failed++;
      } else {
        passed++;
      }
    }

    if (metrics.regression_rate !== undefined) {
      if (metrics.regression_rate > 10) {
        violations.push({
          sla_name: 'fix-regression-rate',
          timestamp: Date.now(),
          expected: '< 10%',
          actual: `${metrics.regression_rate.toFixed(2)}%`,
          severity: 'warning'
        });
        failed++;
      } else {
        passed++;
      }
    }

    if (metrics.rollback_success_rate !== undefined) {
      if (metrics.rollback_success_rate < 95) {
        violations.push({
          sla_name: 'rollback-success-rate',
          timestamp: Date.now(),
          expected: '> 95%',
          actual: `${metrics.rollback_success_rate.toFixed(2)}%`,
          severity: 'critical'
        });
        failed++;
        criticalViolations++;
      } else {
        passed++;
      }
    }

    const total = passed + failed;
    const compliancePercentage = total > 0 ? (passed / total) * 100 : 0;

    const report: ComplianceReport = {
      timestamp: Date.now(),
      total_checks: total,
      passed,
      failed,
      critical_violations: criticalViolations,
      warnings: violations.filter(v => v.severity === 'warning').length,
      violations,
      compliance_percentage: compliancePercentage
    };

    this.violations.push(...violations);
    await this.saveReport(report);
    this.logReport(report);

    return report;
  }

  private async saveReport(report: ComplianceReport): Promise<void> {
    try {
      const existingData: { reports: ComplianceReport[] } = { reports: [] };

      if (fs.existsSync(this.reportPath)) {
        try {
          const data = fs.readFileSync(this.reportPath, 'utf-8');
          const parsed = JSON.parse(data);
          existingData.reports = parsed.reports || [];
        } catch {
          console.warn('[ContractVerifier] Failed to read existing report');
        }
      }

      existingData.reports.push(report);
      const trimmed = existingData.reports.slice(-100);

      fs.writeFileSync(
        this.reportPath,
        JSON.stringify({ reports: trimmed }, null, 2),
        'utf-8'
      );
    } catch (e) {
      console.error('[ContractVerifier] Failed to save compliance report:', e);
    }
  }

  private logReport(report: ComplianceReport): void {
    console.log('[ContractVerifier] Compliance Report:');
    console.log(`  Passed: ${report.passed}/${report.total_checks}`);
    console.log(`  Failed: ${report.failed}/${report.total_checks}`);
    console.log(`  Compliance: ${report.compliance_percentage.toFixed(2)}%`);

    if (report.critical_violations > 0) {
      console.error(`  ⚠️ CRITICAL VIOLATIONS: ${report.critical_violations}`);
    }

    if (report.warnings > 0) {
      console.warn(`  ⚠️ Warnings: ${report.warnings}`);
    }

    for (const violation of report.violations) {
      const level = violation.severity === 'critical' ? '❌' : '⚠️';
      console.log(`  ${level} ${violation.sla_name}: expected ${violation.expected}, got ${violation.actual}`);
    }
  }

  getSLADefinition(slaName: string): SLADefinition | undefined {
    return this.slas.get(slaName);
  }

  getAllSLADefinitions(): SLADefinition[] {
    return Array.from(this.slas.values());
  }

  async isCompliant(): Promise<boolean> {
    const data = this.getAllViolations();
    const recentViolations = data.filter(
      v => Date.now() - v.timestamp < 60000
    );

    const criticalViolations = recentViolations.filter(v => v.severity === 'critical');
    return criticalViolations.length === 0;
  }

  getAllViolations(minSeverity: 'warning' | 'critical' = 'warning'): SLAViolation[] {
    if (minSeverity === 'critical') {
      return this.violations.filter(v => v.severity === 'critical');
    }
    return this.violations;
  }

  getViolationsByType(slaName: string): SLAViolation[] {
    return this.violations.filter(v => v.sla_name === slaName);
  }

  getComplianceTrend(windowMinutes: number = 60): {
    average_compliance: number;
    trend: 'improving' | 'stable' | 'degrading';
  } {
    const cutoff = Date.now() - windowMinutes * 60 * 1000;
    const recentViolations = this.violations.filter(v => v.timestamp > cutoff);

    if (recentViolations.length === 0) {
      return { average_compliance: 100, trend: 'stable' };
    }

    const compliance = 100 - ((recentViolations.length / 9) * 100);

    return {
      average_compliance: Math.max(0, compliance),
      trend: 'stable'
    };
  }
}

export function createContractVerifier(storagePath?: string): ContractVerifier {
  return new ContractVerifier(storagePath);
}

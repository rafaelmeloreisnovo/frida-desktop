import * as fs from 'fs';
import * as path from 'path';
import { generateHash } from './utils';

export interface IntegrityCheck {
  timestamp: number;
  file: string;
  hash: string;
  size: number;
  status: 'valid' | 'invalid' | 'missing';
  error?: string;
}

export interface IntegrityReport {
  timestamp: number;
  total_checks: number;
  valid: number;
  invalid: number;
  missing: number;
  checks: IntegrityCheck[];
}

export class IntegrityVerifier {
  private storagePath: string;
  private reportPath: string;
  private filesToMonitor: string[] = [
    'bug-history.json',
    'rollback-journal.json',
    'watchdog-events.json',
    'audit.log',
    'provenance.json',
    'receipts.json'
  ];

  constructor(storagePath: string = '/data/local/tmp/frida-learning') {
    this.storagePath = storagePath;
    this.reportPath = path.join(storagePath, 'integrity-checks.json');
    this.ensureDirectory();
  }

  private ensureDirectory(): void {
    if (!fs.existsSync(this.storagePath)) {
      fs.mkdirSync(this.storagePath, { recursive: true });
    }
  }

  async verifyIntegrity(): Promise<IntegrityReport> {
    const checks: IntegrityCheck[] = [];
    const now = Date.now();

    for (const filename of this.filesToMonitor) {
      const filepath = path.join(this.storagePath, filename);
      const check = await this.checkFile(filepath, filename);
      checks.push(check);
    }

    const report: IntegrityReport = {
      timestamp: now,
      total_checks: checks.length,
      valid: checks.filter(c => c.status === 'valid').length,
      invalid: checks.filter(c => c.status === 'invalid').length,
      missing: checks.filter(c => c.status === 'missing').length,
      checks
    };

    await this.saveReport(report);
    this.logReport(report);

    return report;
  }

  private async checkFile(filepath: string, filename: string): Promise<IntegrityCheck> {
    try {
      if (!fs.existsSync(filepath)) {
        return {
          timestamp: Date.now(),
          file: filename,
          hash: '',
          size: 0,
          status: 'missing'
        };
      }

      const data = fs.readFileSync(filepath, 'utf-8');
      const size = data.length;
      const hash = generateHash(data);

      const isValid = await this.validateFileFormat(filepath, data);

      return {
        timestamp: Date.now(),
        file: filename,
        hash,
        size,
        status: isValid ? 'valid' : 'invalid',
        error: isValid ? undefined : 'File format validation failed'
      };
    } catch (e) {
      return {
        timestamp: Date.now(),
        file: filename,
        hash: '',
        size: 0,
        status: 'invalid',
        error: String(e)
      };
    }
  }

  private async validateFileFormat(filepath: string, data: string): Promise<boolean> {
    try {
      const filename = path.basename(filepath);

      if (filename.endsWith('.log')) {
        for (const line of data.split('\n')) {
          if (line.trim().length > 0) {
            JSON.parse(line);
          }
        }
        return true;
      }

      JSON.parse(data);
      return true;
    } catch (e) {
      console.warn(`[IntegrityVerifier] Format validation failed for ${path.basename(filepath)}: ${e}`);
      return false;
    }
  }

  private async saveReport(report: IntegrityReport): Promise<void> {
    try {
      const existingReports: IntegrityReport[] = [];
      if (fs.existsSync(this.reportPath)) {
        try {
          const data = fs.readFileSync(this.reportPath, 'utf-8');
          const parsed = JSON.parse(data);
          existingReports.push(...(parsed.reports || []));
        } catch {
          console.warn('[IntegrityVerifier] Failed to read existing reports');
        }
      }

      existingReports.push(report);
      const trimmed = existingReports.slice(-100);

      fs.writeFileSync(
        this.reportPath,
        JSON.stringify({ reports: trimmed }, null, 2),
        'utf-8'
      );
    } catch (e) {
      console.error('[IntegrityVerifier] Failed to save integrity report:', e);
    }
  }

  private logReport(report: IntegrityReport): void {
    console.log(`[IntegrityVerifier] Integrity check completed:`);
    console.log(`  Total checks: ${report.total_checks}`);
    console.log(`  Valid: ${report.valid}`);
    console.log(`  Invalid: ${report.invalid}`);
    console.log(`  Missing: ${report.missing}`);

    for (const check of report.checks) {
      if (check.status !== 'valid') {
        console.warn(`  [${check.status.toUpperCase()}] ${check.file}${check.error ? ': ' + check.error : ''}`);
      }
    }
  }

  async getLatestReport(): Promise<IntegrityReport | null> {
    try {
      if (!fs.existsSync(this.reportPath)) {
        return null;
      }

      const data = fs.readFileSync(this.reportPath, 'utf-8');
      const parsed = JSON.parse(data);
      const reports = parsed.reports || [];

      return reports.length > 0 ? reports[reports.length - 1] : null;
    } catch (e) {
      console.error('[IntegrityVerifier] Failed to read latest report:', e);
      return null;
    }
  }

  async compareChecksums(
    filename: string,
    expectedHash: string
  ): Promise<{ match: boolean; actual: string; error?: string }> {
    try {
      const filepath = path.join(this.storagePath, filename);
      if (!fs.existsSync(filepath)) {
        return { match: false, actual: '', error: 'File not found' };
      }

      const data = fs.readFileSync(filepath, 'utf-8');
      const actual = generateHash(data);

      return {
        match: actual === expectedHash,
        actual
      };
    } catch (e) {
      return { match: false, actual: '', error: String(e) };
    }
  }

  async monitorContinuously(intervalMs: number = 60000): Promise<() => void> {
    let running = true;
    let lastReport: IntegrityReport | null = null;

    const monitor = async () => {
      if (!running) return;

      try {
        const report = await this.verifyIntegrity();

        if (lastReport) {
          const newInvalid = report.checks.filter((c, i) => {
            const wasValid = lastReport!.checks[i]?.status === 'valid';
            return c.status === 'invalid' && wasValid;
          });

          if (newInvalid.length > 0) {
            console.error('[IntegrityVerifier] Data corruption detected!');
            for (const check of newInvalid) {
              console.error(`  ${check.file}: ${check.error}`);
            }
          }
        }

        lastReport = report;
      } catch (e) {
        console.error('[IntegrityVerifier] Monitoring error:', e);
      }

      if (running) {
        setTimeout(monitor, intervalMs);
      }
    };

    monitor();

    return () => {
      running = false;
    };
  }
}

export function createIntegrityVerifier(storagePath?: string): IntegrityVerifier {
  return new IntegrityVerifier(storagePath);
}

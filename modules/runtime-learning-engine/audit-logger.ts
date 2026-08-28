import * as fs from 'fs';
import * as path from 'path';

export type AuditAction =
  | 'BUG_CAPTURED'
  | 'PATTERN_DETECTED'
  | 'FIX_ATTEMPTED'
  | 'FIX_APPLIED'
  | 'FIX_FAILED'
  | 'TEST_EXECUTED'
  | 'ROLLBACK_INITIATED'
  | 'ROLLBACK_VERIFIED'
  | 'STATE_CHANGED'
  | 'CONFIG_UPDATED';

export interface AuditEntry {
  timestamp: number;
  action: AuditAction;
  actor: string;
  resource_id: string;
  context: Record<string, any>;
  result: 'success' | 'failure';
  error?: string;
}

export interface AuditStats {
  totalEntries: number;
  byAction: Partial<Record<AuditAction, number>>;
  successRate: number;
}

export class AuditLogger {
  private auditPath: string;
  private maxFileSize = 5 * 1024 * 1024;

  constructor(storagePath: string = '/data/local/tmp/frida-learning') {
    this.auditPath = path.join(storagePath, 'audit.log');
    this.ensureDirectory();
  }

  private ensureDirectory(): void {
    const dir = path.dirname(this.auditPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  async log(
    action: AuditAction,
    resourceId: string,
    context: Record<string, any> = {},
    result: 'success' | 'failure' = 'success',
    error?: string
  ): Promise<void> {
    try {
      const entry: AuditEntry = {
        timestamp: Date.now(),
        action,
        actor: 'RuntimeLearningEngine',
        resource_id: resourceId,
        context,
        result,
        error
      };
      this.writeEntry(entry);
      this.rotateIfNeeded();
    } catch (e) {
      console.error('[AuditLogger] Failed to log audit entry:', e);
    }
  }

  private writeEntry(entry: AuditEntry): void {
    try {
      fs.appendFileSync(this.auditPath, JSON.stringify(entry) + '\n', 'utf-8');
    } catch (e) {
      console.error('[AuditLogger] Failed to write audit entry:', e);
    }
  }

  private rotateIfNeeded(): void {
    try {
      if (!fs.existsSync(this.auditPath)) return;
      const stats = fs.statSync(this.auditPath);
      if (stats.size > this.maxFileSize) {
        const backupPath = `${this.auditPath}.${Date.now()}`;
        fs.renameSync(this.auditPath, backupPath);
        console.log(`[AuditLogger] Rotated audit log to ${backupPath}`);
      }
    } catch (e) {
      console.error('[AuditLogger] Failed to rotate audit log:', e);
    }
  }

  async readAuditTrail(limit: number = 100): Promise<AuditEntry[]> {
    try {
      if (!fs.existsSync(this.auditPath)) return [];
      const data = fs.readFileSync(this.auditPath, 'utf-8');
      return data
        .trim()
        .split('\n')
        .filter(line => line.length > 0)
        .slice(-limit)
        .map(line => {
          try {
            return JSON.parse(line) as AuditEntry;
          } catch {
            return null;
          }
        })
        .filter((entry): entry is AuditEntry => entry !== null);
    } catch (e) {
      console.error('[AuditLogger] Failed to read audit trail:', e);
      return [];
    }
  }

  async getAuditStats(): Promise<AuditStats> {
    try {
      const entries = await this.readAuditTrail(10000);
      const byAction: Partial<Record<AuditAction, number>> = {};
      let successCount = 0;

      for (const entry of entries) {
        byAction[entry.action] = (byAction[entry.action] || 0) + 1;
        if (entry.result === 'success') successCount++;
      }

      return {
        totalEntries: entries.length,
        byAction,
        successRate: entries.length > 0 ? (successCount / entries.length) * 100 : 0
      };
    } catch (e) {
      console.error('[AuditLogger] Failed to calculate audit stats:', e);
      return { totalEntries: 0, byAction: {}, successRate: 0 };
    }
  }
}

export function createAuditLogger(storagePath?: string): AuditLogger {
  return new AuditLogger(storagePath);
}

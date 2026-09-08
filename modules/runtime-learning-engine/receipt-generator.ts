import * as fs from 'fs';
import * as path from 'path';
import { generateHash } from './utils';

export interface Receipt {
  receipt_id: string;
  timestamp: number;
  action: string;
  resource_id: string;
  status: 'pending' | 'completed' | 'failed';
  data: Record<string, any>;
  verification_hash: string;
  completion_time?: number;
  error?: string;
}

export class ReceiptGenerator {
  private storagePath: string;
  private receipts: Map<string, Receipt> = new Map();
  private receiptDir: string;

  constructor(storagePath: string = '/data/local/tmp/frida-learning') {
    this.storagePath = path.join(storagePath, 'receipts.json');
    this.receiptDir = storagePath;
    this.ensureDirectory();
    this.loadReceipts();
  }

  private ensureDirectory(): void {
    if (!fs.existsSync(this.receiptDir)) {
      fs.mkdirSync(this.receiptDir, { recursive: true });
    }
  }

  private loadReceipts(): void {
    try {
      if (fs.existsSync(this.storagePath)) {
        const data = fs.readFileSync(this.storagePath, 'utf-8');
        const parsed = JSON.parse(data);
        for (const receipt of parsed.receipts || []) {
          this.receipts.set(receipt.receipt_id, receipt);
        }
      }
    } catch (e) {
      console.warn('[ReceiptGenerator] Failed to load receipts, starting fresh:', e);
    }
  }

  private saveReceipts(): void {
    try {
      const data = {
        version: 1,
        generated_at: Date.now(),
        receipts: Array.from(this.receipts.values())
      };
      fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
      console.error('[ReceiptGenerator] Failed to save receipts:', e);
    }
  }

  private calculateVerificationHash(receipt: Omit<Receipt, 'verification_hash'> | Receipt): string {
    const receiptCopy = { ...receipt } as Partial<Receipt>;
    delete receiptCopy.verification_hash;
    return generateHash(JSON.stringify(receiptCopy));
  }

  generateReceipt(
    action: string,
    resourceId: string,
    data: Record<string, any> = {}
  ): Receipt {
    const timestamp = Date.now();
    const receiptId = `rcpt_${timestamp}_${Math.random().toString(36).substr(2, 9)}`;
    const receiptWithoutHash: Omit<Receipt, 'verification_hash'> = {
      receipt_id: receiptId,
      timestamp,
      action,
      resource_id: resourceId,
      status: 'pending',
      data
    };
    const receipt: Receipt = {
      ...receiptWithoutHash,
      verification_hash: this.calculateVerificationHash(receiptWithoutHash)
    };

    this.receipts.set(receiptId, receipt);
    this.saveReceipts();

    console.log(`[ReceiptGenerator] Generated receipt: ${receiptId} for ${action} on ${resourceId}`);
    return receipt;
  }

  completeReceipt(receiptId: string, resultData: Record<string, any> = {}): boolean {
    const receipt = this.receipts.get(receiptId);
    if (!receipt) {
      console.warn(`[ReceiptGenerator] Receipt not found: ${receiptId}`);
      return false;
    }

    receipt.status = 'completed';
    receipt.completion_time = Date.now();
    receipt.data = { ...receipt.data, ...resultData };
    receipt.verification_hash = this.calculateVerificationHash(receipt);

    this.saveReceipts();
    console.log(`[ReceiptGenerator] Completed receipt: ${receiptId}`);
    return true;
  }

  failReceipt(receiptId: string, error: string): boolean {
    const receipt = this.receipts.get(receiptId);
    if (!receipt) {
      console.warn(`[ReceiptGenerator] Receipt not found: ${receiptId}`);
      return false;
    }

    receipt.status = 'failed';
    receipt.completion_time = Date.now();
    receipt.error = error;
    receipt.verification_hash = this.calculateVerificationHash(receipt);

    this.saveReceipts();
    console.log(`[ReceiptGenerator] Failed receipt: ${receiptId}: ${error}`);
    return true;
  }

  verifyReceipt(receipt: Receipt): boolean {
    const calculatedHash = this.calculateVerificationHash(receipt);
    const isValid = calculatedHash === receipt.verification_hash;

    if (!isValid) {
      console.warn(`[ReceiptGenerator] Receipt verification failed: ${receipt.receipt_id}`);
    }

    return isValid;
  }

  getReceipt(receiptId: string): Receipt | undefined {
    return this.receipts.get(receiptId);
  }

  getAllReceipts(filter?: { action?: string; status?: string; maxAge?: number }): Receipt[] {
    let receipts = Array.from(this.receipts.values());

    if (filter?.action) {
      receipts = receipts.filter(r => r.action === filter.action);
    }

    if (filter?.status) {
      receipts = receipts.filter(r => r.status === filter.status);
    }

    if (filter?.maxAge) {
      const cutoff = Date.now() - filter.maxAge;
      receipts = receipts.filter(r => r.timestamp > cutoff);
    }

    return receipts.sort((a, b) => b.timestamp - a.timestamp);
  }

  getReceiptStats(): {
    total: number;
    completed: number;
    failed: number;
    pending: number;
    successRate: number;
  } {
    const receipts = Array.from(this.receipts.values());
    const completed = receipts.filter(r => r.status === 'completed').length;
    const failed = receipts.filter(r => r.status === 'failed').length;
    const pending = receipts.filter(r => r.status === 'pending').length;
    const settled = completed + failed;

    return {
      total: receipts.length,
      completed,
      failed,
      pending,
      successRate: settled > 0 ? (completed / settled) * 100 : 0
    };
  }

  verifyAllReceipts(): {
    total: number;
    valid: number;
    invalid: number;
    invalidReceipts: string[];
  } {
    const receipts = Array.from(this.receipts.values());
    const invalidReceipts: string[] = [];

    for (const receipt of receipts) {
      if (!this.verifyReceipt(receipt)) {
        invalidReceipts.push(receipt.receipt_id);
      }
    }

    return {
      total: receipts.length,
      valid: receipts.length - invalidReceipts.length,
      invalid: invalidReceipts.length,
      invalidReceipts
    };
  }
}

export function createReceiptGenerator(storagePath?: string): ReceiptGenerator {
  return new ReceiptGenerator(storagePath);
}

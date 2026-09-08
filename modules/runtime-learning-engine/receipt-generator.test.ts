import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ReceiptGenerator } from './receipt-generator';

function withGenerator(run: (generator: ReceiptGenerator) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-generator-'));
  try {
    run(new ReceiptGenerator(dir));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('ReceiptGenerator canonical verification gate', () => {
  test('generate -> verify', () => withGenerator(generator => {
    const receipt = generator.generateReceipt('observe', 'resource-1', { value: 1 });
    expect(generator.verifyReceipt(receipt)).toBe(true);
  }));

  test('complete -> verify', () => withGenerator(generator => {
    const receipt = generator.generateReceipt('observe', 'resource-2');
    expect(generator.completeReceipt(receipt.receipt_id, { result: 'ok' })).toBe(true);
    const completed = generator.getReceipt(receipt.receipt_id)!;
    expect(completed.status).toBe('completed');
    expect(generator.verifyReceipt(completed)).toBe(true);
  }));

  test('fail -> verify', () => withGenerator(generator => {
    const receipt = generator.generateReceipt('observe', 'resource-3');
    expect(generator.failReceipt(receipt.receipt_id, 'expected failure')).toBe(true);
    const failed = generator.getReceipt(receipt.receipt_id)!;
    expect(failed.status).toBe('failed');
    expect(generator.verifyReceipt(failed)).toBe(true);
  }));

  test('tamper -> reject', () => withGenerator(generator => {
    const receipt = generator.generateReceipt('observe', 'resource-4', { value: 1 });
    const tampered = { ...receipt, data: { value: 2 } };
    expect(generator.verifyReceipt(tampered)).toBe(false);
  }));

  test('pending-only stats -> finite zero success rate', () => withGenerator(generator => {
    generator.generateReceipt('observe', 'resource-5');
    const stats = generator.getReceiptStats();
    expect(stats).toEqual({ total: 1, completed: 0, failed: 0, pending: 1, successRate: 0 });
    expect(Number.isFinite(stats.successRate)).toBe(true);
  }));
});

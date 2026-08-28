import { RollbackJournal, RollbackEngine } from './types';
import { calculateFNV1a64 } from './utils';
import * as fs from 'fs';
import * as path from 'path';

const DEFAULT_STORAGE_PATH = '/data/local/tmp/frida-learning';
const DEFAULT_MAX_JOURNAL_SIZE = 4096;
const DEFAULT_MAX_ROLLBACK_ATTEMPTS = 3;

interface JournalStore {
  journals: RollbackJournal[];
}

export class RollbackEngineImpl implements RollbackEngine {
  private journals: Map<string, RollbackJournal> = new Map();
  private rollbackAttempts: Map<string, number> = new Map();
  private journalPath: string;

  constructor(
    storagePath: string = DEFAULT_STORAGE_PATH,
    private maxJournalSize: number = DEFAULT_MAX_JOURNAL_SIZE,
    private maxRollbackAttempts: number = DEFAULT_MAX_ROLLBACK_ATTEMPTS
  ) {
    this.journalPath = path.join(storagePath, 'rollback-journal.json');
  }

  async journalBefore(address: number, size: number, fixId: string = 'TOKEN_VAZIO'): Promise<RollbackJournal> {
    console.log(`[RollbackEngine] Creating journal for address: 0x${address.toString(16)}, size: ${size}`);

    if (!this.memoryReadAvailable()) {
      throw new Error('TOKEN_VAZIO: Frida Memory.readByteArray is unavailable; refusing unverified journal creation');
    }

    const raw = Memory.readByteArray(ptr(address), size);
    if (raw === null || raw === undefined) {
      throw new Error(`TOKEN_VAZIO: unable to read ${size} bytes at 0x${address.toString(16)}`);
    }

    const originalBytes = new Uint8Array(raw as ArrayBuffer);
    const journal: RollbackJournal = {
      journal_id: `journal_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      timestamp: Date.now(),
      fix_id: fixId,
      original_bytes: originalBytes,
      target_address: address,
      size,
      checksum_before: calculateFNV1a64(Buffer.from(originalBytes).toString('base64')),
      checksum_after: undefined,
      verification_passed: undefined
    };

    this.journals.set(journal.journal_id, journal);
    await this.persistJournal(journal);

    console.log(`[RollbackEngine] Journal created: ${journal.journal_id}, fix_id=${journal.fix_id}`);
    return journal;
  }

  async commitFix(journal: RollbackJournal, checksum_after: string): Promise<boolean> {
    console.log(`[RollbackEngine] Committing fix for journal: ${journal.journal_id}`);

    try {
      journal.checksum_after = checksum_after;

      if (!journal.checksum_before || journal.checksum_before === checksum_after) {
        console.warn('[RollbackEngine] No independently observable mutation detected');
        journal.verification_passed = false;
        await this.persistJournal(journal);
        return false;
      }

      journal.verification_passed = true;
      this.journals.set(journal.journal_id, journal);
      await this.persistJournal(journal);

      console.log(`[RollbackEngine] Fix committed for ${journal.journal_id}`);
      return true;
    } catch (e) {
      console.error('[RollbackEngine] Failed to commit fix:', e);
      return false;
    }
  }

  async rollback(journal: RollbackJournal): Promise<boolean> {
    const attemptKey = journal.journal_id;
    const attempts = this.rollbackAttempts.get(attemptKey) || 0;

    if (attempts >= this.maxRollbackAttempts) {
      console.error(
        `[RollbackEngine] Max rollback attempts (${this.maxRollbackAttempts}) reached for ${journal.journal_id}`
      );
      return false;
    }

    if (!this.memoryWriteAvailable()) {
      console.error('[RollbackEngine] TOKEN_VAZIO: Frida Memory write API unavailable; rollback not executed');
      return false;
    }

    this.rollbackAttempts.set(attemptKey, attempts + 1);

    console.log(
      `[RollbackEngine] Attempting rollback for ${journal.journal_id} ` +
      `(attempt ${attempts + 1}/${this.maxRollbackAttempts})`
    );

    try {
      Memory.protect(ptr(journal.target_address), journal.size, 'rwx');
      Memory.writeByteArray(ptr(journal.target_address), Array.from(journal.original_bytes));
      Memory.protect(ptr(journal.target_address), journal.size, 'r-x');

      const success = await this.verifyRollback(journal);

      if (!success && attempts < this.maxRollbackAttempts - 1) {
        console.log('[RollbackEngine] Verification failed, retrying rollback...');
        return await this.rollback(journal);
      }

      journal.verification_passed = success;
      this.journals.set(journal.journal_id, journal);
      await this.persistJournal(journal);

      console.log(`[RollbackEngine] Rollback completed for ${journal.journal_id}; verified=${success}`);
      return success;
    } catch (e) {
      console.error('[RollbackEngine] Rollback failed:', e);

      if (attempts < this.maxRollbackAttempts - 1) {
        console.log('[RollbackEngine] Retrying rollback...');
        return await this.rollback(journal);
      }

      return false;
    }
  }

  async verifyRollback(journal: RollbackJournal): Promise<boolean> {
    console.log(`[RollbackEngine] Verifying rollback for ${journal.journal_id}`);

    if (!this.memoryReadAvailable()) {
      console.error('[RollbackEngine] TOKEN_VAZIO: Memory API unavailable; rollback cannot be verified');
      return false;
    }

    try {
      const raw = Memory.readByteArray(ptr(journal.target_address), journal.size);
      if (raw === null || raw === undefined) {
        console.error('[RollbackEngine] TOKEN_VAZIO: rollback target cannot be read for verification');
        return false;
      }

      const readBytes = new Uint8Array(raw as ArrayBuffer);
      const checksumAfterRollback = calculateFNV1a64(Buffer.from(readBytes).toString('base64'));
      const verified = Boolean(journal.checksum_before) && checksumAfterRollback === journal.checksum_before;

      if (verified) {
        console.log(`[RollbackEngine] Rollback verification PASSED for ${journal.journal_id}`);
      } else {
        console.error(
          `[RollbackEngine] Rollback verification FAILED for ${journal.journal_id}. ` +
          `Expected: ${journal.checksum_before || 'TOKEN_VAZIO'}, Got: ${checksumAfterRollback}`
        );
      }

      return verified;
    } catch (e) {
      console.error('[RollbackEngine] Rollback verification failed:', e);
      return false;
    }
  }

  private memoryReadAvailable(): boolean {
    return typeof Memory !== 'undefined' && typeof Memory.readByteArray === 'function';
  }

  private memoryWriteAvailable(): boolean {
    return (
      typeof Memory !== 'undefined' &&
      typeof Memory.protect === 'function' &&
      typeof Memory.writeByteArray === 'function'
    );
  }

  private async persistJournal(journal: RollbackJournal): Promise<void> {
    try {
      const journalDir = path.dirname(this.journalPath);

      if (!fs.existsSync(journalDir)) {
        fs.mkdirSync(journalDir, { recursive: true });
      }

      let store: JournalStore = { journals: [] };

      if (fs.existsSync(this.journalPath)) {
        try {
          const data = fs.readFileSync(this.journalPath, 'utf-8');
          store = JSON.parse(data);
        } catch (e) {
          console.warn('[RollbackEngine] Existing journal store is unreadable; preserving new journal in memory only', e);
          return;
        }
      }

      const existingIndex = store.journals.findIndex(item => item.journal_id === journal.journal_id);
      if (existingIndex >= 0) {
        store.journals[existingIndex] = journal;
      } else {
        store.journals.push(journal);
      }

      if (store.journals.length > this.maxJournalSize) {
        store.journals = store.journals.slice(-this.maxJournalSize);
      }

      fs.writeFileSync(this.journalPath, JSON.stringify(store, null, 2), 'utf-8');
      console.log('[RollbackEngine] Journal persisted');
    } catch (e) {
      console.error('[RollbackEngine] Failed to persist journal:', e);
    }
  }

  getJournal(journalId: string): RollbackJournal | undefined {
    return this.journals.get(journalId);
  }

  getAllJournals(): RollbackJournal[] {
    return Array.from(this.journals.values());
  }
}

export function createRollbackEngine(): RollbackEngine {
  return new RollbackEngineImpl();
}

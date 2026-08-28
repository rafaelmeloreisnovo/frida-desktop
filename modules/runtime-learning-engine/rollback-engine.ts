import { RollbackJournal, RollbackEngine } from './types';
import { generateHash, calculateFNV1a64 } from './utils';
import * as fs from 'fs';
import * as path from 'path';

const JOURNAL_PATH = '/data/local/tmp/frida-learning/rollback-journal.json';
const MAX_JOURNAL_SIZE = 4096;
const MAX_ROLLBACK_ATTEMPTS = 3;

interface JournalStore {
  journals: RollbackJournal[];
}

export class RollbackEngineImpl implements RollbackEngine {
  private journals: Map<string, RollbackJournal> = new Map();
  private rollbackAttempts: Map<string, number> = new Map();

  async journalBefore(address: number, size: number): Promise<RollbackJournal> {
    console.log(`[RollbackEngine] Creating journal for address: 0x${address.toString(16)}, size: ${size}`);

    const journal: RollbackJournal = {
      journal_id: `journal_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      timestamp: Date.now(),
      fix_id: '',
      original_bytes: new Uint8Array(size),
      target_address: address,
      size,
      checksum_before: '',
      checksum_after: undefined,
      verification_passed: undefined
    };

    try {
      if (Memory.ProtectionAllow === undefined) {
        console.warn('[RollbackEngine] Memory API not available in this context');
        return journal;
      }

      const oldProtect = Memory.protect(ptr(address), size, 'r--');
      Memory.copy(ptr(address), journal.original_bytes, size);
      Memory.protect(ptr(address), size, oldProtect);

      journal.checksum_before = calculateFNV1a64(Buffer.from(journal.original_bytes).toString('base64'));

      this.journals.set(journal.journal_id, journal);
      await this.persistJournal(journal);

      console.log(`[RollbackEngine] Journal created: ${journal.journal_id}`);
      return journal;
    } catch (e) {
      console.error('[RollbackEngine] Failed to create journal:', e);
      throw e;
    }
  }

  async commitFix(journal: RollbackJournal, checksum_after: string): Promise<boolean> {
    console.log(`[RollbackEngine] Committing fix for journal: ${journal.journal_id}`);

    try {
      journal.checksum_after = checksum_after;

      if (journal.checksum_before === checksum_after) {
        console.warn('[RollbackEngine] Checksums are identical, no mutation detected');
        journal.verification_passed = false;
        return false;
      }

      journal.verification_passed = true;
      this.journals.set(journal.journal_id, journal);
      await this.persistJournal(journal);

      console.log(`[RollbackEngine] Fix committed successfully for ${journal.journal_id}`);
      return true;
    } catch (e) {
      console.error('[RollbackEngine] Failed to commit fix:', e);
      return false;
    }
  }

  async rollback(journal: RollbackJournal): Promise<boolean> {
    const attemptKey = journal.journal_id;
    const attempts = this.rollbackAttempts.get(attemptKey) || 0;

    if (attempts >= MAX_ROLLBACK_ATTEMPTS) {
      console.error(
        `[RollbackEngine] Max rollback attempts (${MAX_ROLLBACK_ATTEMPTS}) reached for ${journal.journal_id}`
      );
      return false;
    }

    this.rollbackAttempts.set(attemptKey, attempts + 1);

    console.log(
      `[RollbackEngine] Attempting rollback for ${journal.journal_id} ` +
      `(attempt ${attempts + 1}/${MAX_ROLLBACK_ATTEMPTS})`
    );

    try {
      if (Memory.ProtectionAllow === undefined) {
        console.warn('[RollbackEngine] Memory API not available, cannot rollback');
        return false;
      }

      const oldProtect = Memory.protect(ptr(journal.target_address), journal.size, 'rw-');

      Memory.copy(journal.original_bytes, ptr(journal.target_address), journal.size);

      const icache = Memory.protect(ptr(journal.target_address), journal.size, 'r-x');

      const success = await this.verifyRollback(journal);

      if (!success && attempts < MAX_ROLLBACK_ATTEMPTS - 1) {
        console.log('[RollbackEngine] Verification failed, retrying rollback...');
        return await this.rollback(journal);
      }

      console.log(`[RollbackEngine] Rollback completed for ${journal.journal_id}`);
      return success;
    } catch (e) {
      console.error('[RollbackEngine] Rollback failed:', e);

      if (attempts < MAX_ROLLBACK_ATTEMPTS - 1) {
        console.log('[RollbackEngine] Retrying rollback...');
        return await this.rollback(journal);
      }

      return false;
    }
  }

  async verifyRollback(journal: RollbackJournal): Promise<boolean> {
    console.log(`[RollbackEngine] Verifying rollback for ${journal.journal_id}`);

    try {
      if (Memory.ProtectionAllow === undefined) {
        console.warn('[RollbackEngine] Memory API not available, skipping verification');
        return true;
      }

      const readBytes = new Uint8Array(journal.size);
      Memory.copy(ptr(journal.target_address), readBytes, journal.size);

      const checksumAfterRollback = calculateFNV1a64(
        Buffer.from(readBytes).toString('base64')
      );

      const verified = checksumAfterRollback === journal.checksum_before;

      if (verified) {
        console.log(`[RollbackEngine] Rollback verification PASSED for ${journal.journal_id}`);
      } else {
        console.error(
          `[RollbackEngine] Rollback verification FAILED for ${journal.journal_id}. ` +
          `Expected: ${journal.checksum_before}, Got: ${checksumAfterRollback}`
        );
      }

      return verified;
    } catch (e) {
      console.error('[RollbackEngine] Rollback verification failed:', e);
      return false;
    }
  }

  private async persistJournal(journal: RollbackJournal): Promise<void> {
    try {
      const journalDir = path.dirname(JOURNAL_PATH);

      if (!fs.existsSync(journalDir)) {
        fs.mkdirSync(journalDir, { recursive: true });
      }

      let store: JournalStore = { journals: [] };

      if (fs.existsSync(JOURNAL_PATH)) {
        try {
          const data = fs.readFileSync(JOURNAL_PATH, 'utf-8');
          store = JSON.parse(data);
        } catch (e) {
          console.warn('[RollbackEngine] Failed to read existing journal store, creating new');
        }
      }

      store.journals.push(journal);

      if (store.journals.length > MAX_JOURNAL_SIZE) {
        store.journals = store.journals.slice(-MAX_JOURNAL_SIZE);
      }

      fs.writeFileSync(JOURNAL_PATH, JSON.stringify(store, null, 2), 'utf-8');
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

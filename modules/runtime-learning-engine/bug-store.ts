import { BugEvent, BugHistoryStore, BugStore } from './types';
import { calculateFNV1a64 } from './utils';
import { CorruptionRecoveryHandler } from './corruption-recovery';
import * as fs from 'fs';
import * as path from 'path';

const DEFAULT_STORAGE_PATH = '/data/local/tmp/frida-learning';
const DEFAULT_MAX_EVENTS = 512;

export class BugStoreImpl implements BugStore {
  private store: BugHistoryStore | null = null;
  private initialized = false;
  private historyFile: string;
  private corruptionRecovery = new CorruptionRecoveryHandler();

  constructor(
    private storagePath: string = DEFAULT_STORAGE_PATH,
    private maxEvents: number = DEFAULT_MAX_EVENTS
  ) {
    this.historyFile = path.join(storagePath, 'bug-history.json');
  }

  async loadHistory(): Promise<BugHistoryStore> {
    if (this.store && this.initialized) {
      return this.store;
    }

    try {
      console.log(`[BugStore] Loading history from ${this.historyFile}`);

      if (!fs.existsSync(this.storagePath)) {
        fs.mkdirSync(this.storagePath, { recursive: true });
      }

      let store: BugHistoryStore;

      if (fs.existsSync(this.historyFile)) {
        const data = fs.readFileSync(this.historyFile, 'utf-8');
        const jsonFinding = this.corruptionRecovery.detectInvalidJSON(data);
        if (jsonFinding.detected) {
          this.quarantineExistingHistory(jsonFinding.error_message);
          store = this.createEmptyStore();
        } else {
          store = JSON.parse(data) as BugHistoryStore;
          if (!this.verifyIntegrity(store)) {
            this.quarantineExistingHistory('integrity_hash mismatch');
            store = this.createEmptyStore();
          }
        }
      } else {
        console.log('[BugStore] No existing history, creating fresh store');
        store = this.createEmptyStore();
      }

      this.store = store;
      this.initialized = true;
      return store;
    } catch (e) {
      console.error('[BugStore] Failed to load history:', e);
      if (fs.existsSync(this.historyFile)) {
        this.quarantineExistingHistory(`load failure: ${e}`);
      }
      this.store = this.createEmptyStore();
      this.initialized = true;
      return this.store;
    }
  }

  async saveHistory(store: BugHistoryStore): Promise<void> {
    try {
      if (!fs.existsSync(this.storagePath)) {
        fs.mkdirSync(this.storagePath, { recursive: true });
      }

      store.last_updated = Date.now();
      store.integrity_hash = this.calculateStoreHash(store);

      const temporaryPath = `${this.historyFile}.tmp`;
      fs.writeFileSync(temporaryPath, JSON.stringify(store, null, 2), 'utf-8');
      fs.renameSync(temporaryPath, this.historyFile);
      this.store = store;

      console.log(`[BugStore] History saved (${store.events.length} events)`);
    } catch (e) {
      console.error('[BugStore] Failed to save history:', e);
    }
  }

  async appendEvent(event: BugEvent): Promise<void> {
    try {
      const store = await this.loadHistory();

      store.events.push(event);

      if (store.events.length > this.maxEvents) {
        console.log('[BugStore] Circular buffer full, removing oldest event');
        store.events.shift();
      }

      await this.saveHistory(store);
      console.log(`[BugStore] Event appended (${event.bug_type})`);
    } catch (e) {
      console.error('[BugStore] Failed to append event:', e);
    }
  }

  async getRecentBugs(limit: number): Promise<BugEvent[]> {
    try {
      const store = await this.loadHistory();
      return store.events.slice(-limit).reverse();
    } catch (e) {
      console.error('[BugStore] Failed to get recent bugs:', e);
      return [];
    }
  }

  private createEmptyStore(): BugHistoryStore {
    return {
      schema: 1,
      events: [],
      patterns: [],
      fix_events: [],
      watchdog_events: [],
      integrity_hash: '',
      last_updated: Date.now()
    };
  }

  private calculateStoreHash(store: BugHistoryStore): string {
    const toHash = {
      schema: store.schema,
      events_count: store.events.length,
      patterns_count: store.patterns.length,
      fix_events_count: store.fix_events.length,
      watchdog_events_count: store.watchdog_events.length,
      last_event_id: store.events.length > 0 ? store.events[store.events.length - 1].id : 'none'
    };

    return calculateFNV1a64(JSON.stringify(toHash));
  }

  private verifyIntegrity(store: BugHistoryStore): boolean {
    try {
      const expectedHash = this.calculateStoreHash(store);

      if (store.integrity_hash === expectedHash) {
        console.log('[BugStore] Integrity check passed');
        return true;
      }

      console.warn('[BugStore] Integrity mismatch:', {
        expected: expectedHash,
        actual: store.integrity_hash || 'TOKEN_VAZIO'
      });
      return false;
    } catch (e) {
      console.error('[BugStore] Failed integrity check:', e);
      return false;
    }
  }

  private quarantineExistingHistory(reason: string): void {
    try {
      if (!fs.existsSync(this.historyFile)) return;

      const timestamp = Date.now();
      const quarantinePath = path.join(this.storagePath, `bug-history.corrupt.${timestamp}.json`);
      fs.renameSync(this.historyFile, quarantinePath);
      fs.writeFileSync(
        `${quarantinePath}.meta.json`,
        JSON.stringify(
          {
            schema: 'rafaelia.runtime.corruption-quarantine.v1',
            source: this.historyFile,
            quarantined_path: quarantinePath,
            timestamp,
            reason,
            destructive_recovery_performed: false,
            evidence_state: 'PRESERVED_FOR_INSPECTION',
            claim_allowed: false
          },
          null,
          2
        ),
        'utf-8'
      );
      console.error(`[BugStore] Corrupted history quarantined at ${quarantinePath}: ${reason}`);
    } catch (e) {
      console.error('[BugStore] Failed to quarantine corrupted history:', e);
    }
  }
}

export function createBugStore(): BugStore {
  return new BugStoreImpl();
}

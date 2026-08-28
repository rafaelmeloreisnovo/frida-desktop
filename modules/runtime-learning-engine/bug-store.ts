import { BugEvent, BugHistoryStore, BugStore } from './types';
import { generateHash, calculateFNV1a64 } from './utils';
import * as fs from 'fs';
import * as path from 'path';

const STORAGE_PATH = '/data/local/tmp/frida-learning';
const HISTORY_FILE = path.join(STORAGE_PATH, 'bug-history.json');
const MAX_EVENTS = 512;

export class BugStoreImpl implements BugStore {
  private store: BugHistoryStore | null = null;
  private initialized = false;

  async loadHistory(): Promise<BugHistoryStore> {
    if (this.store && this.initialized) {
      return this.store;
    }

    try {
      console.log(`[BugStore] Loading history from ${HISTORY_FILE}`);

      if (!fs.existsSync(STORAGE_PATH)) {
        fs.mkdirSync(STORAGE_PATH, { recursive: true });
      }

      let store: BugHistoryStore;

      if (fs.existsSync(HISTORY_FILE)) {
        const data = fs.readFileSync(HISTORY_FILE, 'utf-8');
        store = JSON.parse(data);

        if (!this.verifyIntegrity(store)) {
          console.warn('[BugStore] Integrity check failed, creating fresh store');
          store = this.createEmptyStore();
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
      this.store = this.createEmptyStore();
      this.initialized = true;
      return this.store;
    }
  }

  async saveHistory(store: BugHistoryStore): Promise<void> {
    try {
      if (!fs.existsSync(STORAGE_PATH)) {
        fs.mkdirSync(STORAGE_PATH, { recursive: true });
      }

      store.last_updated = Date.now();
      store.integrity_hash = this.calculateStoreHash(store);

      fs.writeFileSync(HISTORY_FILE, JSON.stringify(store, null, 2), 'utf-8');
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

      if (store.events.length > MAX_EVENTS) {
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
        actual: store.integrity_hash
      });
      return false;
    } catch (e) {
      console.error('[BugStore] Failed integrity check:', e);
      return false;
    }
  }
}

export function createBugStore(): BugStore {
  return new BugStoreImpl();
}

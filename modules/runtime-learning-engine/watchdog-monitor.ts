import { WatchdogMonitor, WatchdogEvent, WatchdogState } from './types';
import * as fs from 'fs';
import * as path from 'path';

const DEFAULT_STORAGE_PATH = '/data/local/tmp/frida-learning';
const DEFAULT_HEARTBEAT_INTERVAL = 1000;
const DEFAULT_EPOCH_TIMEOUT = 5000;

interface WatchdogStore {
  events: WatchdogEvent[];
}

export class WatchdogMonitorImpl implements WatchdogMonitor {
  private monitoring = false;
  private heartbeatTimer: any = null;
  private epochTimer: any = null;
  private heartbeat_count = 0;
  private current_epoch = 0;
  private trap_count = 0;
  private current_state: WatchdogState = 'STABLE';
  private rollback_callback: (() => void | Promise<void>) | null = null;
  private last_heartbeat_time: number = 0;
  private watchdogPath: string;

  constructor(
    storagePath: string = DEFAULT_STORAGE_PATH,
    private heartbeatInterval: number = DEFAULT_HEARTBEAT_INTERVAL,
    private epochTimeout: number = DEFAULT_EPOCH_TIMEOUT
  ) {
    this.watchdogPath = path.join(storagePath, 'watchdog-events.json');
  }

  async startWatchdog(): Promise<void> {
    if (this.monitoring) {
      console.warn('[WatchdogMonitor] Watchdog already running');
      return;
    }

    console.log('[WatchdogMonitor] Starting watchdog...');
    this.monitoring = true;
    this.heartbeat_count = 0;
    this.current_epoch = Math.floor(Date.now() / 1000);
    this.trap_count = 0;
    this.last_heartbeat_time = Date.now();

    this.heartbeatTimer = setInterval(() => {
      this.heartbeat();
    }, this.heartbeatInterval);

    this.epochTimer = setInterval(() => {
      this.checkEpochTimeout();
    }, this.epochTimeout);

    console.log(
      `[WatchdogMonitor] Watchdog started heartbeat=${this.heartbeatInterval}ms timeout=${this.epochTimeout}ms`
    );
  }

  async stopWatchdog(): Promise<void> {
    if (!this.monitoring) return;

    console.log('[WatchdogMonitor] Stopping watchdog...');

    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.epochTimer) clearInterval(this.epochTimer);

    this.monitoring = false;
    console.log('[WatchdogMonitor] Watchdog stopped');
  }

  async heartbeat(): Promise<void> {
    this.heartbeat_count++;
    this.last_heartbeat_time = Date.now();

    try {
      const event: WatchdogEvent = {
        timestamp: Date.now(),
        heartbeat_count: this.heartbeat_count,
        epoch: this.current_epoch,
        state: this.current_state,
        trap_count: this.trap_count
      };

      if (this.heartbeat_count % 10 === 0) {
        console.log(
          `[WatchdogMonitor] Heartbeat ${event.heartbeat_count}: ` +
          `epoch=${event.epoch}, state=${event.state}, traps=${event.trap_count}`
        );
      }

      await this.recordEvent(event);
    } catch (e) {
      console.error('[WatchdogMonitor] Heartbeat error:', e);
    }
  }

  async recordEvent(event: WatchdogEvent): Promise<void> {
    try {
      const watchdogDir = path.dirname(this.watchdogPath);

      if (!fs.existsSync(watchdogDir)) {
        fs.mkdirSync(watchdogDir, { recursive: true });
      }

      let store: WatchdogStore = { events: [] };

      if (fs.existsSync(this.watchdogPath)) {
        try {
          const data = fs.readFileSync(this.watchdogPath, 'utf-8');
          store = JSON.parse(data);
        } catch (e) {
          console.warn('[WatchdogMonitor] Existing watchdog store unreadable; refusing silent overwrite');
          return;
        }
      }

      store.events.push(event);

      if (store.events.length > 1000) {
        store.events = store.events.slice(-1000);
      }

      fs.writeFileSync(this.watchdogPath, JSON.stringify(store, null, 2), 'utf-8');
    } catch (e) {
      console.error('[WatchdogMonitor] Failed to record event:', e);
    }
  }

  private checkEpochTimeout(): void {
    if (!this.monitoring) return;

    const now = Date.now();
    const lastHeartbeatAge = now - this.last_heartbeat_time;

    if (lastHeartbeatAge > this.epochTimeout) {
      console.error(
        `[WatchdogMonitor] Epoch timeout detected! ` +
        `Last heartbeat was ${lastHeartbeatAge}ms ago (timeout: ${this.epochTimeout}ms). Triggering rollback...`
      );

      this.current_state = 'FAILSAFE';
      this.trap_count++;

      const event: WatchdogEvent = {
        timestamp: now,
        heartbeat_count: this.heartbeat_count,
        epoch: this.current_epoch,
        state: this.current_state,
        trap_count: this.trap_count,
        rollback_triggered: true,
        reason: `epoch_timeout (${lastHeartbeatAge}ms)`
      };

      this.recordEvent(event).catch(e => console.error('[WatchdogMonitor] Failed to record timeout event:', e));

      if (this.rollback_callback) {
        Promise.resolve(this.rollback_callback()).catch(e =>
          console.error('[WatchdogMonitor] Rollback callback failed:', e)
        );
      }

      this.current_epoch++;
      this.last_heartbeat_time = now;
    }
  }

  setState(state: WatchdogState): void {
    if (this.current_state !== state) {
      console.log(`[WatchdogMonitor] State transition: ${this.current_state} → ${state}`);
      this.current_state = state;
    }
  }

  incrementTrapCount(): void {
    this.trap_count++;
  }

  setRollbackCallback(callback: () => void | Promise<void>): void {
    this.rollback_callback = callback;
  }

  getStats() {
    return {
      monitoring: this.monitoring,
      heartbeat_count: this.heartbeat_count,
      current_epoch: this.current_epoch,
      trap_count: this.trap_count,
      current_state: this.current_state,
      last_heartbeat_time: this.last_heartbeat_time,
      heartbeat_interval_ms: this.heartbeatInterval,
      epoch_timeout_ms: this.epochTimeout
    };
  }
}

export function createWatchdogMonitor(): WatchdogMonitor {
  return new WatchdogMonitorImpl();
}

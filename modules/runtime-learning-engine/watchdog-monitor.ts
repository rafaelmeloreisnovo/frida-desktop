import { WatchdogMonitor, WatchdogEvent, WatchdogState } from './types';
import * as fs from 'fs';
import * as path from 'path';

const WATCHDOG_PATH = '/data/local/tmp/frida-learning/watchdog-events.json';
const HEARTBEAT_INTERVAL = 1000;
const EPOCH_TIMEOUT = 5000;

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
  private rollback_callback: (() => void) | null = null;

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

    this.heartbeatTimer = setInterval(() => {
      this.heartbeat();
    }, HEARTBEAT_INTERVAL);

    this.epochTimer = setInterval(() => {
      this.checkEpochTimeout();
    }, EPOCH_TIMEOUT);

    console.log('[WatchdogMonitor] Watchdog started');
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
      const watchdogDir = path.dirname(WATCHDOG_PATH);

      if (!fs.existsSync(watchdogDir)) {
        fs.mkdirSync(watchdogDir, { recursive: true });
      }

      let store: WatchdogStore = { events: [] };

      if (fs.existsSync(WATCHDOG_PATH)) {
        try {
          const data = fs.readFileSync(WATCHDOG_PATH, 'utf-8');
          store = JSON.parse(data);
        } catch (e) {
          console.warn('[WatchdogMonitor] Failed to read existing watchdog store');
        }
      }

      store.events.push(event);

      if (store.events.length > 1000) {
        store.events = store.events.slice(-1000);
      }

      fs.writeFileSync(WATCHDOG_PATH, JSON.stringify(store, null, 2), 'utf-8');
    } catch (e) {
      console.error('[WatchdogMonitor] Failed to record event:', e);
    }
  }

  private checkEpochTimeout(): void {
    if (!this.monitoring) return;

    const now = Date.now();
    const lastHeartbeatAge = this.heartbeat_count > 0 ? 0 : EPOCH_TIMEOUT + 1;

    if (lastHeartbeatAge > EPOCH_TIMEOUT) {
      console.error('[WatchdogMonitor] Epoch timeout detected! Triggering rollback...');

      this.current_state = 'FAILSAFE';
      this.trap_count++;

      const event: WatchdogEvent = {
        timestamp: now,
        heartbeat_count: this.heartbeat_count,
        epoch: this.current_epoch,
        state: this.current_state,
        trap_count: this.trap_count,
        rollback_triggered: true,
        reason: 'epoch_timeout'
      };

      this.recordEvent(event).catch(e => console.error('[WatchdogMonitor] Failed to record timeout event:', e));

      if (this.rollback_callback) {
        this.rollback_callback();
      }

      this.current_epoch++;
      this.heartbeat_count = 0;
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

  setRollbackCallback(callback: () => void): void {
    this.rollback_callback = callback;
  }

  getStats() {
    return {
      monitoring: this.monitoring,
      heartbeat_count: this.heartbeat_count,
      current_epoch: this.current_epoch,
      trap_count: this.trap_count,
      current_state: this.current_state
    };
  }
}

export function createWatchdogMonitor(): WatchdogMonitor {
  return new WatchdogMonitorImpl();
}

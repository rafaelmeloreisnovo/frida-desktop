import { BugEvent, BugCapture, BugType, Severity } from './types';
import { generateHash, generateEventId } from './utils';

export class BugCaptureImpl implements BugCapture {
  private capturing = false;
  private hooks: Map<string, any> = new Map();
  private onBugCaptured: ((event: BugEvent) => Promise<void>) | null = null;

  async startCapture(): Promise<void> {
    if (this.capturing) return;

    console.log('[BugCapture] Starting bug capture...');
    this.capturing = true;

    await this.hookThrowableException();
    await this.hookActivityNotResponding();
    await this.hookMemoryPressure();
    await this.hookDeadlock();
  }

  async stopCapture(): Promise<void> {
    if (!this.capturing) return;

    console.log('[BugCapture] Stopping bug capture...');
    this.hooks.forEach(hook => {
      try {
        hook.detach();
      } catch (e) {
        console.warn('[BugCapture] Error detaching hook:', e);
      }
    });
    this.hooks.clear();
    this.capturing = false;
  }

  async captureBug(event: BugEvent): Promise<void> {
    console.log(`[BugCapture] Captured bug: ${event.bug_type} in ${event.class}.${event.method}`);
    if (this.onBugCaptured) {
      try {
        await this.onBugCaptured(event);
      } catch (e) {
        console.error('[BugCapture] Error in bug captured callback:', e);
      }
    }
  }

  setBugCapturedCallback(callback: (event: BugEvent) => Promise<void>): void {
    this.onBugCaptured = callback;
  }

  private async hookThrowableException(): Promise<void> {
    try {
      const throwable = Java.use('java.lang.Throwable');
      const originalPrintStackTrace = throwable.printStackTrace.overload('java.io.PrintStream');
      const bugCapture = this;

      const hook = originalPrintStackTrace.implementation = function() {
        const event: BugEvent = {
          id: generateEventId(),
          timestamp: Date.now(),
          bug_type: 'crash' as BugType,
          class: this.getClass().getName().toString(),
          method: 'printStackTrace',
          exception_type: this.getClass().getSimpleName().toString(),
          stack_hash: generateHash(this.toString()),
          severity: 'critical' as Severity,
          status: 'new',
          thread_id: Java.use('java.lang.Thread').currentThread().getId().toNumber(),
          process_id: Java.use('android.os.Process').myPid()
        };

        console.log(`[BugCapture] Exception caught: ${event.exception_type}`);
        bugCapture.captureBug(event).catch(e => console.error('[BugCapture] Failed to capture bug:', e));
        return originalPrintStackTrace.call(this);
      };

      this.hooks.set('Throwable.printStackTrace', hook);
      console.log('[BugCapture] Hooked Throwable.printStackTrace');
    } catch (e) {
      console.warn('[BugCapture] Failed to hook Throwable:', e);
    }
  }

  private async hookActivityNotResponding(): Promise<void> {
    try {
      const activityManager = Java.use('android.app.ActivityManager');
      const handler = Java.use('android.os.Handler');
      const bugCapture = this;

      const hook = handler.post.implementation = function(runnable: any) {
        const isANR = runnable.toString().includes('appNotResponding');

        if (isANR) {
          const event: BugEvent = {
            id: generateEventId(),
            timestamp: Date.now(),
            bug_type: 'anr' as BugType,
            class: 'android.app.ActivityManager',
            method: 'appNotResponding',
            exception_type: 'ANRException',
            stack_hash: generateHash(runnable.toString()),
            severity: 'high' as Severity,
            status: 'new',
            thread_id: Java.use('java.lang.Thread').currentThread().getId().toNumber(),
            process_id: Java.use('android.os.Process').myPid()
          };

          console.log('[BugCapture] ANR detected');
          bugCapture.captureBug(event).catch(e => console.error('[BugCapture] Failed to capture ANR:', e));
        }

        return handler.post.call(this, runnable);
      };

      this.hooks.set('Handler.post', hook);
      console.log('[BugCapture] Hooked Handler.post for ANR detection');
    } catch (e) {
      console.warn('[BugCapture] Failed to hook ANR detection:', e);
    }
  }

  private async hookMemoryPressure(): Promise<void> {
    try {
      const runtime = Java.use('java.lang.Runtime');
      const originalGC = runtime.gc;
      const bugCapture = this;

      const hook = originalGC.implementation = function() {
        const maxMemory = runtime.getRuntime().maxMemory();
        const totalMemory = runtime.getRuntime().totalMemory();
        const freeMemory = runtime.getRuntime().freeMemory();
        const usedMemory = totalMemory.toNumber() - freeMemory.toNumber();
        const pressure = usedMemory / maxMemory.toNumber();

        if (pressure > 0.85) {
          const event: BugEvent = {
            id: generateEventId(),
            timestamp: Date.now(),
            bug_type: 'memory_leak' as BugType,
            class: 'java.lang.Runtime',
            method: 'gc',
            exception_type: 'MemoryPressure',
            stack_hash: generateHash(pressure.toString()),
            severity: pressure > 0.95 ? 'critical' as Severity : 'high' as Severity,
            status: 'new',
            thread_id: Java.use('java.lang.Thread').currentThread().getId().toNumber(),
            process_id: Java.use('android.os.Process').myPid()
          };

          console.log(`[BugCapture] Memory pressure detected: ${(pressure * 100).toFixed(2)}%`);
          bugCapture.captureBug(event).catch(e => console.error('[BugCapture] Failed to capture memory pressure:', e));
        }

        return originalGC.call(this);
      };

      this.hooks.set('Runtime.gc', hook);
      console.log('[BugCapture] Hooked Runtime.gc for memory pressure detection');
    } catch (e) {
      console.warn('[BugCapture] Failed to hook memory detection:', e);
    }
  }

  private async hookDeadlock(): Promise<void> {
    try {
      const thread = Java.use('java.lang.Thread');
      const lockSupport = Java.use('java.util.concurrent.locks.LockSupport');
      const bugCapture = this;

      const hook = lockSupport.park.overload().implementation = function() {
        const currentThread = thread.currentThread();
        const blockedTime = currentThread.getBlockedTime();

        if (blockedTime > 5000) {
          const event: BugEvent = {
            id: generateEventId(),
            timestamp: Date.now(),
            bug_type: 'deadlock' as BugType,
            class: currentThread.getClass().getName().toString(),
            method: 'run',
            exception_type: 'DeadlockDetected',
            stack_hash: generateHash(currentThread.getName().toString()),
            severity: 'critical' as Severity,
            status: 'new',
            thread_id: currentThread.getId().toNumber(),
            process_id: Java.use('android.os.Process').myPid()
          };

          console.log(`[BugCapture] Potential deadlock detected in ${currentThread.getName()}`);
          bugCapture.captureBug(event).catch(e => console.error('[BugCapture] Failed to capture deadlock:', e));
        }

        return lockSupport.park.call(this);
      };

      this.hooks.set('LockSupport.park', hook);
      console.log('[BugCapture] Hooked LockSupport.park for deadlock detection');
    } catch (e) {
      console.warn('[BugCapture] Failed to hook deadlock detection:', e);
    }
  }
}

export function createBugCapture(): BugCapture {
  return new BugCaptureImpl();
}

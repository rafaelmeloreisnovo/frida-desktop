import { BugPattern, FixEvent, AutoFixer, TestResult } from './types';
import { generateFixId } from './utils';

export class AutoFixerImpl implements AutoFixer {
  private activePatches: Map<string, any> = new Map();

  async applyFix(pattern: BugPattern): Promise<FixEvent> {
    const fixId = generateFixId();

    console.log(`[AutoFixer] Attempting fix ${fixId} using strategy: ${pattern.fix_strategy}`);

    const fixEvent: FixEvent = {
      fix_id: fixId,
      pattern_id: pattern.pattern_id,
      timestamp: Date.now(),
      strategy: pattern.fix_strategy,
      status: 'applied',
      test_results: []
    };

    try {
      switch (pattern.fix_strategy) {
        case 'try_catch_with_fallback':
          await this.tryCatchFallback(pattern.class);
          break;
        case 'monkey_patch_from_journal':
          await this.monkeyPatch(pattern);
          break;
        case 'component_restart':
          await this.restartComponent(pattern.class);
          break;
      }

      console.log(`[AutoFixer] Fix ${fixId} applied successfully`);
      return fixEvent;
    } catch (e) {
      console.error(`[AutoFixer] Fix ${fixId} failed:`, e);
      fixEvent.status = 'failed';
      return fixEvent;
    }
  }

  async tryCatchFallback(target: string): Promise<void> {
    console.log(`[AutoFixer] Applying try-catch fallback for ${target}`);

    try {
      const targetClass = Java.use(target);

      const methods = targetClass.$methods;

      for (const method of methods) {
        const methodName = method.split('-')[0];

        try {
          const overloads = targetClass[methodName].overloads;

          for (let i = 0; i < overloads.length; i++) {
            const original = overloads[i];
            const wrapped = function(...args: any[]) {
              try {
                return original.apply(this, args);
              } catch (e) {
                console.log(`[AutoFixer] Caught exception in ${target}.${methodName}: ${e}`);
                return this.createFallbackResult(methodName);
              }
            };

            targetClass[methodName].overload.apply(targetClass[methodName], overloads[i].descriptor.split(','))
              .implementation = wrapped;
          }
        } catch (e) {
          console.warn(`[AutoFixer] Could not wrap ${target}.${methodName}`, e);
        }
      }

      this.activePatches.set(target, { type: 'try_catch', target });
      console.log(`[AutoFixer] Try-catch fallback applied to ${target}`);
    } catch (e) {
      console.error(`[AutoFixer] Failed to apply try-catch fallback:`, e);
      throw e;
    }
  }

  async monkeyPatch(pattern: BugPattern): Promise<void> {
    console.log(
      `[AutoFixer] Applying monkey patch for ${pattern.class}.${pattern.method} ` +
      `(${pattern.exception_type})`
    );

    try {
      const targetClass = Java.use(pattern.class);
      const methodName = pattern.method;

      const originalMethod = targetClass[methodName];

      if (!originalMethod) {
        throw new Error(`Method ${methodName} not found in ${pattern.class}`);
      }

      const patchedMethod = function(...args: any[]) {
        console.log(`[AutoFixer] Executing patched version of ${pattern.class}.${methodName}`);

        if (pattern.exception_type === 'NullPointerException') {
          for (let i = 0; i < args.length; i++) {
            if (args[i] === null || args[i] === undefined) {
              console.log(`[AutoFixer] Null argument detected at index ${i}, using default value`);
              args[i] = this.getDefaultValue(args[i]);
            }
          }
        }

        try {
          return originalMethod.apply(this, args);
        } catch (e) {
          console.log(`[AutoFixer] Patched method caught exception: ${e}`);
          return this.createFallbackResult(methodName);
        }
      };

      targetClass[methodName].implementation = patchedMethod;

      this.activePatches.set(`${pattern.class}.${methodName}`, {
        type: 'monkey_patch',
        pattern
      });

      console.log(`[AutoFixer] Monkey patch applied to ${pattern.class}.${pattern.method}`);
    } catch (e) {
      console.error(`[AutoFixer] Failed to apply monkey patch:`, e);
      throw e;
    }
  }

  async restartComponent(class_name: string): Promise<void> {
    console.log(`[AutoFixer] Restarting component ${class_name}`);

    try {
      const activityManager = Java.use('android.app.ActivityManager');
      const context = Java.use('android.app.ActivityManagerNative').getDefault();

      if (class_name.includes('Activity')) {
        const activityClass = Java.use(class_name);
        const killBackgroundProcesses = context.killBackgroundProcesses;
        killBackgroundProcesses.call(context, Java.use('android.app.ContextImpl').getApplicationContext().getPackageName());

        console.log(`[AutoFixer] Restarted activity ${class_name}`);
      } else if (class_name.includes('Service')) {
        const am = context;
        const pkgName = Java.use('android.app.ContextImpl').getApplicationContext().getPackageName();
        am.forceStopPackage(pkgName);

        console.log(`[AutoFixer] Force stopped service ${class_name}`);
      }

      this.activePatches.set(class_name, {
        type: 'component_restart',
        class_name,
        restart_time: Date.now()
      });
    } catch (e) {
      console.error(`[AutoFixer] Failed to restart component:`, e);
      throw e;
    }
  }

  private getDefaultValue(original: any): any {
    if (original === null || original === undefined) {
      return '';
    }
    return original;
  }

  private createFallbackResult(methodName: string): any {
    return null;
  }

  getActivePatches(): Map<string, any> {
    return new Map(this.activePatches);
  }

  removePatch(patchId: string): void {
    this.activePatches.delete(patchId);
  }
}

export function createAutoFixer(): AutoFixer {
  return new AutoFixerImpl();
}

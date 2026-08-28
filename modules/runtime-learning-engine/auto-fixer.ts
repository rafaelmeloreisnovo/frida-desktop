import { BugPattern, FixEvent, AutoFixer, RollbackCapability } from './types';
import { generateFixId } from './utils';

interface ActivePatchRecord {
  fix_id: string;
  strategy: FixEvent['strategy'];
  target: string;
  rollback_capability: RollbackCapability;
  restore: Array<() => void>;
  created_at: number;
}

export class AutoFixerImpl implements AutoFixer {
  private activePatches: Map<string, ActivePatchRecord> = new Map();

  async applyFix(pattern: BugPattern): Promise<FixEvent> {
    const fixId = generateFixId();

    console.log(`[AutoFixer] Attempting fix ${fixId} using strategy: ${pattern.fix_strategy}`);

    const fixEvent: FixEvent = {
      fix_id: fixId,
      pattern_id: pattern.pattern_id,
      timestamp: Date.now(),
      strategy: pattern.fix_strategy,
      status: 'applied',
      test_results: [],
      rollback_capability: 'token_vazio',
      rollback_verified: false
    };

    try {
      switch (pattern.fix_strategy) {
        case 'try_catch_with_fallback':
          await this.tryCatchFallbackInternal(pattern.class, fixId, pattern.fix_strategy);
          fixEvent.rollback_capability = 'hook_restore';
          break;
        case 'monkey_patch_from_journal':
          await this.monkeyPatchInternal(pattern, fixId);
          fixEvent.rollback_capability = 'hook_restore';
          break;
        case 'component_restart':
          await this.restartComponent(pattern.class);
          this.activePatches.set(fixId, {
            fix_id: fixId,
            strategy: pattern.fix_strategy,
            target: pattern.class,
            rollback_capability: 'non_reversible',
            restore: [],
            created_at: Date.now()
          });
          fixEvent.rollback_capability = 'non_reversible';
          break;
      }

      console.log(`[AutoFixer] Fix ${fixId} applied successfully`);
      return fixEvent;
    } catch (e) {
      console.error(`[AutoFixer] Fix ${fixId} failed:`, e);
      fixEvent.status = 'failed';
      fixEvent.rollback_capability = 'token_vazio';
      return fixEvent;
    }
  }

  async tryCatchFallback(target: string): Promise<void> {
    const fixId = `manual_${generateFixId()}`;
    await this.tryCatchFallbackInternal(target, fixId, 'try_catch_with_fallback');
  }

  private async tryCatchFallbackInternal(
    target: string,
    fixId: string,
    strategy: FixEvent['strategy']
  ): Promise<void> {
    console.log(`[AutoFixer] Applying try-catch fallback for ${target}`);

    try {
      const targetClass = Java.use(target);
      const methods: string[] = Array.isArray(targetClass.$methods) ? targetClass.$methods : [];
      const restore: Array<() => void> = [];
      const seen = new Set<string>();
      const self = this;

      for (const methodDescriptor of methods) {
        const methodName = String(methodDescriptor).split('-')[0];
        if (!methodName || seen.has(methodName)) continue;
        seen.add(methodName);

        const method = targetClass[methodName];
        const overloads: any[] = method?.overloads || [];

        for (const overload of overloads) {
          const previousImplementation = overload.implementation;
          const returnType = self.getFridaTypeName(overload.returnType);
          const wrapped = function(this: any, ...args: any[]) {
            try {
              return overload.apply(this, args);
            } catch (e) {
              console.log(`[AutoFixer] Caught exception in ${target}.${methodName}: ${e}`);
              return self.defaultValueForType(returnType);
            }
          };

          overload.implementation = wrapped;
          restore.push(() => {
            overload.implementation = previousImplementation;
          });
        }
      }

      if (restore.length === 0) {
        throw new Error(`No hookable overloads found for ${target}`);
      }

      this.activePatches.set(fixId, {
        fix_id: fixId,
        strategy,
        target,
        rollback_capability: 'hook_restore',
        restore,
        created_at: Date.now()
      });
      console.log(`[AutoFixer] Try-catch fallback applied to ${target}; reversible hooks=${restore.length}`);
    } catch (e) {
      const errorContext = `Failed to apply try-catch fallback to ${target}: ${e}`;
      console.error(`[AutoFixer] ${errorContext}`);
      throw new Error(errorContext);
    }
  }

  async monkeyPatch(pattern: BugPattern): Promise<void> {
    const fixId = `manual_${generateFixId()}`;
    await this.monkeyPatchInternal(pattern, fixId);
  }

  private async monkeyPatchInternal(pattern: BugPattern, fixId: string): Promise<void> {
    console.log(
      `[AutoFixer] Applying monkey patch for ${pattern.class}.${pattern.method} ` +
      `(${pattern.exception_type})`
    );

    try {
      const targetClass = Java.use(pattern.class);
      const methodName = pattern.method;
      const method = targetClass[methodName];

      if (!method) {
        throw new Error(`Method ${methodName} not found in ${pattern.class}`);
      }

      const overloads: any[] = method.overloads?.length ? method.overloads : [method];
      const restore: Array<() => void> = [];
      const self = this;

      for (const overload of overloads) {
        const previousImplementation = overload.implementation;
        const argumentTypes: string[] = (overload.argumentTypes || []).map((t: any) => self.getFridaTypeName(t));
        const returnType = self.getFridaTypeName(overload.returnType);

        const patchedMethod = function(this: any, ...args: any[]) {
          console.log(`[AutoFixer] Executing patched version of ${pattern.class}.${methodName}`);

          if (pattern.exception_type === 'NullPointerException') {
            for (let i = 0; i < args.length; i++) {
              if (args[i] === null || args[i] === undefined) {
                const replacement = self.defaultArgumentForType(argumentTypes[i]);
                if (replacement.supported) {
                  console.log(`[AutoFixer] Null primitive argument at index ${i}; applying typed default`);
                  args[i] = replacement.value;
                } else {
                  console.warn(
                    `[AutoFixer] Null reference argument at index ${i} cannot be safely synthesized; preserving null`
                  );
                }
              }
            }
          }

          try {
            return overload.apply(this, args);
          } catch (e) {
            console.log(`[AutoFixer] Patched method caught exception: ${e}`);
            return self.defaultValueForType(returnType);
          }
        };

        overload.implementation = patchedMethod;
        restore.push(() => {
          overload.implementation = previousImplementation;
        });
      }

      if (restore.length === 0) {
        throw new Error(`No hookable overloads found for ${pattern.class}.${methodName}`);
      }

      this.activePatches.set(fixId, {
        fix_id: fixId,
        strategy: pattern.fix_strategy,
        target: `${pattern.class}.${methodName}`,
        rollback_capability: 'hook_restore',
        restore,
        created_at: Date.now()
      });

      console.log(
        `[AutoFixer] Monkey patch applied to ${pattern.class}.${pattern.method}; reversible hooks=${restore.length}`
      );
    } catch (e) {
      const errorContext = `Failed to apply monkey patch to ${pattern.class}.${pattern.method} (pattern ${pattern.pattern_id}): ${e}`;
      console.error(`[AutoFixer] ${errorContext}`);
      throw new Error(errorContext);
    }
  }

  async restartComponent(class_name: string): Promise<void> {
    console.log(`[AutoFixer] Restarting component ${class_name}`);

    try {
      const context = Java.use('android.app.ActivityManagerNative').getDefault();

      if (class_name.includes('Activity')) {
        const packageName = Java.use('android.app.ContextImpl').getApplicationContext().getPackageName();
        context.killBackgroundProcesses(packageName);
        console.log(`[AutoFixer] Requested activity process restart for ${class_name}`);
      } else if (class_name.includes('Service')) {
        const packageName = Java.use('android.app.ContextImpl').getApplicationContext().getPackageName();
        context.forceStopPackage(packageName);
        console.log(`[AutoFixer] Requested service process stop for ${class_name}`);
      } else {
        throw new Error(`Unsupported component type for restart: ${class_name}`);
      }
    } catch (e) {
      const errorContext = `Failed to restart component ${class_name}: ${e}`;
      console.error(`[AutoFixer] ${errorContext}`);
      throw new Error(errorContext);
    }
  }

  canRollbackFix(fixId: string): boolean {
    const patch = this.activePatches.get(fixId);
    return Boolean(patch && patch.rollback_capability === 'hook_restore' && patch.restore.length > 0);
  }

  async rollbackFix(fixId: string): Promise<boolean> {
    const patch = this.activePatches.get(fixId);
    if (!patch) {
      console.warn(`[AutoFixer] No active patch found for ${fixId}; rollback evidence is TOKEN_VAZIO`);
      return false;
    }

    if (patch.rollback_capability !== 'hook_restore' || patch.restore.length === 0) {
      console.error(
        `[AutoFixer] Fix ${fixId} is ${patch.rollback_capability}; automatic rollback is not verified or supported`
      );
      return false;
    }

    let success = true;
    for (const restore of [...patch.restore].reverse()) {
      try {
        restore();
      } catch (e) {
        success = false;
        console.error(`[AutoFixer] Failed restoring hook for ${fixId}:`, e);
      }
    }

    if (success) {
      this.activePatches.delete(fixId);
      console.log(`[AutoFixer] Rollback verified by hook restoration for ${fixId}`);
    }

    return success;
  }

  private getFridaTypeName(type: any): string {
    if (!type) return 'unknown';
    return String(type.className || type.type || type.name || type);
  }

  private defaultArgumentForType(typeName: string | undefined): { supported: boolean; value: any } {
    const normalized = (typeName || '').toLowerCase();
    if (normalized === 'boolean') return { supported: true, value: false };
    if (['byte', 'short', 'int', 'long', 'float', 'double'].includes(normalized)) {
      return { supported: true, value: 0 };
    }
    if (normalized === 'char') return { supported: true, value: '\u0000' };
    return { supported: false, value: null };
  }

  private defaultValueForType(typeName: string | undefined): any {
    const normalized = (typeName || '').toLowerCase();
    if (normalized === 'void') return undefined;
    if (normalized === 'boolean') return false;
    if (['byte', 'short', 'int', 'long', 'float', 'double'].includes(normalized)) return 0;
    if (normalized === 'char') return '\u0000';
    if (normalized === 'java.lang.string' || normalized === 'string') return '';
    return null;
  }

  getActivePatches(): Map<string, any> {
    return new Map(this.activePatches);
  }

  removePatch(patchId: string): void {
    const patch = this.activePatches.get(patchId);
    if (!patch) return;

    if (patch.rollback_capability === 'hook_restore') {
      for (const restore of [...patch.restore].reverse()) {
        restore();
      }
    }
    this.activePatches.delete(patchId);
  }
}

export function createAutoFixer(): AutoFixer {
  return new AutoFixerImpl();
}

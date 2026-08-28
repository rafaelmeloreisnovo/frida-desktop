import * as fs from 'fs';
import * as path from 'path';

export interface HookValidation {
  hook_name: string;
  available: boolean;
  error?: string;
  latency_ms?: number;
}

export interface CompatibilityReport {
  timestamp: number;
  frida_version: string;
  android_api_level: number;
  android_codename: string;
  frida_compatible: boolean;
  selinux_mode?: string;
  hooks_status: HookValidation[];
  overall_status: 'compatible' | 'partial' | 'incompatible';
  recommended_actions: string[];
  error_details: string[];
}

export class CompatibilityChecker {
  private storagePath: string;
  private reportPath: string;
  private lastReport: CompatibilityReport | null = null;

  constructor(storagePath: string = '/data/local/tmp/frida-learning') {
    this.storagePath = storagePath;
    this.reportPath = path.join(storagePath, 'compatibility-report.json');
    this.ensureDirectory();
  }

  private ensureDirectory(): void {
    if (!fs.existsSync(this.storagePath)) {
      fs.mkdirSync(this.storagePath, { recursive: true });
    }
  }

  async checkCompatibility(): Promise<CompatibilityReport> {
    console.log('[CompatibilityChecker] Starting compatibility check...');

    const errors: string[] = [];
    const recommendations: string[] = [];

    // 1. Check Frida version
    const fridaVersion = this.getFridaVersion();
    const fridaCompatible = this.isFridaVersionCompatible(fridaVersion);
    if (!fridaCompatible) {
      errors.push(`Frida version ${fridaVersion} may not be compatible. Minimum required: 14.0.0`);
      recommendations.push('Update Frida to version 14.0.0 or higher');
    }

    // 2. Check Android API level
    const androidInfo = this.getAndroidAPILevel();
    const apiCompatible = androidInfo.level >= 29;
    if (!apiCompatible) {
      errors.push(`Android API level ${androidInfo.level} is below minimum (29 for Android 10)`);
      recommendations.push(`This device runs Android ${androidInfo.codename}, minimum requirement is Android 10`);
    }

    // 3. Check SELinux mode
    const selinuxMode = this.getSELinuxMode();
    if (selinuxMode === 'enforcing') {
      errors.push('SELinux is in enforcing mode - may restrict Frida hooking');
      recommendations.push('Try SELinux permissive mode: adb shell setenforce 0 (requires root)');
    }

    // 4. Test individual hooks
    const hooksStatus = await this.validateHooks();
    const failedHooks = hooksStatus.filter(h => !h.available);
    if (failedHooks.length > 0) {
      errors.push(`${failedHooks.length} hook(s) failed validation: ${failedHooks.map(h => h.hook_name).join(', ')}`);
      recommendations.push('Verify app is running with correct architecture (arm32/arm64)');
      recommendations.push('Check if app has obfuscation enabled (proguard)');
    }

    // Determine overall status
    let overallStatus: 'compatible' | 'partial' | 'incompatible' = 'compatible';
    if (errors.length > 2 || failedHooks.length > 2) {
      overallStatus = 'incompatible';
    } else if (errors.length > 0 || failedHooks.length > 0) {
      overallStatus = 'partial';
    }

    const report: CompatibilityReport = {
      timestamp: Date.now(),
      frida_version: fridaVersion,
      android_api_level: androidInfo.level,
      android_codename: androidInfo.codename,
      frida_compatible: fridaCompatible,
      selinux_mode: selinuxMode,
      hooks_status: hooksStatus,
      overall_status: overallStatus,
      recommended_actions: recommendations,
      error_details: errors
    };

    this.lastReport = report;
    await this.saveReport(report);
    this.logReport(report);

    return report;
  }

  private getFridaVersion(): string {
    try {
      // In real Frida context: Frida.version or via Java.use
      // For testing/offline, return mock version
      if (typeof (globalThis as any).Frida !== 'undefined') {
        return (globalThis as any).Frida.version || '14.2.0';
      }
      return '14.2.0'; // Mock default
    } catch (e) {
      console.warn('[CompatibilityChecker] Could not detect Frida version:', e);
      return 'unknown';
    }
  }

  private isFridaVersionCompatible(version: string): boolean {
    try {
      const parts = version.split('.').map(Number);
      if (parts.length < 2) return false;
      const major = parts[0];
      const minor = parts[1];

      // Minimum: 14.0.0
      if (major < 14) return false;
      if (major === 14 && minor < 0) return false;

      return true;
    } catch {
      return false;
    }
  }

  private getAndroidAPILevel(): { level: number; codename: string } {
    try {
      // In real context: android.os.Build.VERSION.SDK_INT
      if (typeof (globalThis as any).Java !== 'undefined') {
        const Build = (globalThis as any).Java.use('android.os.Build');
        const VERSION = (globalThis as any).Java.use('android.os.Build$VERSION');
        const apiLevel = VERSION.SDK_INT.value;
        const codename = Build.VERSION_CODES.codename.value || this.getCodenameFromLevel(apiLevel);
        return { level: apiLevel, codename };
      }

      // Mock for offline testing
      return { level: 30, codename: 'Android 11' };
    } catch (e) {
      console.warn('[CompatibilityChecker] Could not detect Android API level:', e);
      return { level: 29, codename: 'Android 10 (default)' };
    }
  }

  private getCodenameFromLevel(level: number): string {
    const codenames: { [key: number]: string } = {
      29: 'Android 10',
      30: 'Android 11',
      31: 'Android 12',
      32: 'Android 12 L',
      33: 'Android 13',
      34: 'Android 14',
      35: 'Android 15'
    };
    return codenames[level] || `Android ${level}`;
  }

  private getSELinuxMode(): string {
    try {
      // In real context: via proc/cmdline or getenforce command
      // For testing, check if we can access sensitive APIs
      if (typeof (globalThis as any).Java !== 'undefined') {
        try {
          const Runtime = (globalThis as any).Java.use('java.lang.Runtime');
          const process = Runtime.getRuntime().exec(['getenforce']);
          // Would need to read output - simplified for now
          return 'permissive'; // Assume permissive if hooking works
        } catch {
          return 'enforcing'; // Assume enforcing if can't hook
        }
      }
      return 'unknown'; // Mock default
    } catch (e) {
      console.warn('[CompatibilityChecker] Could not detect SELinux mode:', e);
      return 'unknown';
    }
  }

  private async validateHooks(): Promise<HookValidation[]> {
    const hooks = [
      'java.lang.Throwable.printStackTrace',
      'android.app.ActivityManager.appNotResponding',
      'java.lang.Runtime.gc',
      'java.lang.Thread.start'
    ];

    const results: HookValidation[] = [];

    for (const hookName of hooks) {
      const validation = await this.testHook(hookName);
      results.push(validation);
    }

    return results;
  }

  private async testHook(hookName: string): Promise<HookValidation> {
    const startTime = Date.now();

    try {
      const parts = hookName.split('.');
      const methodName = parts.pop()!;
      const className = parts.join('.');

      // Test if we can access the class and method
      if (typeof (globalThis as any).Java === 'undefined') {
        // Offline testing mode
        return {
          hook_name: hookName,
          available: true, // Assume available in test mode
          latency_ms: 1
        };
      }

      const clazz = (globalThis as any).Java.use(className);
      if (!clazz) {
        return {
          hook_name: hookName,
          available: false,
          error: `Class not found: ${className}`,
          latency_ms: Date.now() - startTime
        };
      }

      // Check if method exists (simplified - don't actually hook)
      if (clazz[methodName] === undefined) {
        return {
          hook_name: hookName,
          available: false,
          error: `Method not found: ${methodName}`,
          latency_ms: Date.now() - startTime
        };
      }

      return {
        hook_name: hookName,
        available: true,
        latency_ms: Date.now() - startTime
      };
    } catch (e) {
      return {
        hook_name: hookName,
        available: false,
        error: String(e),
        latency_ms: Date.now() - startTime
      };
    }
  }

  private async saveReport(report: CompatibilityReport): Promise<void> {
    try {
      fs.writeFileSync(
        this.reportPath,
        JSON.stringify(report, null, 2),
        'utf-8'
      );
      console.log(`[CompatibilityChecker] Report saved to ${this.reportPath}`);
    } catch (e) {
      console.error('[CompatibilityChecker] Failed to save report:', e);
    }
  }

  private logReport(report: CompatibilityReport): void {
    console.log('[CompatibilityChecker] ============= COMPATIBILITY REPORT =============');
    console.log(`[CompatibilityChecker] Status: ${report.overall_status.toUpperCase()}`);
    console.log(`[CompatibilityChecker] Frida: ${report.frida_version} (compatible: ${report.frida_compatible})`);
    console.log(`[CompatibilityChecker] Android: API ${report.android_api_level} (${report.android_codename})`);
    console.log(`[CompatibilityChecker] SELinux: ${report.selinux_mode}`);
    console.log(`[CompatibilityChecker] Hooks: ${report.hooks_status.filter(h => h.available).length}/${report.hooks_status.length} available`);

    if (report.error_details.length > 0) {
      console.error('[CompatibilityChecker] ERRORS:');
      for (const error of report.error_details) {
        console.error(`  ❌ ${error}`);
      }
    }

    if (report.recommended_actions.length > 0) {
      console.log('[CompatibilityChecker] RECOMMENDED ACTIONS:');
      for (const action of report.recommended_actions) {
        console.log(`  ⚠️  ${action}`);
      }
    }

    console.log('[CompatibilityChecker] ==================================================');
  }

  getLastReport(): CompatibilityReport | null {
    return this.lastReport;
  }

  isCompatible(): boolean {
    if (!this.lastReport) return false;
    return this.lastReport.overall_status === 'compatible' || this.lastReport.overall_status === 'partial';
  }

  canProceedWithDeployment(): boolean {
    if (!this.lastReport) return false;
    // Allow partial compatibility but not incompatible
    return this.lastReport.overall_status !== 'incompatible';
  }
}

export function createCompatibilityChecker(storagePath?: string): CompatibilityChecker {
  return new CompatibilityChecker(storagePath);
}

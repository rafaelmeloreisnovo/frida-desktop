import {
  CompatibilityChecker,
  CompatibilityReport
} from '../compatibility-checker';
import {
  setupFridaMock,
  teardownFridaMock,
  MockFrida,
  MockAndroidBuild,
  MockSELinux
} from '../test-utils/frida-mock';
import * as fs from 'fs';
import * as path from 'path';

describe('CompatibilityChecker', () => {
  let checker: CompatibilityChecker;
  const testDir = '/tmp/test-frida-compat';

  beforeEach(() => {
    setupFridaMock();
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    checker = new CompatibilityChecker(testDir);
  });

  afterEach(() => {
    teardownFridaMock();
    // Cleanup test files
    if (fs.existsSync(testDir)) {
      const files = fs.readdirSync(testDir);
      for (const file of files) {
        fs.unlinkSync(path.join(testDir, file));
      }
      fs.rmdirSync(testDir);
    }
  });

  test('Checker initializes successfully', () => {
    expect(checker).toBeDefined();
  });

  test('Compatible environment reports as compatible', async () => {
    const report = await checker.checkCompatibility();

    expect(report).toBeDefined();
    expect(report.overall_status).toBe('compatible');
    expect(report.frida_compatible).toBe(true);
    expect(report.android_api_level).toBeGreaterThanOrEqual(29);
  });

  test('Saves report to file', async () => {
    const report = await checker.checkCompatibility();

    const reportPath = path.join(testDir, 'compatibility-report.json');
    expect(fs.existsSync(reportPath)).toBe(true);

    const saved = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
    expect(saved.timestamp).toEqual(report.timestamp);
    expect(saved.frida_version).toEqual(report.frida_version);
  });

  test('Can determine deployment readiness', async () => {
    const report = await checker.checkCompatibility();
    const canDeploy = checker.canProceedWithDeployment();

    expect(canDeploy).toBe(
      report.overall_status !== 'incompatible'
    );
  });

  test('Validates all 4 critical hooks', async () => {
    const report = await checker.checkCompatibility();

    const hookNames = report.hooks_status.map(h => h.hook_name);
    expect(hookNames).toContain('java.lang.Throwable.printStackTrace');
    expect(hookNames).toContain('android.app.ActivityManager.appNotResponding');
    expect(hookNames).toContain('java.lang.Runtime.gc');
    expect(hookNames).toContain('java.lang.Thread.start');
  });

  test('Detects Frida version', async () => {
    const report = await checker.checkCompatibility();

    expect(report.frida_version).toBeDefined();
    expect(report.frida_version).not.toBe('unknown');
  });

  test('Detects Android API level', async () => {
    const report = await checker.checkCompatibility();

    expect(report.android_api_level).toBeGreaterThanOrEqual(29);
    expect(report.android_codename).toBeDefined();
  });

  test('Detects SELinux mode', async () => {
    const report = await checker.checkCompatibility();

    expect(report.selinux_mode).toBeDefined();
    expect(['enforcing', 'permissive', 'disabled', 'unknown']).toContain(
      report.selinux_mode
    );
  });

  test('Provides recommendations when issues detected', async () => {
    // This would require mocking incompatible conditions
    // For now, just verify that recommendations structure exists
    const report = await checker.checkCompatibility();

    expect(Array.isArray(report.recommended_actions)).toBe(true);
    // Recommendations may or may not be empty depending on environment
  });

  test('Tracks last report', async () => {
    const report = await checker.checkCompatibility();

    const lastReport = checker.getLastReport();
    expect(lastReport).toEqual(report);
  });

  test('isCompatible() reflects overall status', async () => {
    const report = await checker.checkCompatibility();
    const isCompatible = checker.isCompatible();

    expect(isCompatible).toBe(
      report.overall_status === 'compatible' ||
      report.overall_status === 'partial'
    );
  });

  test('Report contains all required fields', async () => {
    const report = await checker.checkCompatibility();

    expect(report).toHaveProperty('timestamp');
    expect(report).toHaveProperty('frida_version');
    expect(report).toHaveProperty('android_api_level');
    expect(report).toHaveProperty('android_codename');
    expect(report).toHaveProperty('frida_compatible');
    expect(report).toHaveProperty('selinux_mode');
    expect(report).toHaveProperty('hooks_status');
    expect(report).toHaveProperty('overall_status');
    expect(report).toHaveProperty('recommended_actions');
    expect(report).toHaveProperty('error_details');
  });

  test('Hook validation includes latency measurement', async () => {
    const report = await checker.checkCompatibility();

    for (const hook of report.hooks_status) {
      expect(hook).toHaveProperty('hook_name');
      expect(hook).toHaveProperty('available');
      if (hook.available) {
        expect(hook.latency_ms).toBeDefined();
        expect(hook.latency_ms).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('Multiple checks generate separate timestamps', async () => {
    const report1 = await checker.checkCompatibility();
    await new Promise(resolve => setTimeout(resolve, 10));
    const report2 = await checker.checkCompatibility();

    expect(report2.timestamp).toBeGreaterThan(report1.timestamp);
  });
});

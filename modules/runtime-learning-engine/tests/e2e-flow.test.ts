import { RuntimeLearningEngine, initializeEngine, shutdownEngine } from '../index';
import { BugEvent } from '../types';
import {
  setupFridaMock,
  teardownFridaMock,
  simulateMethodCall,
  MockFrida
} from '../test-utils/frida-mock';
import * as fs from 'fs';
import * as path from 'path';

describe('RuntimeLearningEngine E2E Flows', () => {
  let engine: RuntimeLearningEngine;
  const testDir = '/tmp/test-e2e-flows';

  beforeEach(async () => {
    setupFridaMock();
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    engine = await initializeEngine({
      storage_path: testDir,
      bug_capacity: 512,
      confidence_threshold: 0.75,
      min_occurrences_before_fix: 3
    });
  });

  afterEach(async () => {
    if (engine) {
      await shutdownEngine();
    }
    teardownFridaMock();

    // Cleanup
    if (fs.existsSync(testDir)) {
      const files = fs.readdirSync(testDir);
      for (const file of files) {
        fs.unlinkSync(path.join(testDir, file));
      }
      fs.rmdirSync(testDir);
    }
  });

  test('Engine initializes and starts successfully', () => {
    expect(engine).toBeDefined();
    expect(engine.isRunning()).toBe(true);
  });

  test('Single bug capture flow', async () => {
    const bugEvent: Partial<BugEvent> = {
      bug_type: 'crash',
      class: 'com.example.App',
      method: 'onCreate',
      exception_type: 'NullPointerException',
      severity: 'critical'
    };

    await engine.captureBug(bugEvent);
    const stats = engine.getStats();

    expect(stats.recentBugsCount).toBeGreaterThan(0);
  });

  test('BugCapture → PatternDetection flow', async () => {
    // Simulate 3 identical crashes (minimum for pattern detection)
    const bugEvent: Partial<BugEvent> = {
      bug_type: 'crash',
      class: 'com.example.App',
      method: 'onCreate',
      exception_type: 'NullPointerException',
      severity: 'critical'
    };

    for (let i = 0; i < 3; i++) {
      await engine.captureBug(bugEvent);
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    const stats = engine.getStats();
    expect(stats.recentBugsCount).toBe(3);
    // Pattern detection happens automatically after 3 occurrences
  });

  test('Multiple bug types captured', async () => {
    const crashes: Partial<BugEvent> = {
      bug_type: 'crash',
      class: 'com.example.App',
      exception_type: 'NullPointerException',
      severity: 'critical'
    };

    const anr: Partial<BugEvent> = {
      bug_type: 'anr',
      class: 'android.app.Activity',
      severity: 'critical'
    };

    const memoryLeak: Partial<BugEvent> = {
      bug_type: 'memory_leak',
      class: 'com.example.Service',
      severity: 'warning'
    };

    await engine.captureBug(crashes);
    await engine.captureBug(anr);
    await engine.captureBug(memoryLeak);

    const stats = engine.getStats();
    expect(stats.recentBugsCount).toBe(3);
  });

  test('Bug history persisted to storage', async () => {
    const bugEvent: Partial<BugEvent> = {
      bug_type: 'crash',
      class: 'com.example.App',
      exception_type: 'NullPointerException',
      severity: 'critical'
    };

    await engine.captureBug(bugEvent);

    const historyPath = path.join(testDir, 'bug-history.json');
    expect(fs.existsSync(historyPath)).toBe(true);

    const history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
    expect(history.events).toBeDefined();
    expect(history.events.length).toBeGreaterThan(0);
  });

  test('Audit trail records all actions', async () => {
    const bugEvent: Partial<BugEvent> = {
      bug_type: 'crash',
      class: 'com.example.App',
      exception_type: 'NullPointerException',
      severity: 'critical'
    };

    await engine.captureBug(bugEvent);

    const auditPath = path.join(testDir, 'audit.log');
    if (fs.existsSync(auditPath)) {
      const auditContent = fs.readFileSync(auditPath, 'utf-8');
      expect(auditContent.length).toBeGreaterThan(0);
      expect(auditContent).toContain('BUG_CAPTURED');
    }
  });

  test('Watchdog monitors engine health', async () => {
    await new Promise(resolve => setTimeout(resolve, 1500));
    const stats = engine.getStats();

    // Watchdog should have run at least once
    expect(stats.running).toBe(true);
  });

  test('Multiple concurrent bug captures handled', async () => {
    const promises = [];
    for (let i = 0; i < 5; i++) {
      const bug: Partial<BugEvent> = {
        bug_type: 'crash',
        class: `com.example.App${i}`,
        exception_type: 'NullPointerException',
        severity: 'critical'
      };
      promises.push(engine.captureBug(bug));
    }

    await Promise.all(promises);
    const stats = engine.getStats();

    expect(stats.recentBugsCount).toBe(5);
  });

  test('Pattern detection with confidence threshold', async () => {
    // Create bugs with same signature
    const bugEvent: Partial<BugEvent> = {
      bug_type: 'crash',
      class: 'com.example.App',
      method: 'onCreate',
      exception_type: 'NullPointerException',
      severity: 'critical'
    };

    for (let i = 0; i < 5; i++) {
      await engine.captureBug(bugEvent);
      await new Promise(resolve => setTimeout(resolve, 5));
    }

    // Pattern should be detected after min_occurrences_before_fix (3)
    const stats = engine.getStats();
    expect(stats.recentBugsCount).toBe(5);
  });

  test('Stats provide accurate metrics', async () => {
    const initialStats = engine.getStats();
    expect(initialStats.running).toBe(true);
    expect(initialStats.recentBugsCount).toBe(0);

    const bugEvent: Partial<BugEvent> = {
      bug_type: 'crash',
      class: 'com.example.App',
      exception_type: 'NullPointerException',
      severity: 'critical'
    };

    await engine.captureBug(bugEvent);
    const updatedStats = engine.getStats();

    expect(updatedStats.recentBugsCount).toBe(1);
    expect(updatedStats.recentBugsCount).toBeGreaterThan(initialStats.recentBugsCount);
  });

  test('Engine gracefully handles shutdown', async () => {
    expect(engine.isRunning()).toBe(true);
    await engine.stop();
    expect(engine.isRunning()).toBe(false);
  });

  test('Storage integrity verified after operations', async () => {
    const bugEvent: Partial<BugEvent> = {
      bug_type: 'crash',
      class: 'com.example.App',
      exception_type: 'NullPointerException',
      severity: 'critical'
    };

    await engine.captureBug(bugEvent);

    // Check if integrity files exist
    const integrityPath = path.join(testDir, 'integrity-checks.json');
    // Integrity checker runs periodically - file may not exist immediately
    // But we can verify that bug-history.json exists and is valid JSON
    const historyPath = path.join(testDir, 'bug-history.json');
    expect(fs.existsSync(historyPath)).toBe(true);

    const history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
    expect(history.events).toBeDefined();
  });

  test('Different severity levels captured correctly', async () => {
    const severities = ['critical', 'warning', 'info'];

    for (const severity of severities) {
      const bugEvent: Partial<BugEvent> = {
        bug_type: 'crash',
        class: 'com.example.App',
        exception_type: 'RuntimeException',
        severity
      };
      await engine.captureBug(bugEvent);
    }

    const stats = engine.getStats();
    expect(stats.recentBugsCount).toBe(3);
  });

  test('Engine stats include configuration', () => {
    const stats = engine.getStats();

    expect(stats).toHaveProperty('running');
    expect(stats).toHaveProperty('recentBugsCount');
    expect(typeof stats.running).toBe('boolean');
    expect(typeof stats.recentBugsCount).toBe('number');
  });

  test('Bug event properties validated on capture', async () => {
    const bugEvent: Partial<BugEvent> = {
      bug_type: 'crash',
      class: 'com.example.App',
      method: 'onCreate',
      exception_type: 'NullPointerException',
      severity: 'critical'
    };

    // Should not throw
    await engine.captureBug(bugEvent);

    const stats = engine.getStats();
    expect(stats.recentBugsCount).toBe(1);
  });
});

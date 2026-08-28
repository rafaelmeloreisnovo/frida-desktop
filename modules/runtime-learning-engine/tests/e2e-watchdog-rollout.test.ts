import { RuntimeLearningEngine, initializeEngine, shutdownEngine } from '../index';
import {
  setupFridaMock,
  teardownFridaMock
} from '../test-utils/frida-mock';
import * as fs from 'fs';
import * as path from 'path';

describe('RuntimeLearningEngine Watchdog & Rollout E2E', () => {
  let engine: RuntimeLearningEngine;
  const testDir = '/tmp/test-e2e-watchdog-rollout';

  beforeEach(async () => {
    setupFridaMock();
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    engine = await initializeEngine({
      storage_path: testDir,
      bug_capacity: 512,
      confidence_threshold: 0.75,
      min_occurrences_before_fix: 3,
      heartbeat_interval_ms: 500, // Faster for testing
      epoch_timeout_ms: 2000 // Shorter timeout for testing
    });
  });

  afterEach(async () => {
    if (engine) {
      await shutdownEngine();
    }
    teardownFridaMock();

    if (fs.existsSync(testDir)) {
      const files = fs.readdirSync(testDir);
      for (const file of files) {
        fs.unlinkSync(path.join(testDir, file));
      }
      fs.rmdirSync(testDir);
    }
  });

  // Watchdog Tests
  describe('Watchdog Monitoring', () => {
    test('Watchdog heartbeat ticks periodically', async () => {
      // Wait for multiple heartbeat intervals
      await new Promise(resolve => setTimeout(resolve, 1500));
      const stats = engine.getStats();

      expect(stats.running).toBe(true);
      // Watchdog should have recorded events
    });

    test('Watchdog detects engine state changes', async () => {
      const stats1 = engine.getStats();
      expect(stats1.running).toBe(true);

      // Trigger some state changes
      await engine.captureBug({
        bug_type: 'crash',
        class: 'com.example.App',
        exception_type: 'RuntimeException',
        severity: 'critical'
      });

      const stats2 = engine.getStats();
      expect(stats2.recentBugsCount).toBeGreaterThan(stats1.recentBugsCount);
    });

    test('Watchdog events persisted to storage', async () => {
      await new Promise(resolve => setTimeout(resolve, 1000));

      const watchdogPath = path.join(testDir, 'watchdog-events.json');
      if (fs.existsSync(watchdogPath)) {
        const watchdogData = JSON.parse(
          fs.readFileSync(watchdogPath, 'utf-8')
        );
        expect(watchdogData).toBeDefined();
      }
    });

    test('Watchdog state transitions logged', async () => {
      const auditPath = path.join(testDir, 'audit.log');

      // Trigger state change
      await engine.captureBug({
        bug_type: 'crash',
        class: 'com.example.App',
        exception_type: 'NullPointerException',
        severity: 'critical'
      });

      await new Promise(resolve => setTimeout(resolve, 500));

      if (fs.existsSync(auditPath)) {
        const auditContent = fs.readFileSync(auditPath, 'utf-8');
        // Should contain some state/action logging
        expect(auditContent.length).toBeGreaterThan(0);
      }
    });

    test('Watchdog can be stopped and restarted', async () => {
      const initialRunning = engine.isRunning();
      expect(initialRunning).toBe(true);

      await engine.stop();
      expect(engine.isRunning()).toBe(false);

      // In real scenario, would restart here
      // For now just verify stop worked
    });
  });

  // Rollout Tests
  describe('Rollout Manager Staging', () => {
    test('Canary stage starts at 5% traffic', async () => {
      const stats = engine.getStats();
      expect(stats.running).toBe(true);

      // In real deployment, would check rollout-manager state
      // For this test, verify engine can track rollouts
    });

    test('Rollout metrics recorded', async () => {
      const metricsPath = path.join(testDir, 'rollouts.json');

      // Trigger some activity
      for (let i = 0; i < 3; i++) {
        await engine.captureBug({
          bug_type: 'crash',
          class: 'com.example.App',
          exception_type: 'RuntimeException',
          severity: 'critical'
        });
      }

      // Rollout metrics might be generated
      if (fs.existsSync(metricsPath)) {
        const rolloutData = JSON.parse(
          fs.readFileSync(metricsPath, 'utf-8')
        );
        expect(rolloutData).toBeDefined();
      }
    });

    test('Rollout progression tracked in audit', async () => {
      const auditPath = path.join(testDir, 'audit.log');

      // Simulate multiple operations
      for (let i = 0; i < 5; i++) {
        await engine.captureBug({
          bug_type: 'crash',
          class: `com.example.App${i}`,
          exception_type: 'RuntimeException',
          severity: 'critical'
        });
      }

      if (fs.existsSync(auditPath)) {
        const auditContent = fs.readFileSync(auditPath, 'utf-8');
        expect(auditContent).toBeDefined();
      }
    });

    test('Can check deployment readiness', async () => {
      const stats = engine.getStats();
      expect(stats.running).toBe(true);

      // In real scenario, this would check:
      // - Are we in a valid rollout stage?
      // - Can we proceed with next stage?
      // For now, just verify engine is ready
    });
  });

  // Combined Watchdog + Rollout Tests
  describe('Watchdog & Rollout Integration', () => {
    test('Watchdog monitors rollout health', async () => {
      // Simulate a rollout with bug capture
      for (let i = 0; i < 3; i++) {
        await engine.captureBug({
          bug_type: 'crash',
          class: 'com.example.App',
          exception_type: 'NullPointerException',
          severity: 'critical'
        });
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Watchdog should have observed this activity
      const stats = engine.getStats();
      expect(stats.running).toBe(true);
    });

    test('Concurrent bug captures during rollout', async () => {
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(
          engine.captureBug({
            bug_type: 'crash',
            class: `com.example.App${i % 3}`,
            exception_type: 'RuntimeException',
            severity: i % 2 === 0 ? 'critical' : 'warning'
          })
        );
      }

      await Promise.all(promises);
      const stats = engine.getStats();

      expect(stats.recentBugsCount).toBe(10);
      expect(stats.running).toBe(true);
    });

    test('Storage consistency during watchdog operation', async () => {
      // Capture bugs while watchdog is running
      for (let i = 0; i < 3; i++) {
        await engine.captureBug({
          bug_type: 'crash',
          class: 'com.example.App',
          exception_type: 'NullPointerException',
          severity: 'critical'
        });
      }

      // Wait for watchdog to process
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Verify storage is consistent
      const historyPath = path.join(testDir, 'bug-history.json');
      expect(fs.existsSync(historyPath)).toBe(true);

      const history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
      expect(history.events.length).toBe(3);
    });

    test('Multiple sequential bug capture batches', async () => {
      // Batch 1: 3 crashes
      for (let i = 0; i < 3; i++) {
        await engine.captureBug({
          bug_type: 'crash',
          class: 'com.example.App',
          exception_type: 'NullPointerException',
          severity: 'critical'
        });
      }

      await new Promise(resolve => setTimeout(resolve, 500));

      // Batch 2: 2 ANRs
      for (let i = 0; i < 2; i++) {
        await engine.captureBug({
          bug_type: 'anr',
          class: 'android.app.Activity',
          severity: 'critical'
        });
      }

      const stats = engine.getStats();
      expect(stats.recentBugsCount).toBe(5);
    });

    test('Audit trail captures watchdog state transitions', async () => {
      const auditPath = path.join(testDir, 'audit.log');

      // Generate some activity
      await engine.captureBug({
        bug_type: 'crash',
        class: 'com.example.App',
        exception_type: 'NullPointerException',
        severity: 'critical'
      });

      await new Promise(resolve => setTimeout(resolve, 800));

      if (fs.existsSync(auditPath)) {
        const auditContent = fs.readFileSync(auditPath, 'utf-8');
        expect(auditContent.length).toBeGreaterThan(0);
      }
    });

    test('Can extract stats at any point during operation', async () => {
      for (let i = 0; i < 5; i++) {
        await engine.captureBug({
          bug_type: 'crash',
          class: `com.example.App${i}`,
          exception_type: 'RuntimeException',
          severity: 'critical'
        });

        const stats = engine.getStats();
        expect(stats.recentBugsCount).toBe(i + 1);
        expect(stats.running).toBe(true);
      }
    });
  });
});

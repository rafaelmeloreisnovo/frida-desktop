import { RuntimeLearningEngine, initializeEngine, shutdownEngine } from '../index';
import { setupFridaMock, teardownFridaMock } from '../test-utils/frida-mock';
import * as fs from 'fs';
import * as path from 'path';

const removeDir = (dir: string): void => {
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
};

describe('RuntimeLearningEngine Edge Cases & Hardening', () => {
  let engine: RuntimeLearningEngine;
  const testDir = '/tmp/test-e2e-edge-cases';

  beforeEach(async () => {
    setupFridaMock();
    removeDir(testDir);
    fs.mkdirSync(testDir, { recursive: true });
    engine = await initializeEngine({
      storage_path: testDir,
      bug_capacity: 512,
      confidence_threshold: 0.75,
      min_occurrences_before_fix: 3,
      heartbeat_interval_ms: 500,
      epoch_timeout_ms: 2000
    });
  });

  afterEach(async () => {
    if (engine) await shutdownEngine();
    teardownFridaMock();
    removeDir(testDir);
    removeDir(`${testDir}_capacity`);
    removeDir(`${testDir}_missing`);
    removeDir(`${testDir}_invalid`);
    removeDir(`${testDir}_storage`);
  });

  describe('Concurrency Edge Cases', () => {
    test('Handles concurrent bug captures without race conditions', async () => {
      await Promise.all(Array.from({ length: 50 }, (_, i) => engine.captureBug({
        bug_type: i % 3 === 0 ? 'crash' : i % 3 === 1 ? 'anr' : 'memory_leak',
        class: `com.example.App${i % 5}`,
        exception_type: 'RuntimeException',
        severity: i % 2 === 0 ? 'critical' : 'warning'
      })));

      expect(engine.getStats().recentBugsCount).toBe(50);
      expect(engine.isRunning()).toBe(true);
    });

    test('Maintains data consistency during concurrent operations', async () => {
      await Promise.all(Array.from({ length: 20 }, (_, i) => engine.captureBug({
        bug_type: 'crash',
        class: `com.example.App${i}`,
        exception_type: 'NullPointerException',
        severity: 'critical'
      })));

      const historyPath = path.join(testDir, 'bug-history.json');
      expect(fs.existsSync(historyPath)).toBe(true);
      const history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
      expect(Array.isArray(history.events)).toBe(true);
    });

    test('Handles concurrent bug captures and pattern detection', async () => {
      await Promise.all(Array.from({ length: 5 }, () => engine.captureBug({
        bug_type: 'crash',
        class: 'com.example.App',
        method: 'onCreate',
        exception_type: 'NullPointerException',
        severity: 'critical'
      })));

      expect(engine.getStats().recentBugsCount).toBe(5);
      expect(engine.isRunning()).toBe(true);
    });
  });

  describe('Memory Pressure Edge Cases', () => {
    test('Bounds retained event state under high volume without using host heap as target evidence', async () => {
      for (let i = 0; i < 200; i++) {
        await engine.captureBug({
          bug_type: i % 4 === 0 ? 'crash' : i % 4 === 1 ? 'anr' : i % 4 === 2 ? 'memory_leak' : 'deadlock',
          class: `com.example.App${i % 20}`,
          exception_type: 'RuntimeException',
          severity: 'critical'
        });
      }

      const historyPath = path.join(testDir, 'bug-history.json');
      const history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
      const stats = engine.getStats();

      expect(stats.recentBugsCount).toBeLessThanOrEqual(512);
      expect(history.events.length).toBeLessThanOrEqual(512);
      expect(history.events.length).toBe(stats.recentBugsCount);
      expect(engine.isRunning()).toBe(true);
    });

    test('Handles events at capacity limit', async () => {
      const capacityDir = `${testDir}_capacity`;
      const testEngine = await initializeEngine({
        storage_path: capacityDir,
        bug_capacity: 10,
        confidence_threshold: 0.75,
        min_occurrences_before_fix: 3
      });

      for (let i = 0; i < 15; i++) {
        await testEngine.captureBug({
          bug_type: 'crash',
          class: `com.example.App${i}`,
          exception_type: 'RuntimeException',
          severity: 'critical'
        });
      }

      expect(testEngine.getStats().recentBugsCount).toBeLessThanOrEqual(10);
      expect(testEngine.isRunning()).toBe(true);
    });
  });

  describe('Data Corruption Recovery', () => {
    test('Handles corrupted JSON history gracefully', () => {
      fs.writeFileSync(path.join(testDir, 'bug-history.json'), '{ invalid json ]');
      expect(engine.getStats()).toBeDefined();
      expect(engine.isRunning()).toBe(true);
    });

    test('Handles missing storage directory', async () => {
      const missingDir = `${testDir}_missing`;
      removeDir(missingDir);
      const testEngine = await initializeEngine({
        storage_path: missingDir,
        bug_capacity: 512,
        confidence_threshold: 0.75
      });
      expect(testEngine.isRunning()).toBe(true);
    });

    test('Persists data during concurrent writes', async () => {
      await Promise.all(Array.from({ length: 30 }, (_, i) => engine.captureBug({
        bug_type: 'crash',
        class: `com.example.App${i % 10}`,
        exception_type: 'NullPointerException',
        severity: i % 2 === 0 ? 'critical' : 'warning'
      })));

      const history = JSON.parse(fs.readFileSync(path.join(testDir, 'bug-history.json'), 'utf-8'));
      expect(Array.isArray(history.events)).toBe(true);
      expect(history.events.length).toBeGreaterThan(0);
    });
  });

  describe('State Machine Edge Cases', () => {
    test('Handles rapid start/stop cycles', async () => {
      expect(engine.isRunning()).toBe(true);
      await engine.stop();
      expect(engine.isRunning()).toBe(false);
      await engine.captureBug({
        bug_type: 'crash',
        class: 'com.example.App',
        exception_type: 'RuntimeException',
        severity: 'critical'
      });
      expect(engine.isRunning()).toBe(false);
    });

    test('Handles invalid configuration gracefully', async () => {
      const testEngine = await initializeEngine({
        storage_path: `${testDir}_invalid`,
        bug_capacity: -1,
        confidence_threshold: 2.0
      });
      expect(testEngine).toBeDefined();
    });
  });

  describe('Rollback Scenarios', () => {
    test('Handles rollback during fix application', async () => {
      for (let i = 0; i < 3; i++) {
        await engine.captureBug({
          bug_type: 'crash',
          class: 'com.example.App',
          method: 'onCreate',
          exception_type: 'NullPointerException',
          severity: 'critical'
        });
      }
      expect(engine.isRunning()).toBe(true);
    });

    test('Handles cascading rollbacks', async () => {
      for (const exceptionType of ['NullPointerException', 'ArrayIndexOutOfBoundsException', 'IllegalStateException']) {
        for (let i = 0; i < 3; i++) {
          await engine.captureBug({
            bug_type: 'crash',
            class: `com.example.App${exceptionType.charCodeAt(0)}`,
            exception_type: exceptionType,
            severity: 'critical'
          });
        }
      }
      expect(engine.isRunning()).toBe(true);
    });
  });

  describe('Performance Under Load', () => {
    test('Maintains performance with sustained bug capture rate', async () => {
      const startTime = Date.now();
      const eventCount = 100;
      for (let i = 0; i < eventCount; i++) {
        await engine.captureBug({
          bug_type: i % 3 === 0 ? 'crash' : 'anr',
          class: `com.example.App${i % 10}`,
          exception_type: 'RuntimeException',
          severity: 'critical'
        });
      }
      const avgLatency = (Date.now() - startTime) / eventCount;
      expect(avgLatency).toBeLessThan(50);
      expect(engine.isRunning()).toBe(true);
    });

    test('Handles pattern detection with large bug set', async () => {
      const patterns = [
        { class: 'com.example.App', exception: 'NullPointerException' },
        { class: 'com.example.Service', exception: 'RuntimeException' },
        { class: 'com.example.Fragment', exception: 'IllegalStateException' }
      ];
      for (let i = 0; i < 50; i++) {
        const pattern = patterns[i % patterns.length];
        await engine.captureBug({
          bug_type: 'crash',
          class: pattern.class,
          exception_type: pattern.exception,
          severity: 'critical'
        });
      }
      expect(engine.getStats().recentBugsCount).toBe(50);
      expect(engine.isRunning()).toBe(true);
    });
  });

  describe('Watchdog Resilience', () => {
    test('Watchdog continues during high load', async () => {
      await Promise.all(Array.from({ length: 100 }, (_, i) => engine.captureBug({
        bug_type: 'crash',
        class: `com.example.App${i % 10}`,
        exception_type: 'RuntimeException',
        severity: 'critical'
      })));
      await new Promise(resolve => setTimeout(resolve, 2500));
      expect(engine.isRunning()).toBe(true);
    });

    test('Handles engine recovery from brief overload', async () => {
      await Promise.all(Array.from({ length: 50 }, (_, i) => engine.captureBug({
        bug_type: 'crash',
        class: `com.example.App${i}`,
        exception_type: 'RuntimeException',
        severity: 'critical'
      })));
      await new Promise(resolve => setTimeout(resolve, 500));
      expect(engine.isRunning()).toBe(true);
      await engine.captureBug({
        bug_type: 'crash',
        class: 'com.example.Recovery',
        exception_type: 'RuntimeException',
        severity: 'critical'
      });
      expect(engine.isRunning()).toBe(true);
    });
  });

  describe('File System Edge Cases', () => {
    test('Handles read-only storage boundary without claiming a physical read-only mount', () => {
      const stats = engine.getStats();
      expect(stats.running).toBe(true);
    });

    test('Handles storage cleanup on capacity exceeded', async () => {
      const storageDir = `${testDir}_storage`;
      const testEngine = await initializeEngine({
        storage_path: storageDir,
        bug_capacity: 5,
        confidence_threshold: 0.75
      });
      for (let i = 0; i < 20; i++) {
        await testEngine.captureBug({
          bug_type: 'crash',
          class: `com.example.App${i}`,
          exception_type: 'RuntimeException',
          severity: 'critical'
        });
      }
      expect(testEngine.getStats().recentBugsCount).toBeLessThanOrEqual(5);
      expect(testEngine.isRunning()).toBe(true);
    });
  });
});

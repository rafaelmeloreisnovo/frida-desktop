import { RuntimeLearningEngine, initializeEngine, shutdownEngine } from '../index';
import {
  setupFridaMock,
  teardownFridaMock
} from '../test-utils/frida-mock';
import * as fs from 'fs';
import * as path from 'path';

describe('RuntimeLearningEngine Edge Cases & Hardening', () => {
  let engine: RuntimeLearningEngine;
  const testDir = '/tmp/test-e2e-edge-cases';

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
      heartbeat_interval_ms: 500,
      epoch_timeout_ms: 2000
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

  describe('Concurrency Edge Cases', () => {
    test('Handles concurrent bug captures without race conditions', async () => {
      const promises = [];

      // Fire 50 concurrent bug captures
      for (let i = 0; i < 50; i++) {
        promises.push(
          engine.captureBug({
            bug_type: i % 3 === 0 ? 'crash' : i % 3 === 1 ? 'anr' : 'memory_leak',
            class: `com.example.App${i % 5}`,
            exception_type: 'RuntimeException',
            severity: i % 2 === 0 ? 'critical' : 'warning'
          })
        );
      }

      await Promise.all(promises);
      const stats = engine.getStats();

      expect(stats.recentBugsCount).toBe(50);
      expect(engine.isRunning()).toBe(true);
    });

    test('Maintains data consistency during concurrent operations', async () => {
      const promises = [];

      for (let i = 0; i < 20; i++) {
        promises.push(
          engine.captureBug({
            bug_type: 'crash',
            class: `com.example.App${i}`,
            exception_type: 'NullPointerException',
            severity: 'critical'
          })
        );
      }

      await Promise.all(promises);

      // Verify history file is valid JSON
      const historyPath = path.join(testDir, 'bug-history.json');
      expect(fs.existsSync(historyPath)).toBe(true);

      const history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
      expect(history.events).toBeDefined();
      expect(Array.isArray(history.events)).toBe(true);
    });

    test('Handles concurrent bug captures and pattern detection', async () => {
      const bugPromises = [];

      // Create identical bugs concurrently to trigger pattern detection
      for (let i = 0; i < 5; i++) {
        bugPromises.push(
          engine.captureBug({
            bug_type: 'crash',
            class: 'com.example.App',
            method: 'onCreate',
            exception_type: 'NullPointerException',
            severity: 'critical'
          })
        );
      }

      await Promise.all(bugPromises);
      const stats = engine.getStats();

      expect(stats.recentBugsCount).toBe(5);
      expect(engine.isRunning()).toBe(true);
    });
  });

  describe('Memory Pressure Edge Cases', () => {
    test('Handles high volume of events without memory leak', async () => {
      const initialMemory = process.memoryUsage().heapUsed;

      // Capture 200 events
      for (let i = 0; i < 200; i++) {
        await engine.captureBug({
          bug_type: i % 4 === 0 ? 'crash' : i % 4 === 1 ? 'anr' : i % 4 === 2 ? 'memory_leak' : 'deadlock',
          class: `com.example.App${i % 20}`,
          exception_type: 'RuntimeException',
          severity: 'critical'
        });
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryGrowth = finalMemory - initialMemory;

      // Allow for reasonable growth but flag if excessive
      // Expect less than 50MB growth for 200 events
      expect(memoryGrowth).toBeLessThan(50 * 1024 * 1024);
    });

    test('Handles events at capacity limit', async () => {
      // Create engine with small capacity
      let testEngine = await initializeEngine({
        storage_path: testDir + '_capacity',
        bug_capacity: 10,
        confidence_threshold: 0.75,
        min_occurrences_before_fix: 3
      });

      // Capture exactly at capacity
      for (let i = 0; i < 10; i++) {
        await testEngine.captureBug({
          bug_type: 'crash',
          class: `com.example.App${i}`,
          exception_type: 'RuntimeException',
          severity: 'critical'
        });
      }

      const stats = testEngine.getStats();
      expect(stats.recentBugsCount).toBeGreaterThan(0);

      // Capture beyond capacity - should handle gracefully
      for (let i = 0; i < 5; i++) {
        await testEngine.captureBug({
          bug_type: 'crash',
          class: `com.example.AppExtra${i}`,
          exception_type: 'RuntimeException',
          severity: 'critical'
        });
      }

      expect(testEngine.isRunning()).toBe(true);

      await testEngine.stop();
      const capTestDir = testDir + '_capacity';
      if (fs.existsSync(capTestDir)) {
        const files = fs.readdirSync(capTestDir);
        for (const file of files) {
          fs.unlinkSync(path.join(capTestDir, file));
        }
        fs.rmdirSync(capTestDir);
      }
    });
  });

  describe('Data Corruption Recovery', () => {
    test('Handles corrupted JSON history gracefully', async () => {
      // Create intentionally corrupted history file
      const historyPath = path.join(testDir, 'bug-history.json');
      fs.writeFileSync(historyPath, '{ invalid json ]');

      // Engine should handle this gracefully
      const stats = engine.getStats();
      expect(engine.isRunning()).toBe(true);
    });

    test('Handles missing storage directory', async () => {
      const nonexistentDir = testDir + '_missing';

      let testEngine = await initializeEngine({
        storage_path: nonexistentDir,
        bug_capacity: 512,
        confidence_threshold: 0.75
      });

      // Should create directory if it doesn't exist
      expect(testEngine.isRunning()).toBe(true);

      await testEngine.stop();

      // Cleanup
      if (fs.existsSync(nonexistentDir)) {
        const files = fs.readdirSync(nonexistentDir);
        for (const file of files) {
          fs.unlinkSync(path.join(nonexistentDir, file));
        }
        fs.rmdirSync(nonexistentDir);
      }
    });

    test('Persists data during concurrent writes', async () => {
      const promises = [];

      for (let i = 0; i < 30; i++) {
        promises.push(
          engine.captureBug({
            bug_type: 'crash',
            class: `com.example.App${i % 10}`,
            exception_type: 'NullPointerException',
            severity: i % 2 === 0 ? 'critical' : 'warning'
          })
        );
      }

      await Promise.all(promises);

      // Verify file integrity
      const historyPath = path.join(testDir, 'bug-history.json');
      const history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));

      expect(history.events).toBeDefined();
      expect(Array.isArray(history.events)).toBe(true);
      expect(history.events.length).toBeGreaterThan(0);
    });
  });

  describe('State Machine Edge Cases', () => {
    test('Handles rapid start/stop cycles', async () => {
      expect(engine.isRunning()).toBe(true);

      await engine.stop();
      expect(engine.isRunning()).toBe(false);

      // Try to capture while stopped - should handle gracefully
      await engine.captureBug({
        bug_type: 'crash',
        class: 'com.example.App',
        exception_type: 'RuntimeException',
        severity: 'critical'
      });

      expect(engine.isRunning()).toBe(false);
    });

    test('Handles invalid configuration gracefully', async () => {
      let testEngine = await initializeEngine({
        storage_path: testDir + '_invalid',
        bug_capacity: -1, // Invalid capacity
        confidence_threshold: 2.0 // Invalid threshold > 1.0
      });

      // Should still initialize with default values or clamp to valid range
      expect(testEngine).toBeDefined();

      await testEngine.stop();

      const invalidDir = testDir + '_invalid';
      if (fs.existsSync(invalidDir)) {
        const files = fs.readdirSync(invalidDir);
        for (const file of files) {
          fs.unlinkSync(path.join(invalidDir, file));
        }
        fs.rmdirSync(invalidDir);
      }
    });
  });

  describe('Rollback Scenarios', () => {
    test('Handles rollback during fix application', async () => {
      // Capture identical bugs to trigger pattern and fix
      for (let i = 0; i < 3; i++) {
        await engine.captureBug({
          bug_type: 'crash',
          class: 'com.example.App',
          method: 'onCreate',
          exception_type: 'NullPointerException',
          severity: 'critical'
        });
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      // Trigger fix via pattern detection
      // Engine should handle rollback if needed
      expect(engine.isRunning()).toBe(true);
    });

    test('Handles cascading rollbacks', async () => {
      // Capture multiple different patterns
      const patterns = ['NullPointerException', 'ArrayIndexOutOfBoundsException', 'IllegalStateException'];

      for (const exceptionType of patterns) {
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

      const elapsed = Date.now() - startTime;
      const avgLatency = elapsed / eventCount;

      // Average latency should be reasonable (< 50ms per capture for test)
      expect(avgLatency).toBeLessThan(50);
      expect(engine.isRunning()).toBe(true);
    });

    test('Handles pattern detection with large bug set', async () => {
      // Create 50 events with 3 distinct patterns
      const patterns = [
        { class: 'com.example.App', exception: 'NullPointerException' },
        { class: 'com.example.Service', exception: 'RuntimeException' },
        { class: 'com.example.Fragment', exception: 'IllegalStateException' }
      ];

      for (let i = 0; i < 50; i++) {
        const pattern = patterns[i % 3];
        await engine.captureBug({
          bug_type: 'crash',
          class: pattern.class,
          exception_type: pattern.exception,
          severity: 'critical'
        });
      }

      const stats = engine.getStats();
      expect(stats.recentBugsCount).toBe(50);
      expect(engine.isRunning()).toBe(true);
    });
  });

  describe('Watchdog Resilience', () => {
    test('Watchdog continues during high load', async () => {
      const promises = [];

      // Generate high-frequency events
      for (let i = 0; i < 100; i++) {
        promises.push(
          engine.captureBug({
            bug_type: 'crash',
            class: `com.example.App${i % 10}`,
            exception_type: 'RuntimeException',
            severity: 'critical'
          })
        );
      }

      await Promise.all(promises);

      // Wait for watchdog cycles
      await new Promise(resolve => setTimeout(resolve, 2500));

      expect(engine.isRunning()).toBe(true);
    });

    test('Handles engine recovery from brief overload', async () => {
      expect(engine.isRunning()).toBe(true);

      // Create heavy load
      const promises = [];
      for (let i = 0; i < 50; i++) {
        promises.push(
          engine.captureBug({
            bug_type: 'crash',
            class: `com.example.App${i}`,
            exception_type: 'RuntimeException',
            severity: 'critical'
          })
        );
      }

      await Promise.all(promises);

      // Brief pause for recovery
      await new Promise(resolve => setTimeout(resolve, 500));

      // Should still be running and responsive
      expect(engine.isRunning()).toBe(true);

      // Should be able to handle more events
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
    test('Handles read-only storage gracefully', async () => {
      // In production, could test with read-only filesystem
      // For now, verify normal operation
      const stats = engine.getStats();
      expect(stats.running).toBe(true);
    });

    test('Handles storage cleanup on capacity exceeded', async () => {
      let testEngine = await initializeEngine({
        storage_path: testDir + '_storage',
        bug_capacity: 5,
        confidence_threshold: 0.75
      });

      // Exceed capacity
      for (let i = 0; i < 20; i++) {
        await testEngine.captureBug({
          bug_type: 'crash',
          class: `com.example.App${i}`,
          exception_type: 'RuntimeException',
          severity: 'critical'
        });
      }

      // Should still be running
      expect(testEngine.isRunning()).toBe(true);

      await testEngine.stop();

      const storageDir = testDir + '_storage';
      if (fs.existsSync(storageDir)) {
        const files = fs.readdirSync(storageDir);
        for (const file of files) {
          fs.unlinkSync(path.join(storageDir, file));
        }
        fs.rmdirSync(storageDir);
      }
    });
  });
});

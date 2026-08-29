import { RuntimeLearningEngine, initializeEngine, getEngine } from '../index';
import { BugEvent } from '../types';

describe('RuntimeLearningEngine', () => {
  let engine: RuntimeLearningEngine;

  beforeEach(async () => {
    engine = await initializeEngine({
      storage_path: '/tmp/test-frida-learning',
      bug_capacity: 512,
      confidence_threshold: 0.75,
      min_occurrences_before_fix: 3
    });
  });

  afterEach(async () => {
    if (engine) {
      await engine.shutdown();
    }
  });

  test('Engine initializes and starts', () => {
    expect(engine).toBeDefined();
    expect(engine.isRunning()).toBe(true);
  });

  test('Engine can capture bugs', async () => {
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

  test('Engine detects patterns in repeated bugs', async () => {
    const bugEvent: Partial<BugEvent> = {
      bug_type: 'crash',
      class: 'com.example.App',
      method: 'onCreate',
      exception_type: 'NullPointerException',
      severity: 'critical'
    };

    for (let i = 0; i < 5; i++) {
      await engine.captureBug(bugEvent);
    }

    const stats = engine.getStats();
    expect(stats.recentBugsCount).toBeGreaterThanOrEqual(5);
  });

  test('Engine handles different bug types', async () => {
    const bugTypes = ['crash', 'anr', 'memory_leak', 'deadlock'];

    for (const bugType of bugTypes) {
      await engine.captureBug({
        bug_type: bugType as any,
        class: 'com.example.App',
        method: 'test',
        severity: 'high'
      });
    }

    const stats = engine.getStats();
    expect(stats.recentBugsCount).toBeGreaterThanOrEqual(4);
  });

  test('Engine can shutdown gracefully', async () => {
    await engine.shutdown();
    expect(engine.isRunning()).toBe(false);
  });

  test('Global engine instance works', () => {
    const globalEngine = getEngine();
    expect(globalEngine).toBeDefined();
    expect(globalEngine?.isRunning()).toBe(true);
  });

  test('Watchdog stats are available', () => {
    const stats = engine.getStats();
    expect(stats.watchdogStats).toBeDefined();
    expect(stats.watchdogStats.heartbeat_count).toBeGreaterThanOrEqual(0);
  });

  test('Engine handles rapid bug captures', async () => {
    const promises = [];

    for (let i = 0; i < 10; i++) {
      promises.push(
        engine.captureBug({
          bug_type: 'crash',
          class: `com.example.App${i}`,
          method: 'test',
          severity: 'medium'
        })
      );
    }

    await Promise.all(promises);

    const stats = engine.getStats();
    expect(stats.recentBugsCount).toBeGreaterThan(0);
  });
});

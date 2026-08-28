/**
 * Example usage of RuntimeLearningEngine
 *
 * Deploy to Android device:
 * $ adb push modules/runtime-learning-engine /data/local/tmp/
 * $ frida -H 127.0.0.1 -p <app-name> -l example.ts
 */

import {
  initializeEngine,
  getEngine,
  shutdownEngine,
  RuntimeLearningEngine
} from './index';

async function main() {
  console.log('='.repeat(60));
  console.log('Runtime Learning Engine - Example');
  console.log('='.repeat(60));

  try {
    console.log('\n1. Initializing engine...');
    const engine = await initializeEngine({
      storage_path: '/data/local/tmp/frida-learning',
      bug_capacity: 512,
      confidence_threshold: 0.75,
      min_occurrences_before_fix: 3,
      heartbeat_interval_ms: 1000,
      epoch_timeout_ms: 5000
    });

    console.log(`✓ Engine initialized. Running: ${engine.isRunning()}`);

    console.log('\n2. Simulating bug captures...');

    const bugScenarios = [
      {
        bug_type: 'crash' as const,
        class: 'com.example.MainActivity',
        method: 'onCreate',
        exception_type: 'NullPointerException',
        severity: 'critical' as const,
        count: 5
      },
      {
        bug_type: 'anr' as const,
        class: 'com.example.BackgroundService',
        method: 'doWork',
        exception_type: 'ANRException',
        severity: 'high' as const,
        count: 3
      },
      {
        bug_type: 'memory_leak' as const,
        class: 'com.example.MemoryManager',
        method: 'allocate',
        exception_type: 'MemoryPressure',
        severity: 'high' as const,
        count: 7
      },
      {
        bug_type: 'deadlock' as const,
        class: 'com.example.ThreadPool',
        method: 'execute',
        exception_type: 'DeadlockDetected',
        severity: 'critical' as const,
        count: 2
      }
    ];

    for (const scenario of bugScenarios) {
      console.log(`\n  Capturing ${scenario.count}x ${scenario.bug_type} in ${scenario.class}.${scenario.method}`);

      for (let i = 0; i < scenario.count; i++) {
        await engine.captureBug({
          bug_type: scenario.bug_type,
          class: scenario.class,
          method: scenario.method,
          exception_type: scenario.exception_type,
          severity: scenario.severity,
          stack_hash: `stack_hash_${scenario.class}_${i}`
        });

        if (i % 2 === 0) {
          console.log(`    • Captured ${i + 1}/${scenario.count}`);
        }
      }

      console.log(`  ✓ ${scenario.count} ${scenario.bug_type} events captured`);
    }

    console.log('\n3. Checking engine status...');
    const stats = engine.getStats();

    console.log(`
  Engine Status:
  • Running: ${stats.running}
  • Recent bugs: ${stats.recentBugsCount}
  • Pending rollbacks: ${stats.pendingRollbacks}
  • Watchdog state: ${stats.watchdogStats.current_state}
  • Heartbeats: ${stats.watchdogStats.heartbeat_count}
  • Epochs: ${stats.watchdogStats.current_epoch}
  • Traps: ${stats.watchdogStats.trap_count}
    `);

    console.log('\n4. Demonstrating pattern detection...');
    console.log(`
  The engine will:
  1. Detect that NullPointerException occurs 5 times (>= min 3)
  2. Calculate confidence = 0.92 (>= threshold 0.75)
  3. Select try_catch_with_fallback strategy (crash count < 5)
  4. Apply fix and run tests
  5. If tests pass: commit fix, set STABLE
  6. If tests fail: rollback, set FAILSAFE
    `);

    console.log('\n5. Checking output files...');
    console.log(`
  Generated files:
  • /data/local/tmp/frida-learning/bug-history.json
    └─ Contains: ${stats.recentBugsCount} recent bugs

  • /data/local/tmp/frida-learning/rollback-journal.json
    └─ Contains: rollback journals with checksums

  • /data/local/tmp/frida-learning/watchdog-events.json
    └─ Contains: watchdog heartbeats and state changes
    `);

    console.log('\n6. Running periodically...');
    console.log('   The watchdog will continue monitoring:');
    console.log('   • Heartbeat every 1000ms');
    console.log('   • Epoch timeout every 5000ms');
    console.log('   • Rollback if no heartbeat for 5+ seconds');

    console.log('\n7. Waiting 10 seconds to observe watchdog activity...');

    for (let i = 0; i < 5; i++) {
      await new Promise(resolve => setTimeout(resolve, 2000));

      const currentStats = engine.getStats();
      console.log(
        `   [${new Date().toISOString()}] Heartbeats: ${currentStats.watchdogStats.heartbeat_count}, ` +
        `State: ${currentStats.watchdogStats.current_state}`
      );
    }

    console.log('\n8. Engine demonstration complete!');
    console.log('   Files have been written to /data/local/tmp/frida-learning/');
    console.log('   Verify with: adb shell cat /data/local/tmp/frida-learning/bug-history.json');

    console.log('\n9. Shutting down engine...');
    await engine.shutdown();

    console.log('✓ Engine shutdown complete');

    console.log('\n' + '='.repeat(60));
    console.log('Example complete!');
    console.log('='.repeat(60));
  } catch (error) {
    console.error('Error in example:', error);
    await shutdownEngine();
  }
}

if (require.main === module) {
  main().catch(console.error);
}

export { main };

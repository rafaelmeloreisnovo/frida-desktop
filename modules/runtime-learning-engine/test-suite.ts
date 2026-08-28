import { TestSuite, TestResult, FixEvent } from './types';

export class TestSuiteImpl implements TestSuite {
  private testTimeout = 10000;

  async runAfterFix(fix: FixEvent): Promise<TestResult[]> {
    console.log(`[TestSuite] Running tests after fix: ${fix.fix_id}`);

    const results: TestResult[] = [];

    try {
      const smokeResult = await this.smokeTest();
      results.push(smokeResult);

      if (smokeResult.state === 'PASS') {
        const regressionResult = await this.regressionTest();
        results.push(regressionResult);

        if (regressionResult.state === 'PASS') {
          const performanceResult = await this.performanceTest();
          results.push(performanceResult);
        }
      }
    } catch (e) {
      console.error('[TestSuite] Test execution failed:', e);
      results.push({
        test_name: 'execution_error',
        state: 'FAIL',
        duration_ms: 0,
        error_message: String(e)
      });
    }

    fix.test_results = results;
    const allPassed = results.every(r => r.state === 'PASS' || r.state === 'SKIPPED');

    console.log(
      `[TestSuite] Test results: ${allPassed ? 'ALL PASSED' : 'SOME FAILED'} ` +
      `(${results.filter(r => r.state === 'PASS').length}/${results.length} passed)`
    );

    return results;
  }

  async smokeTest(): Promise<TestResult> {
    console.log('[TestSuite] Running smoke test...');

    const startTime = Date.now();

    try {
      const runtime = Java.use('java.lang.Runtime');
      const process = runtime.getRuntime().exec('exit 0');

      const startWait = Date.now();
      await this.waitForProcess(process, this.testTimeout);
      const duration = Date.now() - startWait;

      console.log('[TestSuite] Smoke test PASSED');

      return {
        test_name: 'smoke_test',
        state: 'PASS',
        duration_ms: duration
      };
    } catch (e) {
      const duration = Date.now() - startTime;
      console.error('[TestSuite] Smoke test FAILED:', e);

      return {
        test_name: 'smoke_test',
        state: 'FAIL',
        duration_ms: duration,
        error_message: String(e)
      };
    }
  }

  async regressionTest(): Promise<TestResult> {
    console.log('[TestSuite] Running regression test...');

    const startTime = Date.now();

    try {
      const testMethods = [
        this.testMemoryAccess(),
        this.testThreadSafety(),
        this.testNullPointerHandling(),
        this.testExceptionPropagation()
      ];

      const results = await Promise.allSettled(testMethods);
      const failed = results.filter(r => r.status === 'rejected');

      const duration = Date.now() - startTime;

      if (failed.length === 0) {
        console.log('[TestSuite] Regression test PASSED');

        return {
          test_name: 'regression_test',
          state: 'PASS',
          duration_ms: duration
        };
      } else {
        console.error(`[TestSuite] Regression test FAILED: ${failed.length} checks failed`);

        return {
          test_name: 'regression_test',
          state: 'FAIL',
          duration_ms: duration,
          error_message: `${failed.length} regression checks failed`
        };
      }
    } catch (e) {
      const duration = Date.now() - startTime;
      console.error('[TestSuite] Regression test FAILED:', e);

      return {
        test_name: 'regression_test',
        state: 'FAIL',
        duration_ms: duration,
        error_message: String(e)
      };
    }
  }

  async performanceTest(): Promise<TestResult> {
    console.log('[TestSuite] Running performance test...');

    const startTime = Date.now();

    try {
      const iterations = 1000;
      const timings: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const iterStart = Date.now();

        const runtime = Java.use('java.lang.Runtime');
        const mem = runtime.getRuntime().totalMemory();

        const iterEnd = Date.now();
        timings.push(iterEnd - iterStart);
      }

      const avgTime = timings.reduce((a, b) => a + b, 0) / timings.length;
      const maxTime = Math.max(...timings);
      const duration = Date.now() - startTime;

      console.log(
        `[TestSuite] Performance test results: ` +
        `avg=${avgTime.toFixed(2)}ms, max=${maxTime}ms, total=${duration}ms`
      );

      const performanceThreshold = 5;
      if (avgTime > performanceThreshold) {
        console.warn(`[TestSuite] Performance degradation detected: ${avgTime.toFixed(2)}ms > ${performanceThreshold}ms`);

        return {
          test_name: 'performance_test',
          state: 'FAIL',
          duration_ms: duration,
          error_message: `Average latency ${avgTime.toFixed(2)}ms exceeds threshold ${performanceThreshold}ms`
        };
      }

      console.log('[TestSuite] Performance test PASSED');

      return {
        test_name: 'performance_test',
        state: 'PASS',
        duration_ms: duration
      };
    } catch (e) {
      const duration = Date.now() - startTime;
      console.error('[TestSuite] Performance test FAILED:', e);

      return {
        test_name: 'performance_test',
        state: 'FAIL',
        duration_ms: duration,
        error_message: String(e)
      };
    }
  }

  private async testMemoryAccess(): Promise<void> {
    try {
      const buf = Java.use('java.nio.ByteBuffer').allocate(1024);
      buf.put(0, 42);
      buf.put(10, 100);
      buf.put(100, 200);

      const val0 = buf.get(0);
      const val10 = buf.get(10);
      const val100 = buf.get(100);

      if (val0 !== 42) {
        throw new Error(`Memory test failed at index 0: expected 42, got ${val0}`);
      }
      if (val10 !== 100) {
        throw new Error(`Memory test failed at index 10: expected 100, got ${val10}`);
      }
      if (val100 !== 200) {
        throw new Error(`Memory test failed at index 100: expected 200, got ${val100}`);
      }

      console.log('[TestSuite] Memory access validation passed');
    } catch (e) {
      throw new Error(`Memory access test failed: ${e}`);
    }
  }

  private async testThreadSafety(): Promise<void> {
    try {
      const threadClass = Java.use('java.lang.Thread');
      const runnableClass = Java.use('java.lang.Runnable');

      let executionCount = 0;
      const runnable = Java.registerClass({
        name: 'com.frida.test.TestRunnable',
        implements: ['java.lang.Runnable'],
        methods: {
          run() {
            executionCount++;
          }
        }
      });

      const t1 = threadClass.$new(runnable.$new());
      const t2 = threadClass.$new(runnable.$new());

      t1.start();
      t2.start();

      threadClass.sleep(100);

      if (executionCount < 1) {
        throw new Error(`Thread execution test failed: expected threads to execute, got ${executionCount} executions`);
      }

      console.log('[TestSuite] Thread safety validation passed');
    } catch (e) {
      throw new Error(`Thread safety test failed: ${e}`);
    }
  }

  private async testNullPointerHandling(): Promise<void> {
    try {
      const stringClass = Java.use('java.lang.String');
      const nullPointerExceptionClass = Java.use('java.lang.NullPointerException');

      try {
        stringClass.valueOf(null);
        throw new Error('Null pointer test failed: expected NullPointerException was not thrown');
      } catch (e) {
        const exceptionMsg = String(e);
        const isNPE = exceptionMsg.includes('NullPointerException') ||
                     exceptionMsg.includes('null') ||
                     exceptionMsg.includes('TypeError');

        if (!isNPE) {
          throw new Error(`Null pointer test failed: wrong exception type: ${exceptionMsg}`);
        }

        console.log('[TestSuite] Null pointer correctly caught and identified');
      }
    } catch (e) {
      throw new Error(`Null pointer handling test failed: ${e}`);
    }
  }

  private async testExceptionPropagation(): Promise<void> {
    try {
      const testMsg = 'Test exception propagation';

      try {
        this.throwTestException(testMsg);
      } catch (e) {
        const errStr = String(e);

        if (!errStr.includes(testMsg)) {
          throw new Error(`Exception message lost: expected "${testMsg}", got "${errStr}"`);
        }

        if (!errStr.includes('Error') && !errStr.includes('Exception')) {
          throw new Error(`Exception type information lost: ${errStr}`);
        }

        console.log('[TestSuite] Exception propagation validation passed');
      }
    } catch (e) {
      throw new Error(`Exception propagation test failed: ${e}`);
    }
  }

  private throwTestException(msg: string): void {
    throw new Error(msg);
  }

  private waitForProcess(process: any, timeout: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Process timeout'));
      }, timeout);

      try {
        process.waitFor();
        clearTimeout(timer);
        resolve();
      } catch (e) {
        clearTimeout(timer);
        reject(e);
      }
    });
  }
}

export function createTestSuite(): TestSuite {
  return new TestSuiteImpl();
}

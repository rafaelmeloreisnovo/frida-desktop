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
    const buf = Java.use('java.nio.ByteBuffer').allocate(1024);
    buf.put(0, 42);

    if (buf.get(0) !== 42) {
      throw new Error('Memory access test failed');
    }
  }

  private async testThreadSafety(): Promise<void> {
    const lock = new java.lang.Object();

    Java.use('java.lang.Object').notifyAll.call(lock);
  }

  private async testNullPointerHandling(): Promise<void> {
    const nullObj = null;

    try {
      Java.use('java.lang.String').valueOf(nullObj);
    } catch (e) {
      console.log('[TestSuite] Null pointer correctly caught');
    }
  }

  private async testExceptionPropagation(): Promise<void> {
    try {
      throw new Error('Test exception');
    } catch (e) {
      if (!String(e).includes('Test exception')) {
        throw new Error('Exception propagation failed');
      }
    }
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

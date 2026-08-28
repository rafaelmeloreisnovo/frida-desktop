/**
 * Mock Frida API for offline testing
 * Simulates Frida's Java.use() and hook mechanisms without real Frida
 */

export class MockJavaClass {
  private className: string;
  private methods: Map<string, MockMethod> = new Map();
  private instances: any[] = [];

  constructor(className: string) {
    this.className = className;
    this.setupCommonMethods();
  }

  private setupCommonMethods(): void {
    if (this.className === 'java.lang.Throwable') {
      this.methods.set('printStackTrace', new MockMethod('printStackTrace'));
    } else if (this.className === 'android.app.ActivityManager') {
      this.methods.set('appNotResponding', new MockMethod('appNotResponding'));
    } else if (this.className === 'java.lang.Runtime') {
      this.methods.set('gc', new MockMethod('gc'));
    } else if (this.className === 'java.lang.Thread') {
      this.methods.set('start', new MockMethod('start'));
    }
  }

  $new(...args: any[]): any {
    const instance = {
      _className: this.className,
      _args: args
    };
    this.instances.push(instance);
    return instance;
  }

  [key: string]: any;
}

export class MockMethod {
  private methodName: string;
  private hookCallbacks: ((args: any) => void)[] = [];
  private callCount = 0;
  private lastCallArgs: any[] | null = null;

  constructor(methodName: string) {
    this.methodName = methodName;
  }

  overload(...types: string[]): MockOverload {
    return new MockOverload(this.methodName, types, this);
  }

  implementation(fn: any): void {
    // Mock implementation setter
  }

  replace(fn: any): void {
    // Mock replacement
  }

  hook(callback: any): void {
    this.hookCallbacks.push(callback);
  }

  simulate(...args: any[]): void {
    this.callCount++;
    this.lastCallArgs = args;
    for (const callback of this.hookCallbacks) {
      try {
        callback(...args);
      } catch (e) {
        console.warn('[MockMethod] Callback error:', e);
      }
    }
  }

  getCallCount(): number {
    return this.callCount;
  }

  getLastCallArgs(): any[] | null {
    return this.lastCallArgs;
  }

  reset(): void {
    this.callCount = 0;
    this.lastCallArgs = null;
    this.hookCallbacks = [];
  }
}

export class MockOverload {
  constructor(
    private methodName: string,
    private types: string[],
    private parent: MockMethod
  ) {}

  implementation(fn: any): void {
    // Mock implementation
  }

  replace(fn: any): void {
    // Mock replacement
  }

  hook(callback: any): void {
    this.parent.hook(callback);
  }

  simulate(...args: any[]): void {
    this.parent.simulate(...args);
  }
}

export class MockJava {
  private classes: Map<string, MockJavaClass> = new Map();

  use(className: string): MockJavaClass {
    if (!this.classes.has(className)) {
      this.classes.set(className, new MockJavaClass(className));
    }
    return this.classes.get(className)!;
  }

  cast(obj: any, className: string): any {
    return obj;
  }

  isMainThread(): boolean {
    return true;
  }

  scheduleOnMainThread(fn: () => void): void {
    setTimeout(fn, 0);
  }

  getClass(obj: any): string {
    return obj._className || 'java.lang.Object';
  }

  getClassLoader(): any {
    return { loadClass: () => null };
  }
}

export class MockFrida {
  static Java = new MockJava();
  static version = '14.2.0';

  static setTimeout(fn: () => void, ms: number): any {
    return setTimeout(fn, ms);
  }

  static clearTimeout(id: any): void {
    clearTimeout(id);
  }

  static rpc = {
    exports: {}
  };
}

// Global setup for testing
export function setupFridaMock(): void {
  (globalThis as any).Java = MockFrida.Java;
  (globalThis as any).Frida = MockFrida;
}

// Cleanup after testing
export function teardownFridaMock(): void {
  delete (globalThis as any).Java;
  delete (globalThis as any).Frida;
}

// Helper to get mock class instance
export function getMockClass(className: string): MockJavaClass {
  return MockFrida.Java.use(className);
}

// Helper to simulate method calls for testing
export function simulateMethodCall(
  className: string,
  methodName: string,
  ...args: any[]
): void {
  const clazz = MockFrida.Java.use(className);
  const method = (clazz as any)[methodName] as MockMethod;
  if (method && typeof method.simulate === 'function') {
    method.simulate(...args);
  }
}

export class MockAndroidBuild {
  static API_LEVEL = 30;
  static CODENAME = 'Android 11';
  static DEVICE = 'mock_device';

  static getProperties(): Map<string, string> {
    return new Map([
      ['ro.build.version.sdk', '30'],
      ['ro.build.version.release', '11'],
      ['ro.build.description', 'mock_device-user 11 RP1A.200720.011 release-keys']
    ]);
  }
}

export class MockSELinux {
  private mode: 'enforcing' | 'permissive' | 'disabled' = 'permissive';

  setMode(mode: 'enforcing' | 'permissive' | 'disabled'): void {
    this.mode = mode;
  }

  getMode(): string {
    return this.mode;
  }

  isEnforcing(): boolean {
    return this.mode === 'enforcing';
  }
}

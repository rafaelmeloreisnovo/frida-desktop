/**
 * Mock Frida API for deterministic offline testing.
 *
 * The mock intentionally models the property shape exposed by Frida's
 * Java.use(): methods are available as properties (clazz.method), not only in
 * an internal registry. This keeps hosted CI representative of the API shape
 * without claiming a physical Android runtime.
 */

export class MockJavaClass {
  private className: string;
  private methods: Map<string, MockMethod> = new Map();
  private instances: any[] = [];

  [key: string]: any;

  constructor(className: string) {
    this.className = className;
    this.setupCommonMethods();
    this.setupCommonFields();
  }

  private exposeMethod(name: string): MockMethod {
    const method = new MockMethod(name);
    this.methods.set(name, method);
    this[name] = method;
    return method;
  }

  private setupCommonMethods(): void {
    if (this.className === 'java.lang.Throwable') {
      this.exposeMethod('printStackTrace');
    } else if (this.className === 'android.app.ActivityManager') {
      this.exposeMethod('appNotResponding');
    } else if (this.className === 'java.lang.Runtime') {
      this.exposeMethod('gc');
      this.getRuntime = () => ({
        exec: (_args: any) => ({ mock: true }),
        maxMemory: () => ({ toNumber: () => 1024 * 1024 * 1024 }),
        totalMemory: () => ({ toNumber: () => 512 * 1024 * 1024 }),
        freeMemory: () => ({ toNumber: () => 256 * 1024 * 1024 })
      });
    } else if (this.className === 'java.lang.Thread') {
      this.exposeMethod('start');
      this.currentThread = () => ({
        getId: () => ({ toNumber: () => 1 }),
        getBlockedTime: () => 0,
        getName: () => ({ toString: () => 'mock-thread' }),
        getClass: () => ({
          getName: () => ({ toString: () => 'java.lang.Thread' })
        })
      });
    } else if (this.className === 'android.os.Handler') {
      this.exposeMethod('post');
    } else if (this.className === 'java.util.concurrent.locks.LockSupport') {
      this.exposeMethod('park');
    } else if (this.className === 'android.os.Process') {
      this.myPid = () => 1234;
    }
  }

  private setupCommonFields(): void {
    if (this.className === 'android.os.Build$VERSION') {
      this.SDK_INT = { value: MockAndroidBuild.API_LEVEL };
      this.RELEASE = { value: '11' };
      this.CODENAME = { value: MockAndroidBuild.CODENAME };
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
}

export class MockMethod {
  private methodName: string;
  private hookCallbacks: ((args: any) => void)[] = [];
  private callCount = 0;
  private lastCallArgs: any[] | null = null;
  private installedImplementation: any = null;

  constructor(methodName: string) {
    this.methodName = methodName;
  }

  overload(...types: string[]): MockOverload {
    return new MockOverload(this.methodName, types, this);
  }

  get implementation(): any {
    return this.installedImplementation;
  }

  set implementation(fn: any) {
    this.installedImplementation = fn;
  }

  replace(fn: any): void {
    this.installedImplementation = fn;
  }

  hook(callback: any): void {
    this.hookCallbacks.push(callback);
  }

  call(_receiver: any, ...args: any[]): any {
    this.callCount++;
    this.lastCallArgs = args;
    return undefined;
  }

  detach(): void {
    this.installedImplementation = null;
    this.hookCallbacks = [];
  }

  simulate(...args: any[]): void {
    this.callCount++;
    this.lastCallArgs = args;
    for (const callback of this.hookCallbacks) {
      try {
        (callback as any).apply(null, args);
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
    this.installedImplementation = null;
  }
}

export class MockOverload {
  private installedImplementation: any = null;

  constructor(
    private methodName: string,
    private types: string[],
    private parent: MockMethod
  ) {}

  get implementation(): any {
    return this.installedImplementation;
  }

  set implementation(fn: any) {
    this.installedImplementation = fn;
  }

  replace(fn: any): void {
    this.installedImplementation = fn;
  }

  hook(callback: any): void {
    this.parent.hook(callback);
  }

  call(receiver: any, ...args: any[]): any {
    return this.parent.call(receiver, ...args);
  }

  detach(): void {
    this.installedImplementation = null;
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

  cast(obj: any, _className: string): any {
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

  reset(): void {
    this.classes.clear();
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
  MockFrida.Java.reset();
  (globalThis as any).Java = MockFrida.Java;
  (globalThis as any).Frida = MockFrida;
}

// Cleanup after testing
export function teardownFridaMock(): void {
  delete (globalThis as any).Java;
  delete (globalThis as any).Frida;
  MockFrida.Java.reset();
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

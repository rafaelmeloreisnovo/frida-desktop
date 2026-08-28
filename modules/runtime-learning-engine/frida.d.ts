declare global {
  interface Java {
    use(className: string): any;
    cast(obj: any, className: string): any;
    isMainThread(): boolean;
    scheduleOnMainThread(fn: () => void): void;
    getClass(obj: any): string;
    getClassLoader(): any;
    registerClass(spec: any): any;
  }

  const Java: Java;

  interface Frida {
    version: string;
    setTimeout(fn: () => void, ms: number): any;
    clearTimeout(id: any): void;
    rpc: {
      exports: Record<string, any>;
    };
  }

  const Frida: Frida;

  interface NativeFunction {
    attach(target: any, callback?: any): any;
  }

  const NativeFunction: NativeFunction;

  interface Memory {
    ProtectionAllow: number;
    protect(address: any, size: number, mode: string): string;
    copy(dst: any, src: any, size: number): void;
    readByteArray(address: any, size: number): any;
    writeByteArray(address: any, bytes: any): void;
  }

  const Memory: Memory;

  function ptr(value: string | number): any;
}

export {};

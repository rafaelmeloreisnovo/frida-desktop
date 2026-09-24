'use strict';

/*
 * RAFAELIA Android runtime stability / recognition sensor V2.
 *
 * Passive by default:
 * - one bounded structural snapshot on load;
 * - on-demand snapshots through RPC;
 * - optional event-driven module/thread observers, disabled by default;
 * - no payload/file/UI/credential reads;
 * - no repair, patching or exception swallowing.
 */

const SCHEMA = 'rafaelia.android.runtime-stability/v2';
const CHANNEL = 'rafaelia.android.runtime.stability';
const REASON_ALLOWLIST = new Set([
  'AGENT_LOAD',
  'RPC',
  'BASELINE',
  'CANDIDATE',
  'PRE_CRASH',
  'POST_CRASH',
  'PRE_RECOVERY',
  'POST_RECOVERY',
  'COMPATIBILITY',
  'MANUAL'
]);

const SAFE_SYSTEM_PROPERTIES = [
  'ro.zygote',
  'ro.product.cpu.abilist',
  'ro.product.cpu.abilist32',
  'ro.product.cpu.abilist64',
  'dalvik.vm.isa.arm.variant',
  'dalvik.vm.isa.arm.features',
  'ro.vndk.version',
  'ro.product.first_api_level',
  'ro.board.platform',
  'ro.boot.hardware',
  'ro.vendor.mediatek.platform',
  'ro.build.type',
  'ro.debuggable',
  'ro.secure',
  'ro.crypto.state',
  'ro.crypto.type',
  'ro.build.ab_update',
  'ro.boot.dynamic_partitions',
  'ro.boot.verifiedbootstate',
  'ro.boot.veritymode',
  'ro.boot.flash.locked',
  'ro.boot.slot_suffix',
  'sys.use_memfd',
  'ro.config.per_app_memcg',
  'ro.lmk.downgrade_pressure'
];

const SAFE_SERVICE_PROPERTIES = [
  'init.svc.lmkd',
  'init.svc.ashmemd',
  'init.svc.hidl_memory',
  'init.svc.tombstoned',
  'init.svc.traced',
  'init.svc.traced_probes'
];

let captureSequence = 0;
let eventSequence = 0;
let moduleObserver = null;
let threadObserver = null;
let observersActive = false;

function errorClass(error) {
  if (error === null || error === undefined)
    return 'unknown';
  return safe(function () {
    return error.constructor && error.constructor.name ?
        String(error.constructor.name) : 'unknown';
  }, 'unknown');
}

function safe(fn, fallback) {
  try {
    return fn();
  } catch (_) {
    return fallback;
  }
}

function normalizeReason(value) {
  const normalized = String(value || 'MANUAL').trim().toUpperCase();
  return REASON_ALLOWLIST.has(normalized) ? normalized : 'CALLER_DEFINED';
}

function pointerText(value) {
  if (value === null || value === undefined)
    return null;
  return safe(function () { return value.toString(); }, null);
}

function fnv1a32Text(text) {
  let hash = 0x811c9dc5;
  const material = String(text);
  for (let i = 0; i !== material.length; i++) {
    hash ^= material.charCodeAt(i) & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return ('00000000' + hash.toString(16)).slice(-8);
}

function scalarNumberOrText(value) {
  if (value === null || value === undefined)
    return null;
  return safe(function () {
    const text = value.toString();
    const parsed = Number(text);
    if (Number.isSafeInteger(parsed))
      return parsed;
    return text;
  }, null);
}

function collectModules() {
  try {
    const modules = Process.enumerateModules();
    const rows = modules.map(function (module) {
      return {
        name: String(module.name),
        base: pointerText(module.base),
        size: Number(module.size)
      };
    });

    rows.sort(function (a, b) {
      if (a.name < b.name) return -1;
      if (a.name > b.name) return 1;
      return a.size - b.size;
    });

    const stableMaterial = rows.map(function (row) {
      return row.name + ':' + row.size;
    }).join('|');

    return {
      status: 'PASS',
      count: rows.length,
      stable_set_fingerprint_hint: fnv1a32Text(stableMaterial),
      modules: rows
    };
  } catch (error) {
    return {
      status: 'TOKEN_VAZIO',
      error_class: errorClass(error),
      count: 'TOKEN_VAZIO',
      stable_set_fingerprint_hint: 'TOKEN_VAZIO',
      modules: 'TOKEN_VAZIO'
    };
  }
}


function moduleSurfaceMaterial(modules) {
  if (!modules || modules.status !== 'PASS' || !Array.isArray(modules.modules))
    return 'TOKEN_VAZIO';
  return modules.modules.map(function (row) {
    return row.name + ':' + row.size;
  }).join('|');
}

function moduleSurfaceEqual(a, b) {
  const left = moduleSurfaceMaterial(a);
  const right = moduleSurfaceMaterial(b);
  if (left === 'TOKEN_VAZIO' || right === 'TOKEN_VAZIO')
    return 'TOKEN_VAZIO';
  return left === right;
}

function collectThreads() {
  try {
    const threads = Process.enumerateThreads();
    const byState = Object.create(null);

    threads.forEach(function (thread) {
      const state = thread.state || 'unknown';
      byState[state] = (byState[state] || 0) + 1;
    });

    return {
      status: 'PASS',
      count: threads.length,
      states: byState
    };
  } catch (error) {
    return {
      status: 'TOKEN_VAZIO',
      error_class: errorClass(error),
      count: 'TOKEN_VAZIO',
      states: 'TOKEN_VAZIO'
    };
  }
}

function collectRanges() {
  try {
    /*
     * Frida protection filters mean "at least these permissions".
     * Enumerate the full surface once and bucket by the exact protection
     * returned by each range. This prevents overlapping/double-counted
     * r-- / rw- / r-x / rwx queries.
     */
    const ranges = Process.enumerateRanges({
      protection: '---',
      coalesce: false
    });

    const summary = Object.create(null);
    let totalBytes = 0;

    ranges.forEach(function (range) {
      const protection = String(range.protection || 'unknown');
      if (!summary[protection]) {
        summary[protection] = { count: 0, bytes: 0 };
      }
      const size = Number(range.size) || 0;
      summary[protection].count++;
      summary[protection].bytes += size;
      totalBytes += size;
    });

    return {
      status: 'PASS',
      total_ranges: ranges.length,
      total_bytes: totalBytes,
      by_exact_protection: summary
    };
  } catch (error) {
    return {
      status: 'TOKEN_VAZIO',
      error_class: errorClass(error),
      total_ranges: 'TOKEN_VAZIO',
      total_bytes: 'TOKEN_VAZIO',
      by_exact_protection: 'TOKEN_VAZIO'
    };
  }
}

function readAndroidClock() {
  if (!Java.available) {
    return Promise.resolve({
      status: 'TOKEN_VAZIO',
      elapsed_realtime_ms: 'TOKEN_VAZIO',
      uptime_ms: 'TOKEN_VAZIO'
    });
  }

  return new Promise(function (resolve) {
    Java.perform(function () {
      try {
        const SystemClock = Java.use('android.os.SystemClock');
        resolve({
          status: 'PASS',
          elapsed_realtime_ms: scalarNumberOrText(SystemClock.elapsedRealtime()),
          uptime_ms: scalarNumberOrText(SystemClock.uptimeMillis())
        });
      } catch (error) {
        resolve({
          status: 'TOKEN_VAZIO',
          error_class: errorClass(error),
          elapsed_realtime_ms: 'TOKEN_VAZIO',
          uptime_ms: 'TOKEN_VAZIO'
        });
      }
    });
  });
}

function collectAllowlistedProperties(SystemProperties, keys) {
  const out = Object.create(null);
  if (SystemProperties === null) {
    keys.forEach(function (key) {
      out[key] = 'TOKEN_VAZIO';
    });
    return out;
  }
  keys.forEach(function (key) {
    out[key] = safe(function () {
      const value = SystemProperties.get(key, '');
      const text = value === null ? '' : value.toString();
      return text === '' ? 'TOKEN_VAZIO' : text;
    }, 'TOKEN_VAZIO');
  });
  return out;
}

function collectJavaRuntime() {
  if (!Java.available) {
    return Promise.resolve({
      status: 'TOKEN_VAZIO',
      available: false,
      token_vazio: ['JAVA_RUNTIME_UNAVAILABLE']
    });
  }

  return new Promise(function (resolve) {
    Java.perform(function () {
      const out = {
        status: 'PASS',
        available: true,
        token_vazio: []
      };

      try {
        const Build = Java.use('android.os.Build');
        const Version = Java.use('android.os.Build$VERSION');
        const Runtime = Java.use('java.lang.Runtime');
        const Debug = Java.use('android.os.Debug');
        const AndroidProcess = Java.use('android.os.Process');
        const SystemClock = Java.use('android.os.SystemClock');
        const System = Java.use('java.lang.System');
        const runtime = Runtime.getRuntime();
        const SystemProperties = safe(function () {
          return Java.use('android.os.SystemProperties');
        }, null);
        out.system_properties_status =
            SystemProperties === null ? 'TOKEN_VAZIO' : 'PASS';
        if (SystemProperties === null)
          out.token_vazio.push('SYSTEM_PROPERTIES_UNAVAILABLE');

        const abis = [];
        try {
          const supported = Build.SUPPORTED_ABIS.value;
          for (let i = 0; i !== supported.length; i++)
            abis.push(supported[i].toString());
        } catch (_) {
          out.token_vazio.push('SUPPORTED_ABIS_UNAVAILABLE');
        }

        out.platform_contract = collectAllowlistedProperties(
          SystemProperties, SAFE_SYSTEM_PROPERTIES);
        out.service_state = collectAllowlistedProperties(
          SystemProperties, SAFE_SERVICE_PROPERTIES);

        out.identity = {
          sdk: Number(Version.SDK_INT.value),
          release: String(Version.RELEASE.value),
          security_patch: String(Version.SECURITY_PATCH.value || ''),
          model: String(Build.MODEL.value || ''),
          product: String(Build.PRODUCT.value || ''),
          hardware: String(Build.HARDWARE.value || ''),
          supported_abis: abis,
          build_fingerprint: String(Build.FINGERPRINT.value || ''),
          java_vm_name: safe(function () {
            const value = System.getProperty('java.vm.name');
            return value === null ? null : value.toString();
          }, null),
          java_vm_version: safe(function () {
            const value = System.getProperty('java.vm.version');
            return value === null ? null : value.toString();
          }, null)
        };

        const deviceElapsedMs =
            scalarNumberOrText(SystemClock.elapsedRealtime());
        const processStartElapsedMs =
            scalarNumberOrText(AndroidProcess.getStartElapsedRealtime());
        out.runtime = {
          device_elapsed_ms: deviceElapsedMs,
          process_start_elapsed_ms: processStartElapsedMs,
          process_age_ms:
              typeof deviceElapsedMs === 'number' &&
              typeof processStartElapsedMs === 'number'
              ? Math.max(0, deviceElapsedMs - processStartElapsedMs)
              : 'TOKEN_VAZIO',
          process_elapsed_cpu_ms:
              scalarNumberOrText(AndroidProcess.getElapsedCpuTime()),
          java_heap_total_bytes: scalarNumberOrText(runtime.totalMemory()),
          java_heap_free_bytes: scalarNumberOrText(runtime.freeMemory()),
          java_heap_max_bytes: scalarNumberOrText(runtime.maxMemory()),
          native_heap_allocated_bytes:
              scalarNumberOrText(Debug.getNativeHeapAllocatedSize()),
          native_heap_size_bytes:
              scalarNumberOrText(Debug.getNativeHeapSize()),
          native_heap_free_bytes:
              scalarNumberOrText(Debug.getNativeHeapFreeSize()),
          process_pss_kb:
              scalarNumberOrText(Debug.getPss()),
          loaded_class_count:
              scalarNumberOrText(Debug.getLoadedClassCount())
        };
      } catch (error) {
        out.status = 'TOKEN_VAZIO';
        out.token_vazio.push('JAVA_RUNTIME_PARTIAL');
        out.error_class = errorClass(error);
      }

      resolve(out);
    });
  });
}

function instrumentationIdentity() {
  return {
    frida_version: safe(function () { return String(Frida.version); }, 'TOKEN_VAZIO'),
    script_runtime: safe(function () { return String(Script.runtime); }, 'TOKEN_VAZIO')
  };
}

function observerRuntime() {
  return {
    frida_heap_size_bytes: safe(function () {
      return Number(Frida.heapSize);
    }, 'TOKEN_VAZIO'),
    kernel_api_available: safe(function () {
      return Boolean(Kernel.available);
    }, 'TOKEN_VAZIO')
  };
}

async function collectSnapshot(reason) {
  const sequence = ++captureSequence;
  const normalizedReason = normalizeReason(reason);
  const wallStartMs = Date.now();
  const monotonicStart = await readAndroidClock();

  const modulesAtStart = collectModules();
  const threads = collectThreads();
  const ranges = collectRanges();
  const java = await collectJavaRuntime();
  const modules = collectModules();
  const moduleSurfaceStableDuringCapture =
      moduleSurfaceEqual(modulesAtStart, modules);

  const monotonicEnd = await readAndroidClock();
  const wallEndMs = Date.now();

  let monotonicDurationMs = 'TOKEN_VAZIO';
  if (
    monotonicStart.status === 'PASS' &&
    monotonicEnd.status === 'PASS' &&
    typeof monotonicStart.elapsed_realtime_ms === 'number' &&
    typeof monotonicEnd.elapsed_realtime_ms === 'number'
  ) {
    monotonicDurationMs =
        monotonicEnd.elapsed_realtime_ms - monotonicStart.elapsed_realtime_ms;
  }

  const stableIdentity = {
    arch: Process.arch,
    pointer_size: Process.pointerSize,
    page_size: Process.pageSize,
    platform: Process.platform,
    java_available: java.available === true,
    java_identity: java.identity || 'TOKEN_VAZIO',
    platform_contract: java.platform_contract || 'TOKEN_VAZIO'
  };

  const platformKeyHint = fnv1a32Text(JSON.stringify(stableIdentity));
  const moduleSurfaceKeyHint = modules.stable_set_fingerprint_hint;
  const recognitionKeyHint = fnv1a32Text(
      platformKeyHint + '|' + moduleSurfaceKeyHint);

  return {
    schema: SCHEMA,
    capture_seq: sequence,
    reason: normalizedReason,
    claim_allowed: false,

    methodology: {
      consistency_model: 'BEST_EFFORT_NON_ATOMIC',
      observer_effect: 'MEASURED_NOT_ASSUMED_ZERO',
      passive_default: true,
      periodic_polling: false,
      active_mutation: false,
      compact_hashes_authoritative: false,
      frida_cloak_semantics: 'PROCESS_INTROSPECTION_MAY_EXCLUDE_FRIDA_CLOAKED_RESOURCES',
      introspection_visibility: 'FRIDA_CLOAK_AWARE'
    },


    consistency: {
      snapshot_atomic: false,
      capture_model: 'BEST_EFFORT_NON_ATOMIC',
      module_churn_detection:
          'ENDPOINT_FENCE_ONLY_TRANSIENT_CHURN_BETWEEN_FENCES_MAY_ESCAPE',
      module_surface_stable_during_capture: moduleSurfaceStableDuringCapture,
      module_surface_start_hint:
          modulesAtStart.stable_set_fingerprint_hint || 'TOKEN_VAZIO',
      module_surface_end_hint:
          modules.stable_set_fingerprint_hint || 'TOKEN_VAZIO',
      recognition_surface_authoritative:
          moduleSurfaceStableDuringCapture === true ? true :
          moduleSurfaceStableDuringCapture === false ? false : 'TOKEN_VAZIO'
    },

    timing: {
      wall_start_epoch_ms: wallStartMs,
      wall_end_epoch_ms: wallEndMs,
      wall_duration_ms: wallEndMs - wallStartMs,
      monotonic_start: monotonicStart,
      monotonic_end: monotonicEnd,
      monotonic_duration_ms: monotonicDurationMs
    },

    instrumentation_identity: instrumentationIdentity(),

    stable_identity: stableIdentity,
    platform_key_hint: platformKeyHint,
    module_surface_key_hint: moduleSurfaceKeyHint,
    recognition_key_hint: recognitionKeyHint,

    visibility: {
      modules: modules.status,
      threads: threads.status,
      memory_ranges: ranges.status,
      java_runtime: java.status,
      system_properties:
          java.system_properties_status || 'TOKEN_VAZIO',
      android_clock_start: monotonicStart.status,
      android_clock_end: monotonicEnd.status
    },

    runtime_state: {
      pid: Process.id,
      current_tid: Process.getCurrentThreadId(),
      debugger_attached: safe(function () {
        return Process.isDebuggerAttached();
      }, 'TOKEN_VAZIO'),
      code_signing_policy: safe(function () {
        return Process.codeSigningPolicy;
      }, 'TOKEN_VAZIO'),
      observer: observerRuntime(),
      modules: modules,
      threads: threads,
      memory_ranges: ranges,
      java_runtime: java.runtime || 'TOKEN_VAZIO',
      android_services: java.service_state || 'TOKEN_VAZIO'
    },

    semantics: {
      stable_identity:
          'architecture + pointer/page size + platform + Android/ART identity',
      module_recognition_surface:
          'full loaded module name+size projection; ASLR base excluded',
      instrumentation_identity:
          'Frida version + JavaScript runtime, separate from target identity',
      volatile_runtime:
          'process instance, threads, mappings, heap and observer footprint',
      timing:
          'clock coordinates and collection duration; excluded from stability classification',
      invariant:
          'observed drift is evidence of change, not evidence of defect or cause'
    },

    gaps: {
      java: java.token_vazio || [],
      module_binary_identity:
          'TOKEN_VAZIO_NAME_AND_SIZE_DO_NOT_PROVE_BINARY_IDENTITY',
      atomic_snapshot:
          'TOKEN_VAZIO_COLLECTION_IS_SEQUENTIAL',
      module_surface_atomicity: moduleSurfaceStableDuringCapture === true
          ? 'OBSERVED_STABLE_AT_ENDPOINT_FENCES'
          : moduleSurfaceStableDuringCapture === false
          ? 'TOKEN_VAZIO_CAPTURE_RACE'
          : 'TOKEN_VAZIO_VISIBILITY',
      kernel_lmk_reason: 'TOKEN_VAZIO',
      selinux_denial_causality: 'TOKEN_VAZIO',
      physical_memory_pressure: 'TOKEN_VAZIO',
      crash_causality: 'TOKEN_VAZIO'
    },

    privacy: {
      device_serial: 'FORBIDDEN',
      android_id: 'FORBIDDEN',
      sim_identifiers: 'FORBIDDEN',
      subscriber_identifiers: 'FORBIDDEN',
      process_name: 'FORBIDDEN',
      module_paths: 'FORBIDDEN',
      payload_bytes: 'FORBIDDEN',
      ui_text: 'FORBIDDEN',
      clipboard: 'FORBIDDEN',
      file_contents: 'FORBIDDEN',
      network_payload: 'FORBIDDEN',
      credentials: 'FORBIDDEN',
      caller_reason_text: 'NOT_PERSISTED_WHEN_UNKNOWN'
    }
  };
}

function sendRuntimeEvent(event) {
  send({
    schema: SCHEMA,
    channel: CHANNEL,
    kind: 'RUNTIME_STABILITY_EVENT',
    event: Object.assign({
      event_seq: ++eventSequence,
      captured_epoch_ms: Date.now(),
      claim_allowed: false
    }, event)
  });
}

function startObservers(includeInitial) {
  if (observersActive) {
    return {
      status: 'ALREADY_ACTIVE',
      include_initial: Boolean(includeInitial)
    };
  }

  let moduleBootstrapping = true;
  let threadBootstrapping = true;
  const emitInitial = Boolean(includeInitial);

  moduleObserver = Process.attachModuleObserver({
    onAdded(module) {
      if (!moduleBootstrapping || emitInitial) {
        sendRuntimeEvent({
          event_type: 'MODULE_ADDED',
          initial_surface: moduleBootstrapping,
          module: {
            name: String(module.name),
            base: pointerText(module.base),
            size: Number(module.size)
          }
        });
      }
    },
    onRemoved(module) {
      sendRuntimeEvent({
        event_type: 'MODULE_REMOVED',
        initial_surface: false,
        module: {
          name: String(module.name),
          base: pointerText(module.base),
          size: Number(module.size)
        }
      });
    }
  });
  moduleBootstrapping = false;

  threadObserver = Process.attachThreadObserver({
    onAdded(thread) {
      if (!threadBootstrapping || emitInitial) {
        sendRuntimeEvent({
          event_type: 'THREAD_ADDED',
          initial_surface: threadBootstrapping,
          thread: { id: Number(thread.id) }
        });
      }
    },
    onRemoved(thread) {
      sendRuntimeEvent({
        event_type: 'THREAD_REMOVED',
        initial_surface: false,
        thread: { id: Number(thread.id) }
      });
    },
    onRenamed(thread, _previousName) {
      sendRuntimeEvent({
        event_type: 'THREAD_RENAMED',
        initial_surface: false,
        thread: {
          id: Number(thread.id),
          names_collected: false
        }
      });
    }
  });
  threadBootstrapping = false;

  observersActive = true;
  return {
    status: 'ACTIVE',
    include_initial: emitInitial,
    privacy: 'THREAD_NAMES_NOT_COLLECTED'
  };
}

function stopObservers() {
  if (moduleObserver !== null) {
    safe(function () { moduleObserver.detach(); }, null);
    moduleObserver = null;
  }
  if (threadObserver !== null) {
    safe(function () { threadObserver.detach(); }, null);
    threadObserver = null;
  }
  const wasActive = observersActive;
  observersActive = false;
  return { status: wasActive ? 'STOPPED' : 'ALREADY_STOPPED' };
}

async function emitSnapshot(reason) {
  const dump = await collectSnapshot(reason);
  send({
    schema: SCHEMA,
    channel: CHANNEL,
    kind: 'RUNTIME_STABILITY_DUMP',
    dump: dump
  });
  return dump;
}

rpc.exports = {
  snapshot(reason) {
    return emitSnapshot(reason || 'RPC');
  },
  startobservers(includeInitial) {
    return startObservers(Boolean(includeInitial));
  },
  stopobservers() {
    return stopObservers();
  }
};

setImmediate(function () {
  emitSnapshot('AGENT_LOAD').catch(function (error) {
    send({
      schema: SCHEMA,
      channel: CHANNEL,
      kind: 'TOKEN_VAZIO',
      gap: 'INITIAL_RUNTIME_DUMP_FAILED',
      error_class: errorClass(error),
      claim_allowed: false
    });
  });
});

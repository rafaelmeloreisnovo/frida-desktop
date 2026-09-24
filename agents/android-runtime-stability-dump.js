'use strict';

/*
 * Privacy-safe Android runtime stability / recognition dump.
 *
 * Goals:
 * - capture enough structural state to compare runs;
 * - separate platform identity, module surface and volatile runtime state;
 * - never read application payload/content;
 * - never collect device/SIM/subscriber identifiers.
 */

const SCHEMA = 'rafaelia.android.runtime-stability/v2';
const CHANNEL = 'rafaelia.android.runtime.stability';
let captureSequence = 0;

function safe(fn, fallback) {
  try {
    return fn();
  } catch (_) {
    return fallback;
  }
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

function longNumber(value) {
  if (value === null || value === undefined)
    return null;
  return safe(function () {
    const text = value.toString();
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : text;
  }, null);
}

function collectModules() {
  let modules;
  try {
    modules = Process.enumerateModules();
  } catch (error) {
    return {
      state: 'TOKEN_VAZIO',
      count: 'TOKEN_VAZIO',
      stable_set_fingerprint: 'TOKEN_VAZIO',
      modules: 'TOKEN_VAZIO',
      error_class: error === null || error === undefined ?
          'unknown' : error.constructor.name
    };
  }

  const rows = modules.map(function (module) {
    return {
      name: module.name,
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
  const nameCounts = Object.create(null);
  rows.forEach(function (row) {
    nameCounts[row.name] = (nameCounts[row.name] || 0) + 1;
  });
  const duplicateNames = Object.keys(nameCounts)
      .filter(function (name) { return nameCounts[name] > 1; })
      .sort();

  return {
    state: 'OBSERVED',
    count: rows.length,
    stable_set_fingerprint: fnv1a32Text(stableMaterial),
    recognition_scope: 'MODULE_BASENAME_SIZE_MULTISET_PATH_WITHHELD',
    exact_file_identity_claim: false,
    duplicate_names: duplicateNames,
    modules: rows
  };
}

function collectThreads() {
  let threads;
  try {
    threads = Process.enumerateThreads();
  } catch (error) {
    return {
      state: 'TOKEN_VAZIO',
      count: 'TOKEN_VAZIO',
      states: 'TOKEN_VAZIO',
      error_class: error === null || error === undefined ?
          'unknown' : error.constructor.name
    };
  }

  const byState = Object.create(null);
  threads.forEach(function (thread) {
    const state = thread.state || 'unknown';
    byState[state] = (byState[state] || 0) + 1;
  });

  return {
    state: 'OBSERVED',
    count: threads.length,
    states: byState
  };
}

function collectRanges() {
  const protections = ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx'];
  let ranges;
  try {
    // Frida's protection filter means "at least these permissions". Querying
    // r--, rw-, r-x, ... separately overlaps. Enumerate everything once and
    // aggregate by each range's exact returned protection.
    ranges = Process.enumerateRanges({ protection: '---', coalesce: false });
  } catch (error) {
    const failed = Object.create(null);
    protections.forEach(function (protection) {
      failed[protection] = {
        state: 'TOKEN_VAZIO',
        count: 'TOKEN_VAZIO',
        bytes: 'TOKEN_VAZIO'
      };
    });
    failed._meta = {
      state: 'TOKEN_VAZIO',
      semantics: 'SINGLE_ENUMERATION_EXACT_RETURNED_PROTECTION',
      total_count: 'TOKEN_VAZIO',
      total_bytes: 'TOKEN_VAZIO',
      overlap_by_construction: false,
      error_class: error === null || error === undefined ?
          'unknown' : error.constructor.name
    };
    return failed;
  }

  const summary = Object.create(null);
  protections.forEach(function (protection) {
    summary[protection] = { state: 'OBSERVED', count: 0, bytes: 0 };
  });

  let totalBytes = 0;
  ranges.forEach(function (range) {
    const protection = range.protection || 'unknown';
    if (!summary[protection])
      summary[protection] = { state: 'OBSERVED', count: 0, bytes: 0 };
    summary[protection].count += 1;
    summary[protection].bytes += Number(range.size) || 0;
    totalBytes += Number(range.size) || 0;
  });

  summary._meta = {
    state: 'OBSERVED',
    semantics: 'SINGLE_ENUMERATION_EXACT_RETURNED_PROTECTION',
    total_count: ranges.length,
    total_bytes: totalBytes,
    overlap_by_construction: false
  };
  return summary;
}

function moduleSurfaceMaterial(modules) {
  if (!modules || modules.state !== 'OBSERVED' || !Array.isArray(modules.modules))
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

function collectJavaRuntime() {
  if (!Java.available) {
    return Promise.resolve({
      available: false,
      token_vazio: ['JAVA_RUNTIME_UNAVAILABLE']
    });
  }

  return new Promise(function (resolve) {
    Java.perform(function () {
      const out = {
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

        const abis = [];
        try {
          const supported = Build.SUPPORTED_ABIS.value;
          for (let i = 0; i !== supported.length; i++)
            abis.push(supported[i].toString());
        } catch (_) {
          out.token_vazio.push('SUPPORTED_ABIS_UNAVAILABLE');
        }

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

        const elapsedMs = longNumber(SystemClock.elapsedRealtime());
        const processStartElapsedMs = longNumber(
            AndroidProcess.getStartElapsedRealtime());
        out.runtime = {
          device_elapsed_ms: elapsedMs,
          process_start_elapsed_ms: processStartElapsedMs,
          process_age_ms:
              typeof elapsedMs === 'number' &&
              typeof processStartElapsedMs === 'number'
              ? Math.max(0, elapsedMs - processStartElapsedMs)
              : 'TOKEN_VAZIO',
          process_elapsed_cpu_ms: longNumber(AndroidProcess.getElapsedCpuTime()),
          java_heap_total_bytes: longNumber(runtime.totalMemory()),
          java_heap_free_bytes: longNumber(runtime.freeMemory()),
          java_heap_max_bytes: longNumber(runtime.maxMemory()),
          native_heap_size_bytes: longNumber(Debug.getNativeHeapSize()),
          native_heap_allocated_bytes: longNumber(Debug.getNativeHeapAllocatedSize()),
          native_heap_free_bytes: longNumber(Debug.getNativeHeapFreeSize()),
          pss_kb: longNumber(Debug.getPss())
        };
      } catch (error) {
        out.token_vazio.push('JAVA_RUNTIME_PARTIAL');
        out.error_class = error === null || error === undefined ?
            'unknown' : error.constructor.name;
      }

      resolve(out);
    });
  });
}

async function collectSnapshot(reason) {
  const captureStartedEpochMs = Date.now();
  const sequence = ++captureSequence;
  const modulesAtStart = collectModules();
  const threads = collectThreads();
  const ranges = collectRanges();
  const java = await collectJavaRuntime();
  const modules = collectModules();
  const moduleSurfaceStableDuringCapture =
      moduleSurfaceEqual(modulesAtStart, modules);

  const stableIdentity = {
    arch: Process.arch,
    pointer_size: Process.pointerSize,
    page_size: Process.pageSize,
    platform: Process.platform,
    java_available: java.available === true,
    java_identity: java.identity || 'TOKEN_VAZIO'
  };

  const platformKey = fnv1a32Text(JSON.stringify(stableIdentity));
  const moduleSurfaceKey = modules.stable_set_fingerprint;
  const recognitionKey = fnv1a32Text(
      platformKey + '|' + moduleSurfaceKey);
  const captureFinishedEpochMs = Date.now();
  const deviceElapsedMs = java.runtime &&
      typeof java.runtime.device_elapsed_ms === 'number'
      ? java.runtime.device_elapsed_ms : null;
  const estimatedBootEpochMs = deviceElapsedMs === null
      ? 'TOKEN_VAZIO'
      : captureFinishedEpochMs - deviceElapsedMs;

  return {
    schema: SCHEMA,
    capture_seq: sequence,
    reason: reason || 'MANUAL',
    captured_epoch_ms: captureFinishedEpochMs,
    clock_context: {
      wall_epoch_ms: captureFinishedEpochMs,
      device_elapsed_ms: deviceElapsedMs === null ? 'TOKEN_VAZIO' : deviceElapsedMs,
      estimated_boot_epoch_ms: estimatedBootEpochMs,
      estimated_boot_epoch_semantics: 'APPROXIMATE_WALL_MINUS_ELAPSED_NOT_AUTHORITY'
    },
    observer: {
      agent_schema: SCHEMA,
      frida_version: safe(function () { return Frida.version; }, 'TOKEN_VAZIO'),
      capture_started_epoch_ms: captureStartedEpochMs,
      capture_finished_epoch_ms: captureFinishedEpochMs,
      capture_wall_duration_ms: Math.max(0, captureFinishedEpochMs - captureStartedEpochMs),
      instrumentation_present: true,
      observer_effect: 'POSSIBLE_NOT_QUANTIFIED',
      introspection_visibility: 'FRIDA_CLOAK_AWARE',
      introspection_note:
          'Frida-created cloaked resources may be absent from thread/range introspection',
      memory_range_semantics: 'SINGLE_ENUMERATION_EXACT_RETURNED_PROTECTION'
    },
    consistency: {
      snapshot_atomic: false,
      capture_model: 'NON_ATOMIC_SEQUENTIAL_OBSERVATION',
      module_churn_detection:
          'ENDPOINT_FENCE_ONLY_TRANSIENT_CHURN_BETWEEN_FENCES_MAY_ESCAPE',
      module_surface_stable_during_capture: moduleSurfaceStableDuringCapture,
      module_surface_start_hint: modulesAtStart.stable_set_fingerprint,
      module_surface_end_hint: modules.stable_set_fingerprint,
      recognition_surface_authoritative:
          moduleSurfaceStableDuringCapture === true ? true :
          moduleSurfaceStableDuringCapture === false ? false : 'TOKEN_VAZIO'
    },
    claim_allowed: false,

    semantics: {
      stable_identity: [
        'arch',
        'pointer_size',
        'page_size',
        'platform',
        'java_available',
        'java_identity_when_available'
      ],
      recognition_surface: [
        'loaded_module_name_size_multiset',
        'privacy_preserving_not_exact_file_identity'
      ],
      volatile_observations: [
        'pid',
        'current_tid',
        'module_base',
        'thread_count',
        'thread_states',
        'memory_range_summary',
        'heap_counters',
        'pss_kb',
        'process_start_elapsed_ms',
        'process_age_ms',
        'process_elapsed_cpu_ms',
        'device_elapsed_ms'
      ],
      invariant:
          'platform drift, module-surface drift and volatile runtime drift are distinct evidence classes'
    },

    stable_identity: stableIdentity,
    platform_key: platformKey,
    module_surface_key: moduleSurfaceKey,
    recognition_key: recognitionKey,

    runtime_state: {
      pid: Process.id,
      current_tid: Process.getCurrentThreadId(),
      debugger_attached: safe(function () {
        return Process.isDebuggerAttached();
      }, 'TOKEN_VAZIO'),
      code_signing_policy: safe(function () {
        return Process.codeSigningPolicy;
      }, 'TOKEN_VAZIO'),
      modules: modules,
      threads: threads,
      memory_ranges: ranges,
      java_runtime: java.runtime || 'TOKEN_VAZIO'
    },

    gaps: {
      java: java.token_vazio || [],
      kernel_lmk_reason: 'TOKEN_VAZIO',
      selinux_denial_causality: 'TOKEN_VAZIO',
      physical_memory_pressure: 'TOKEN_VAZIO',
      crash_causality: 'TOKEN_VAZIO',
      module_surface_atomicity:
          moduleSurfaceStableDuringCapture === true
          ? 'OBSERVED_STABLE_DURING_CAPTURE'
          : moduleSurfaceStableDuringCapture === false
          ? 'TOKEN_VAZIO_CAPTURE_RACE'
          : 'TOKEN_VAZIO_MODULE_COLLECTOR'
    },

    privacy: {
      device_serial: 'FORBIDDEN',
      android_id: 'FORBIDDEN',
      sim_identifiers: 'FORBIDDEN',
      subscriber_identifiers: 'FORBIDDEN',
      payload_bytes: 'FORBIDDEN',
      ui_text: 'FORBIDDEN',
      clipboard: 'FORBIDDEN',
      file_contents: 'FORBIDDEN'
    }
  };
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
  snapshot: function (reason) {
    return emitSnapshot(reason || 'RPC');
  }
};

setImmediate(function () {
  emitSnapshot('AGENT_LOAD').catch(function (error) {
    send({
      schema: SCHEMA,
      channel: CHANNEL,
      kind: 'TOKEN_VAZIO',
      gap: 'INITIAL_RUNTIME_DUMP_FAILED',
      error_class: error === null || error === undefined ?
          'unknown' : error.constructor.name,
      claim_allowed: false
    });
  });
});

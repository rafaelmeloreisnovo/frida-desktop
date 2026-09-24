import { HyperMemoryRuntime } from './hypermemory-runtime';

const DUMP_SCHEMA = 'rafaelia.android.runtime-stability/v2';
const DIFF_SCHEMA = 'rafaelia.android.runtime-stability-diff/v2';
const EVENT_SCHEMA = 'rafaelia.frida.runtime-stability-hypermemory-event/v1';

export interface RuntimeStabilityBridgeOptions {
  sourceSha256?: string;
}

function asObject(value: unknown, label: string): Record<string, any> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value as Record<string, any>;
}

function validateClaimBoundary(value: Record<string, any>): void {
  if (value.claim_allowed !== false) {
    throw new Error('runtime stability evidence must keep claim_allowed=false');
  }
}

function normalizeSourceSha256(value?: string): string {
  if (!value || value.trim() === '') return 'TOKEN_VAZIO';
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error('sourceSha256 must contain exactly 64 hex characters');
  }
  return normalized;
}

function pathsOnly(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(item => item && typeof item === 'object' && typeof item.path === 'string')
    .map(item => item.path);
}

export class RuntimeStabilityHyperMemoryBridge {
  constructor(private readonly hyperMemory: HyperMemoryRuntime) {}

  appendDump(rawDump: unknown, options: RuntimeStabilityBridgeOptions = {}): number {
    const dump = asObject(rawDump, 'dump');
    if (dump.schema !== DUMP_SCHEMA) {
      throw new Error(`unsupported runtime stability dump schema: ${String(dump.schema)}`);
    }
    validateClaimBoundary(dump);

    const runtime = asObject(dump.runtime_state ?? {}, 'runtime_state');
    const modules = asObject(runtime.modules ?? {}, 'runtime_state.modules');
    const threads = asObject(runtime.threads ?? {}, 'runtime_state.threads');

    return this.hyperMemory.appendJson('runtime-stability-dump', {
      schema: EVENT_SCHEMA,
      event_kind: 'STABILITY_DUMP',
      source_schema: DUMP_SCHEMA,
      source_sha256: normalizeSourceSha256(options.sourceSha256),
      capture_seq: dump.capture_seq ?? 'TOKEN_VAZIO',
      reason: dump.reason ?? 'TOKEN_VAZIO',
      instrumentation_identity: dump.instrumentation_identity ?? 'TOKEN_VAZIO',
      stable_identity: dump.stable_identity ?? 'TOKEN_VAZIO',
      visibility: dump.visibility ?? 'TOKEN_VAZIO',
      recognition: {
        platform_key_hint: dump.platform_key_hint ?? 'TOKEN_VAZIO',
        module_surface_key_hint: dump.module_surface_key_hint ?? 'TOKEN_VAZIO',
        recognition_key_hint: dump.recognition_key_hint ?? 'TOKEN_VAZIO',
        module_count: modules.count ?? 'TOKEN_VAZIO'
      },
      runtime_summary: {
        pid: runtime.pid ?? 'TOKEN_VAZIO',
        current_tid: runtime.current_tid ?? 'TOKEN_VAZIO',
        debugger_attached: runtime.debugger_attached ?? 'TOKEN_VAZIO',
        code_signing_policy: runtime.code_signing_policy ?? 'TOKEN_VAZIO',
        thread_count: threads.count ?? 'TOKEN_VAZIO',
        thread_states: threads.states ?? 'TOKEN_VAZIO',
        memory_ranges: runtime.memory_ranges ?? 'TOKEN_VAZIO',
        java_runtime: runtime.java_runtime ?? 'TOKEN_VAZIO',
        observer: runtime.observer ?? 'TOKEN_VAZIO'
      },
      timing: dump.timing ?? 'TOKEN_VAZIO',
      gaps: dump.gaps ?? 'TOKEN_VAZIO',
      full_module_list_embedded: false,
      causality: 'NOT_INFERRED',
      claim_allowed: false
    });
  }

  appendDiff(rawDiff: unknown, options: RuntimeStabilityBridgeOptions = {}): number {
    const diff = asObject(rawDiff, 'diff');
    if (diff.schema !== DIFF_SCHEMA) {
      throw new Error(`unsupported runtime stability diff schema: ${String(diff.schema)}`);
    }
    validateClaimBoundary(diff);

    return this.hyperMemory.appendJson('runtime-stability-diff', {
      schema: EVENT_SCHEMA,
      event_kind: 'STABILITY_DIFF',
      source_schema: DIFF_SCHEMA,
      source_sha256: normalizeSourceSha256(options.sourceSha256),
      classification: diff.classification ?? 'TOKEN_VAZIO',
      comparable: diff.comparable ?? 'TOKEN_VAZIO',
      recognition_match: diff.recognition_match ?? 'TOKEN_VAZIO',
      change_paths: {
        visibility: pathsOnly(diff.visibility_changes),
        instrumentation: pathsOnly(diff.instrumentation_changes),
        identity: pathsOnly(diff.identity_changes),
        modules: pathsOnly(diff.module_surface_changes),
        runtime: pathsOnly(diff.runtime_changes),
        process_instance: pathsOnly(diff.process_instance_changes),
        observer_effect: pathsOnly(diff.observer_effect_changes),
        compact_hints: pathsOnly(diff.compact_hint_changes)
      },
      excluded_from_classification: diff.excluded_from_classification ?? 'TOKEN_VAZIO',
      causality: 'NOT_INFERRED',
      claim_allowed: false
    });
  }
}

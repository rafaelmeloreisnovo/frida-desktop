import { HyperMemoryRuntime } from './hypermemory-runtime';

const DUMP_SCHEMA = 'rafaelia.android.runtime-stability/v2';
const DIFF_SCHEMA = 'rafaelia.android.runtime-stability-diff/v2';
const BRIDGE_SCHEMA = 'rafaelia.runtime-stability-hypermemory-bridge/v2';

export interface RuntimeStabilityBridgeOptions {
  sourceSha256?: string;
}

export interface RuntimeOutcomeEvent {
  timestamp: number;
  layer:
    | 'JAVA'
    | 'DEX_ART'
    | 'JNI'
    | 'NATIVE_ELF'
    | 'KERNEL'
    | 'SELINUX'
    | 'LMKD'
    | 'PROCESS'
    | 'UNKNOWN';
  event_type: string;
  source: string;
  process_generation?: number;
  thread_id?: number;
  evidence_ref?: string;
  outcome?: 'OBSERVED' | 'FAIL' | 'RECOVERED' | 'TOKEN_VAZIO';
}

interface BridgeEnvelope {
  schema: typeof BRIDGE_SCHEMA;
  event_kind: 'STABILITY_DUMP' | 'STABILITY_DIFF' | 'OUTCOME';
  observed_at: number;
  previous_payload_sha256:
    | string
    | 'GENESIS'
    | 'TOKEN_VAZIO_EVICTED_PREDECESSOR';
  source_sha256: string;
  payload: Record<string, unknown>;
  claim_allowed: false;
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
    .map(item => {
      if (!item || typeof item !== 'object') return null;
      const path = (item as { path?: unknown }).path;
      return typeof path === 'string' ? path : null;
    })
    .filter((path): path is string => path !== null)
    .sort();
}

function tokenGapKeys(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>)
    .filter(([, nested]) =>
      typeof nested === 'string' && nested.startsWith('TOKEN_VAZIO'))
    .map(([key]) => key)
    .sort();
}

export class RuntimeStabilityHyperMemoryBridge {
  constructor(private readonly hyperMemory: HyperMemoryRuntime) {}

  appendDump(
    rawDump: unknown,
    options: RuntimeStabilityBridgeOptions = {}
  ): number {
    const dump = asObject(rawDump, 'dump');
    if (dump.schema !== DUMP_SCHEMA) {
      throw new Error(
        `unsupported runtime stability dump schema: ${String(dump.schema)}`
      );
    }
    validateClaimBoundary(dump);

    const runtime = asObject(dump.runtime_state ?? {}, 'runtime_state');
    const modules = asObject(runtime.modules ?? {}, 'runtime_state.modules');
    const threads = asObject(runtime.threads ?? {}, 'runtime_state.threads');
    const javaRuntime =
      runtime.java_runtime && typeof runtime.java_runtime === 'object'
        ? runtime.java_runtime as Record<string, unknown>
        : {};
    const stable =
      dump.stable_identity && typeof dump.stable_identity === 'object'
        ? dump.stable_identity as Record<string, unknown>
        : {};
    const provenance =
      dump.capture_provenance && typeof dump.capture_provenance === 'object'
        ? dump.capture_provenance as Record<string, unknown>
        : {};
    const context =
      dump.platform_context && typeof dump.platform_context === 'object'
        ? dump.platform_context as Record<string, unknown>
        : {};
    const consistency =
      dump.consistency && typeof dump.consistency === 'object'
        ? dump.consistency as Record<string, unknown>
        : {};

    const payload: Record<string, unknown> = {
      capture_seq: dump.capture_seq ?? 'TOKEN_VAZIO',
      reason: dump.reason ?? 'TOKEN_VAZIO',
      condition_id: provenance.condition_id ?? 'UNSPECIFIED',
      instrumentation_identity:
        dump.instrumentation_identity ?? 'TOKEN_VAZIO',
      stable_identity_minimal: {
        arch: stable.arch ?? 'TOKEN_VAZIO',
        pointer_size: stable.pointer_size ?? 'TOKEN_VAZIO',
        page_size: stable.page_size ?? 'TOKEN_VAZIO',
        platform: stable.platform ?? 'TOKEN_VAZIO',
        java_available: stable.java_available ?? 'TOKEN_VAZIO'
      },
      visibility: dump.visibility ?? 'TOKEN_VAZIO',
      consistency: {
        module_surface_stable_during_capture:
          consistency.module_surface_stable_during_capture ?? 'TOKEN_VAZIO',
        snapshot_atomic: consistency.snapshot_atomic ?? false
      },
      recognition: {
        platform_key_hint: dump.platform_key_hint ?? 'TOKEN_VAZIO',
        module_surface_key_hint:
          dump.module_surface_key_hint ?? 'TOKEN_VAZIO',
        recognition_key_hint: dump.recognition_key_hint ?? 'TOKEN_VAZIO',
        compact_fingerprint_role: 'HINT_ONLY',
        module_count: modules.count ?? 'TOKEN_VAZIO'
      },
      process_instance: {
        pid: runtime.pid ?? 'TOKEN_VAZIO',
        current_tid: runtime.current_tid ?? 'TOKEN_VAZIO',
        process_start_elapsed_ms:
          javaRuntime.process_start_elapsed_ms ?? 'TOKEN_VAZIO',
        process_age_ms: javaRuntime.process_age_ms ?? 'TOKEN_VAZIO'
      },
      runtime_summary: {
        debugger_attached: runtime.debugger_attached ?? 'TOKEN_VAZIO',
        thread_count: threads.count ?? 'TOKEN_VAZIO',
        process_pss_kb: javaRuntime.process_pss_kb ?? 'TOKEN_VAZIO',
        native_heap_allocated_bytes:
          javaRuntime.native_heap_allocated_bytes ?? 'TOKEN_VAZIO'
      },
      boot_session_sha256:
        context.boot_session_sha256 ?? 'TOKEN_VAZIO',
      unresolved_gap_keys: tokenGapKeys(dump.gaps),
      raw_module_list_embedded: false,
      java_build_identity_embedded: false,
      causality: 'NOT_INFERRED',
      stability_claim: 'NOT_PROMOTED'
    };

    return this.appendEnvelope(
      'STABILITY_DUMP',
      payload,
      normalizeSourceSha256(options.sourceSha256)
    );
  }

  appendDiff(
    rawDiff: unknown,
    options: RuntimeStabilityBridgeOptions = {}
  ): number {
    const diff = asObject(rawDiff, 'diff');
    if (diff.schema !== DIFF_SCHEMA) {
      throw new Error(
        `unsupported runtime stability diff schema: ${String(diff.schema)}`
      );
    }
    validateClaimBoundary(diff);

    const payload: Record<string, unknown> = {
      classification: diff.classification ?? 'TOKEN_VAZIO',
      comparison_status: diff.comparison_status ??
        (diff.comparable === true ? 'COMPARABLE' : 'TOKEN_VAZIO'),
      comparable: diff.comparable ?? 'TOKEN_VAZIO',
      condition_id: diff.condition_id ?? 'UNSPECIFIED',
      boot_session_match: diff.boot_session_match ?? 'TOKEN_VAZIO',
      process_instance_match: diff.process_instance_match ?? 'TOKEN_VAZIO',
      platform_identity_match:
        diff.platform_identity_match ?? 'TOKEN_VAZIO',
      instrumentation_match:
        diff.instrumentation_match ?? 'TOKEN_VAZIO',
      module_surface_match: diff.module_surface_match ?? 'TOKEN_VAZIO',
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
      causality: 'NOT_INFERRED',
      stability_claim: 'NOT_PROMOTED',
      before_after_values_embedded: false
    };

    return this.appendEnvelope(
      'STABILITY_DIFF',
      payload,
      normalizeSourceSha256(options.sourceSha256)
    );
  }

  appendOutcome(event: RuntimeOutcomeEvent): number {
    if (!Number.isSafeInteger(event.timestamp) || event.timestamp < 0) {
      throw new Error('outcome timestamp must be a non-negative safe integer');
    }
    if (!event.event_type || event.event_type.trim().length === 0) {
      throw new Error('outcome event_type is required');
    }
    if (!event.source || event.source.trim().length === 0) {
      throw new Error('outcome source is required');
    }

    return this.appendEnvelope(
      'OUTCOME',
      {
        timestamp: event.timestamp,
        layer: event.layer,
        event_type: event.event_type.trim(),
        source: event.source.trim(),
        process_generation: event.process_generation ?? 'TOKEN_VAZIO',
        thread_id: event.thread_id ?? 'TOKEN_VAZIO',
        evidence_ref: event.evidence_ref ?? 'TOKEN_VAZIO',
        outcome: event.outcome ?? 'OBSERVED',
        causal_role: 'OBSERVATION_ONLY'
      },
      'TOKEN_VAZIO'
    );
  }

  private appendEnvelope(
    eventKind: BridgeEnvelope['event_kind'],
    payload: Record<string, unknown>,
    sourceSha256: string
  ): number {
    const previous = this.hyperMemory
      .readRecords()
      .filter(record => record.kind === 'runtime-causal-event.v2')
      .slice(-1)[0];

    const stats = this.hyperMemory.getStats();
    const predecessor = previous?.sha256 ??
      (stats.evictions > 0
        ? 'TOKEN_VAZIO_EVICTED_PREDECESSOR'
        : 'GENESIS');

    const envelope: BridgeEnvelope = {
      schema: BRIDGE_SCHEMA,
      event_kind: eventKind,
      observed_at: Date.now(),
      previous_payload_sha256: predecessor,
      source_sha256: sourceSha256,
      payload,
      claim_allowed: false
    };

    return this.hyperMemory.appendJson('runtime-causal-event.v2', envelope);
  }
}

export {
  BRIDGE_SCHEMA as RUNTIME_STABILITY_HYPERMEMORY_BRIDGE_SCHEMA
};

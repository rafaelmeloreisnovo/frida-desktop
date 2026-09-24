import { HyperMemoryRuntime } from './hypermemory-runtime';

const DUMP_SCHEMA = 'rafaelia.android.runtime-stability/v1';
const DIFF_SCHEMA = 'rafaelia.android.runtime-stability-diff/v1';
const BRIDGE_SCHEMA = 'rafaelia.runtime-stability-hypermemory-bridge/v1';

export interface RuntimeStabilityDumpLike {
  schema: string;
  capture_seq?: number;
  reason?: string;
  captured_epoch_ms?: number;
  platform_key?: string;
  module_surface_key?: string;
  recognition_key?: string;
  stable_identity?: {
    arch?: string;
    pointer_size?: number;
    page_size?: number;
    platform?: string;
  };
  runtime_state?: {
    pid?: number;
    current_tid?: number;
    debugger_attached?: boolean | string;
    modules?: { count?: number };
    threads?: { count?: number };
  };
  gaps?: Record<string, unknown>;
}

export interface RuntimeStabilityDiffLike {
  schema: string;
  classification?: string;
  platform_identity_match?: boolean;
  module_surface_match?: boolean;
  recognition_match?: boolean;
  identity_changes?: Array<{ path?: string }>;
  observer_changes?: Array<{ path?: string }>;
  module_surface_changes?: Array<{ path?: string }>;
  runtime_changes?: Array<{ path?: string }>;
  hint_changes?: Array<{ path?: string }>;
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
  previous_payload_sha256: string | 'GENESIS';
  payload: Record<string, unknown>;
  claim_allowed: false;
}

function safeText(value: unknown, fallback = 'TOKEN_VAZIO'): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
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

export class RuntimeStabilityHyperMemoryBridge {
  constructor(private readonly hyperMemory: HyperMemoryRuntime) {}

  appendDump(dump: RuntimeStabilityDumpLike): number {
    if (dump.schema !== DUMP_SCHEMA) {
      throw new Error('unsupported runtime stability dump schema: ' + dump.schema);
    }

    const payload: Record<string, unknown> = {
      capture_seq: dump.capture_seq ?? 'TOKEN_VAZIO',
      reason: safeText(dump.reason),
      captured_epoch_ms: dump.captured_epoch_ms ?? 'TOKEN_VAZIO',
      platform_key_hint: safeText(dump.platform_key),
      module_surface_key_hint: safeText(dump.module_surface_key),
      recognition_key_hint: safeText(dump.recognition_key),
      compact_fingerprint_role: 'HINT_ONLY',
      stable_identity: {
        arch: dump.stable_identity?.arch ?? 'TOKEN_VAZIO',
        pointer_size: dump.stable_identity?.pointer_size ?? 'TOKEN_VAZIO',
        page_size: dump.stable_identity?.page_size ?? 'TOKEN_VAZIO',
        platform: dump.stable_identity?.platform ?? 'TOKEN_VAZIO'
      },
      runtime_state: {
        pid: dump.runtime_state?.pid ?? 'TOKEN_VAZIO',
        current_tid: dump.runtime_state?.current_tid ?? 'TOKEN_VAZIO',
        debugger_attached:
          dump.runtime_state?.debugger_attached ?? 'TOKEN_VAZIO',
        module_count: dump.runtime_state?.modules?.count ?? 'TOKEN_VAZIO',
        thread_count: dump.runtime_state?.threads?.count ?? 'TOKEN_VAZIO'
      },
      unresolved_gap_keys: dump.gaps
        ? Object.entries(dump.gaps)
            .filter(([, value]) =>
              typeof value === 'string' && value.startsWith('TOKEN_VAZIO')
            )
            .map(([key]) => key)
            .sort()
        : []
    };

    return this.appendEnvelope('STABILITY_DUMP', payload);
  }

  appendDiff(diff: RuntimeStabilityDiffLike): number {
    if (diff.schema !== DIFF_SCHEMA) {
      throw new Error('unsupported runtime stability diff schema: ' + diff.schema);
    }

    const payload: Record<string, unknown> = {
      classification: safeText(diff.classification),
      platform_identity_match:
        diff.platform_identity_match ?? 'TOKEN_VAZIO',
      module_surface_match: diff.module_surface_match ?? 'TOKEN_VAZIO',
      recognition_match: diff.recognition_match ?? 'TOKEN_VAZIO',
      identity_change_paths: pathsOnly(diff.identity_changes),
      observer_change_paths: pathsOnly(diff.observer_changes),
      module_surface_change_paths: pathsOnly(diff.module_surface_changes),
      runtime_change_paths: pathsOnly(diff.runtime_changes),
      hint_change_paths: pathsOnly(diff.hint_changes),
      causality: 'NOT_INFERRED',
      stability_claim: 'NOT_PROMOTED'
    };

    return this.appendEnvelope('STABILITY_DIFF', payload);
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

    const payload: Record<string, unknown> = {
      timestamp: event.timestamp,
      layer: event.layer,
      event_type: event.event_type.trim(),
      source: event.source.trim(),
      process_generation: event.process_generation ?? 'TOKEN_VAZIO',
      thread_id: event.thread_id ?? 'TOKEN_VAZIO',
      evidence_ref: event.evidence_ref ?? 'TOKEN_VAZIO',
      outcome: event.outcome ?? 'OBSERVED',
      causal_role: 'OBSERVATION_ONLY'
    };

    return this.appendEnvelope('OUTCOME', payload);
  }

  private appendEnvelope(
    eventKind: BridgeEnvelope['event_kind'],
    payload: Record<string, unknown>
  ): number {
    const previous = this.hyperMemory
      .readRecords()
      .filter(record => record.kind === 'runtime-causal-event.v1')
      .slice(-1)[0];

    const stats = this.hyperMemory.getStats();
    const predecessor = previous?.sha256 ??
      (stats.evictions > 0 ? 'TOKEN_VAZIO_EVICTED_PREDECESSOR' : 'GENESIS');

    const envelope: BridgeEnvelope = {
      schema: BRIDGE_SCHEMA,
      event_kind: eventKind,
      observed_at: Date.now(),
      previous_payload_sha256: predecessor,
      payload,
      claim_allowed: false
    };

    return this.hyperMemory.appendJson('runtime-causal-event.v1', envelope);
  }
}

export { BRIDGE_SCHEMA as RUNTIME_STABILITY_HYPERMEMORY_BRIDGE_SCHEMA };

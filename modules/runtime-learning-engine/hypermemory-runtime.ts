import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const SCHEMA = 'rafaelia.frida.hypermemory-runtime/v1';
const DEFAULT_CAPACITY_BYTES = 1024 * 1024;
const DEFAULT_CHECKPOINT_INTERVAL_MS = 15000;
const FRAME_OVERHEAD_BYTES = 64;

export type HyperMemoryRecoveryState =
  | 'FRESH'
  | 'RESTORED'
  | 'QUARANTINED_CORRUPT'
  | 'DISABLED';

export interface HyperMemoryRuntimeOptions {
  storagePath: string;
  capacityBytes?: number;
  checkpointIntervalMs?: number;
  enabled?: boolean;
}

export interface HyperMemoryRecordView {
  sequence: number;
  timestamp: number;
  kind: string;
  payload: Buffer;
  sha256: string;
}

export interface HyperMemoryStats {
  schema: typeof SCHEMA;
  running: boolean;
  enabled: boolean;
  arena_kind: 'RAM_BOUNDED_RING';
  durability: 'ATOMIC_FILE_CHECKPOINT';
  capacity_bytes: number;
  used_bytes: number;
  records: number;
  evictions: number;
  generation: number;
  next_sequence: number;
  recovery_state: HyperMemoryRecoveryState;
  checkpoint_path: string;
  process_immortality_claim: false;
  android_physical_supervisor: 'TOKEN_VAZIO_NOT_PROVEN';
}

interface MemoryRecord {
  sequence: number;
  timestamp: number;
  kind: string;
  payload: Buffer;
  sha256: string;
  frameBytes: number;
}

interface PersistedRecord {
  sequence: number;
  timestamp: number;
  kind: string;
  payload_base64: string;
  payload_bytes: number;
  sha256: string;
}

interface SnapshotBody {
  schema: typeof SCHEMA;
  generation: number;
  created_at: number;
  capacity_bytes: number;
  used_bytes: number;
  evictions: number;
  next_sequence: number;
  records: PersistedRecord[];
}

interface PersistedSnapshot extends SnapshotBody {
  integrity_sha256: string;
}

function sha256(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function frameSize(kind: string, payloadBytes: number): number {
  return FRAME_OVERHEAD_BYTES + Buffer.byteLength(kind, 'utf8') + payloadBytes;
}

export class HyperMemoryRuntime {
  private readonly enabled: boolean;
  private readonly capacityBytes: number;
  private readonly checkpointIntervalMs: number;
  private readonly checkpointPath: string;
  private readonly records: MemoryRecord[] = [];

  private usedBytes = 0;
  private evictions = 0;
  private generation = 1;
  private nextSequence = 1;
  private running = false;
  private recoveryState: HyperMemoryRecoveryState = 'FRESH';
  private checkpointTimer: NodeJS.Timeout | null = null;

  constructor(options: HyperMemoryRuntimeOptions) {
    if (!options.storagePath || options.storagePath.trim().length === 0) {
      throw new Error('storagePath is required');
    }

    this.enabled = options.enabled !== false;
    this.capacityBytes = options.capacityBytes ?? DEFAULT_CAPACITY_BYTES;
    this.checkpointIntervalMs =
      options.checkpointIntervalMs ?? DEFAULT_CHECKPOINT_INTERVAL_MS;
    this.checkpointPath = path.join(
      options.storagePath,
      'hypermemory-runtime.v1.json'
    );

    if (!Number.isSafeInteger(this.capacityBytes) || this.capacityBytes < 256) {
      throw new Error('capacityBytes must be a safe integer >= 256');
    }
    if (
      !Number.isSafeInteger(this.checkpointIntervalMs) ||
      this.checkpointIntervalMs < 0
    ) {
      throw new Error('checkpointIntervalMs must be a safe integer >= 0');
    }
  }

  async start(): Promise<void> {
    if (this.running) return;

    if (!this.enabled) {
      this.recoveryState = 'DISABLED';
      return;
    }

    fs.mkdirSync(path.dirname(this.checkpointPath), { recursive: true });
    this.restoreCheckpoint();
    this.running = true;

    if (this.checkpointIntervalMs > 0) {
      this.checkpointTimer = setInterval(() => {
        try {
          this.checkpoint();
        } catch (error) {
          console.error('[HyperMemoryRuntime] checkpoint failed:', error);
        }
      }, this.checkpointIntervalMs);

      if (typeof this.checkpointTimer.unref === 'function') {
        this.checkpointTimer.unref();
      }
    }
  }

  append(kind: string, payload: string | Uint8Array): number {
    this.assertWritable();

    const normalizedKind = kind.trim();
    if (normalizedKind.length === 0 || normalizedKind.length > 128) {
      throw new Error('kind must contain 1..128 characters');
    }

    const bytes =
      typeof payload === 'string'
        ? Buffer.from(payload, 'utf8')
        : Buffer.from(payload);

    const requiredBytes = frameSize(normalizedKind, bytes.length);
    if (requiredBytes > this.capacityBytes) {
      throw new Error(
        `record requires ${requiredBytes} bytes, capacity is ${this.capacityBytes}`
      );
    }

    while (
      this.records.length > 0 &&
      this.usedBytes + requiredBytes > this.capacityBytes
    ) {
      const removed = this.records.shift();
      if (!removed) break;
      this.usedBytes -= removed.frameBytes;
      this.evictions++;
    }

    const sequence = this.nextSequence++;
    this.records.push({
      sequence,
      timestamp: Date.now(),
      kind: normalizedKind,
      payload: bytes,
      sha256: sha256(bytes),
      frameBytes: requiredBytes
    });
    this.usedBytes += requiredBytes;

    return sequence;
  }

  appendJson(kind: string, value: unknown): number {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) {
      throw new Error('value is not JSON-serializable');
    }
    return this.append(kind, encoded);
  }

  readRecords(limit = this.records.length): HyperMemoryRecordView[] {
    if (!Number.isSafeInteger(limit) || limit < 0) {
      throw new Error('limit must be a safe integer >= 0');
    }

    return this.records.slice(-limit).map(record => ({
      sequence: record.sequence,
      timestamp: record.timestamp,
      kind: record.kind,
      payload: Buffer.from(record.payload),
      sha256: record.sha256
    }));
  }

  checkpoint(): void {
    if (!this.enabled || !this.running) return;

    const body = this.snapshotBody();
    const persisted: PersistedSnapshot = {
      ...body,
      integrity_sha256: sha256(JSON.stringify(body))
    };

    const temporaryPath = `${this.checkpointPath}.tmp`;
    const fd = fs.openSync(temporaryPath, 'w', 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(persisted, null, 2) + '\n', 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temporaryPath, this.checkpointPath);
  }

  async stop(): Promise<void> {
    if (this.checkpointTimer) {
      clearInterval(this.checkpointTimer);
      this.checkpointTimer = null;
    }

    if (this.running) {
      this.checkpoint();
    }
    this.running = false;
  }

  getStats(): HyperMemoryStats {
    return {
      schema: SCHEMA,
      running: this.running,
      enabled: this.enabled,
      arena_kind: 'RAM_BOUNDED_RING',
      durability: 'ATOMIC_FILE_CHECKPOINT',
      capacity_bytes: this.capacityBytes,
      used_bytes: this.usedBytes,
      records: this.records.length,
      evictions: this.evictions,
      generation: this.generation,
      next_sequence: this.nextSequence,
      recovery_state: this.recoveryState,
      checkpoint_path: this.checkpointPath,
      process_immortality_claim: false,
      android_physical_supervisor: 'TOKEN_VAZIO_NOT_PROVEN'
    };
  }

  private assertWritable(): void {
    if (!this.enabled) {
      throw new Error('HyperMemoryRuntime is disabled');
    }
    if (!this.running) {
      throw new Error('HyperMemoryRuntime must be started before append');
    }
  }

  private snapshotBody(): SnapshotBody {
    return {
      schema: SCHEMA,
      generation: this.generation,
      created_at: Date.now(),
      capacity_bytes: this.capacityBytes,
      used_bytes: this.usedBytes,
      evictions: this.evictions,
      next_sequence: this.nextSequence,
      records: this.records.map(record => ({
        sequence: record.sequence,
        timestamp: record.timestamp,
        kind: record.kind,
        payload_base64: record.payload.toString('base64'),
        payload_bytes: record.payload.length,
        sha256: record.sha256
      }))
    };
  }

  private restoreCheckpoint(): void {
    if (!fs.existsSync(this.checkpointPath)) {
      this.recoveryState = 'FRESH';
      return;
    }

    try {
      const raw = fs.readFileSync(this.checkpointPath, 'utf8');
      const parsed = JSON.parse(raw) as PersistedSnapshot;
      this.validateSnapshot(parsed);

      this.records.length = 0;
      this.usedBytes = 0;
      this.evictions = parsed.evictions;
      this.generation = parsed.generation + 1;
      this.nextSequence = parsed.next_sequence;

      for (const record of parsed.records) {
        const payload = Buffer.from(record.payload_base64, 'base64');
        const requiredBytes = frameSize(record.kind, payload.length);

        while (
          this.records.length > 0 &&
          this.usedBytes + requiredBytes > this.capacityBytes
        ) {
          const removed = this.records.shift();
          if (!removed) break;
          this.usedBytes -= removed.frameBytes;
          this.evictions++;
        }

        if (requiredBytes > this.capacityBytes) {
          continue;
        }

        this.records.push({
          sequence: record.sequence,
          timestamp: record.timestamp,
          kind: record.kind,
          payload,
          sha256: record.sha256,
          frameBytes: requiredBytes
        });
        this.usedBytes += requiredBytes;
      }

      this.recoveryState = 'RESTORED';
    } catch (error) {
      this.quarantineCorruptCheckpoint(error);
      this.records.length = 0;
      this.usedBytes = 0;
      this.evictions = 0;
      this.generation = 1;
      this.nextSequence = 1;
      this.recoveryState = 'QUARANTINED_CORRUPT';
    }
  }

  private validateSnapshot(snapshot: PersistedSnapshot): void {
    if (snapshot.schema !== SCHEMA) {
      throw new Error(`unsupported schema: ${String(snapshot.schema)}`);
    }

    const body: SnapshotBody = {
      schema: snapshot.schema,
      generation: snapshot.generation,
      created_at: snapshot.created_at,
      capacity_bytes: snapshot.capacity_bytes,
      used_bytes: snapshot.used_bytes,
      evictions: snapshot.evictions,
      next_sequence: snapshot.next_sequence,
      records: snapshot.records
    };

    const expectedIntegrity = sha256(JSON.stringify(body));
    if (snapshot.integrity_sha256 !== expectedIntegrity) {
      throw new Error('checkpoint integrity_sha256 mismatch');
    }

    if (
      !Array.isArray(snapshot.records) ||
      !Number.isSafeInteger(snapshot.next_sequence) ||
      snapshot.next_sequence < 1
    ) {
      throw new Error('checkpoint structure invalid');
    }

    let previousSequence = 0;
    for (const record of snapshot.records) {
      if (
        !Number.isSafeInteger(record.sequence) ||
        record.sequence <= previousSequence ||
        typeof record.kind !== 'string' ||
        typeof record.payload_base64 !== 'string' ||
        !Number.isSafeInteger(record.payload_bytes) ||
        record.payload_bytes < 0 ||
        typeof record.sha256 !== 'string'
      ) {
        throw new Error('checkpoint record structure invalid');
      }

      const payload = Buffer.from(record.payload_base64, 'base64');
      if (payload.length !== record.payload_bytes) {
        throw new Error(`payload length mismatch at sequence ${record.sequence}`);
      }
      if (sha256(payload) !== record.sha256) {
        throw new Error(`payload sha256 mismatch at sequence ${record.sequence}`);
      }

      previousSequence = record.sequence;
    }
  }

  private quarantineCorruptCheckpoint(error: unknown): void {
    const timestamp = Date.now();
    const quarantinePath = `${this.checkpointPath}.corrupt.${timestamp}.json`;
    const metadataPath = `${quarantinePath}.meta.json`;

    try {
      fs.renameSync(this.checkpointPath, quarantinePath);
      fs.writeFileSync(
        metadataPath,
        JSON.stringify(
          {
            schema: 'rafaelia.frida.hypermemory-quarantine/v1',
            source: this.checkpointPath,
            quarantined_path: quarantinePath,
            timestamp,
            reason: error instanceof Error ? error.message : String(error),
            destructive_recovery_performed: false,
            claim_allowed: false
          },
          null,
          2
        ) + '\n',
        'utf8'
      );
    } catch (quarantineError) {
      console.error(
        '[HyperMemoryRuntime] failed to quarantine corrupt checkpoint:',
        quarantineError
      );
    }
  }
}

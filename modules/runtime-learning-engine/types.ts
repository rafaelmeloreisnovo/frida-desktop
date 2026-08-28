export type BugType = 'crash' | 'anr' | 'memory_leak' | 'deadlock';
export type FixStrategy = 'try_catch_with_fallback' | 'monkey_patch_from_journal' | 'component_restart';
export type EventStatus = 'new' | 'captured' | 'pattern_detected' | 'fix_applied' | 'fix_rolled_back' | 'resolved';
export type TestState = 'PASS' | 'FAIL' | 'SKIPPED';
export type WatchdogState = 'STABLE' | 'OBSERVE' | 'DUMP' | 'FAILSAFE';
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info' | 'warning';

export interface BugEvent {
  id: string;
  timestamp: number;
  bug_type: BugType;
  class: string;
  method: string;
  exception_type?: string;
  stack_hash: string;
  severity: Severity;
  status: EventStatus;
  thread_id?: number;
  process_id?: number;
}

export interface BugPattern {
  pattern_id: string;
  bug_type: BugType;
  class: string;
  method: string;
  exception_type?: string;
  occurrences: number;
  confidence: number;
  last_seen: number;
  suggested_fix: string;
  fix_strategy: FixStrategy;
}

export interface FixEvent {
  fix_id: string;
  pattern_id: string;
  timestamp: number;
  strategy: FixStrategy;
  status: 'applied' | 'rolled_back' | 'failed';
  test_results: TestResult[];
  rollback_reason?: string;
}

export interface TestResult {
  test_name: string;
  state: TestState;
  duration_ms: number;
  error_message?: string;
}

export interface WatchdogEvent {
  timestamp: number;
  heartbeat_count: number;
  epoch: number;
  state: WatchdogState;
  trap_count: number;
  rollback_triggered?: boolean;
  reason?: string;
}

export interface RollbackJournal {
  journal_id: string;
  timestamp: number;
  fix_id: string;
  original_bytes: Uint8Array;
  target_address: number;
  size: number;
  checksum_before: string;
  checksum_after?: string;
  verification_passed?: boolean;
}

export interface BugHistoryStore {
  schema: number;
  events: BugEvent[];
  patterns: BugPattern[];
  fix_events: FixEvent[];
  watchdog_events: WatchdogEvent[];
  integrity_hash: string;
  last_updated: number;
}

export interface LearningEngineConfig {
  storage_path: string;
  bug_capacity: number;
  confidence_threshold: number;
  min_occurrences_before_fix: number;
  heartbeat_interval_ms: number;
  epoch_timeout_ms: number;
  journal_size: number;
  max_rollback_attempts: number;
}

export interface BugCapture {
  captureBug(event: BugEvent): Promise<void>;
  startCapture(): Promise<void>;
  stopCapture(): Promise<void>;
  setBugCapturedCallback(callback: (event: BugEvent) => Promise<void>): void;
}

export interface BugStore {
  appendEvent(event: BugEvent): Promise<void>;
  loadHistory(): Promise<BugHistoryStore>;
  saveHistory(store: BugHistoryStore): Promise<void>;
  getRecentBugs(limit: number): Promise<BugEvent[]>;
}

export interface PatternDetector {
  detectPatterns(events: BugEvent[]): Promise<BugPattern[]>;
  updateConfidence(pattern: BugPattern): Promise<number>;
  shouldApplyFix(pattern: BugPattern): Promise<boolean>;
}

export interface AutoFixer {
  applyFix(pattern: BugPattern): Promise<FixEvent>;
  tryCatchFallback(target: string): Promise<void>;
  monkeyPatch(pattern: BugPattern): Promise<void>;
  restartComponent(class_name: string): Promise<void>;
}

export interface RollbackEngine {
  journalBefore(address: number, size: number): Promise<RollbackJournal>;
  commitFix(journal: RollbackJournal, checksum_after: string): Promise<boolean>;
  rollback(journal: RollbackJournal): Promise<boolean>;
  verifyRollback(journal: RollbackJournal): Promise<boolean>;
}

export interface WatchdogMonitor {
  startWatchdog(): Promise<void>;
  stopWatchdog(): Promise<void>;
  heartbeat(): Promise<void>;
  recordEvent(event: WatchdogEvent): Promise<void>;
}

export interface TestSuite {
  runAfterFix(fix: FixEvent): Promise<TestResult[]>;
  smokeTest(): Promise<TestResult>;
  regressionTest(): Promise<TestResult>;
  performanceTest(): Promise<TestResult>;
}

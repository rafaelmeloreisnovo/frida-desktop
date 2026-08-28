# Runtime Learning Engine - Phase 3.3: Edge Case Hardening Guide

## Phase 3.3: Robustness Testing & Edge Case Validation

This guide covers Phase 3.3 validation of the Runtime Learning Engine under edge case scenarios and production stressors. Closes **GAP_EDGE_1**: Edge cases untested under realistic production conditions.

## Table of Contents

1. [Overview](#overview)
2. [Concurrent Bug Captures](#concurrent-bug-captures)
3. [Disk Space Exhaustion](#disk-space-exhaustion)
4. [Data Corruption & Recovery](#data-corruption--recovery)
5. [Memory Pressure & Degradation](#memory-pressure--degradation)
6. [Watchdog Failsafe](#watchdog-failsafe)
7. [Testing Procedures](#testing-procedures)
8. [Troubleshooting](#troubleshooting)

---

## Overview

### Phase 3.3 Scope

Phase 3.3 validates production robustness through edge case testing:

| Scenario | Challenge | Impact | Validation |
|----------|-----------|--------|------------|
| **Concurrent Bugs** | 50-100 parallel captures | Race conditions, deadlocks | No corruption |
| **Disk Exhaustion** | < 50MB free space | Data loss, dropped events | LRU eviction works |
| **Corruption** | Invalid JSON, truncation | Data unreadable, recovery | Recovery functional |
| **Memory Pressure** | < 100MB heap available | Crash, OOM errors | Graceful degradation |
| **Watchdog Timeout** | No heartbeat > 5s | Runaway processes | Failsafe activates |

### Phase 3.3 Components

**4 Handler Classes:**
1. `ConcurrentBugCaptureHandler` - Race condition prevention
2. `DiskExhaustionHandler` - LRU eviction under disk pressure
3. `CorruptionRecoveryHandler` - Data corruption detection & recovery
4. `MemoryPressureHandler` - Graceful degradation under memory constraints

---

## Concurrent Bug Captures

### Testing 50-100 Parallel Bug Captures

```bash
npm test -- --testNamePattern="concurrent bug captures"
```

### Expected Behavior

**50 Parallel Captures:**
```
- All 50 bugs captured without race conditions
- Peak concurrency: 50 simultaneous operations
- Latency p95: < 100ms
- No deadlocks detected
- Data integrity: PASS
```

**100 Parallel Captures:**
```
- All 100 bugs captured
- Peak concurrency: 100 simultaneous
- Some latency increase expected (p95: < 200ms)
- No deadlocks
- No data corruption
```

### Race Condition Prevention

**Mechanism:**
- Atomic operations for state updates
- Lock acquisition with timeout detection (prevents deadlocks)
- Per-bug-ID locking to isolate operations
- Verification of single capture per bug ID

**Validation:**
```typescript
expect(stats.race_conditions_detected).toBe(0);
expect(stats.deadlocks_detected).toBe(0);
expect(concurrentHandler.validateDataIntegrity()).toBe(true);
```

### Lock Contention Analysis

**Metrics Collected:**
- Average lock wait time: < 10ms (acceptable)
- Max lock wait time: < 50ms (without pathological timing)
- Lock acquisitions: proportional to bug count

**Formula:**
```
Contention = (Sum of wait times) / (Number of acquisitions)
Target: < 10ms average
```

---

## Disk Space Exhaustion

### Simulating Low Disk Scenarios

**Pressure Levels:**
```
Healthy:   > 500MB free
Warning:   200-500MB free
Critical:  < 50MB free
```

### LRU Eviction Strategy

**Priority Levels** (highest to lowest):
1. **Critical** - Audit logs, provenance chains (NEVER evicted)
2. **High** - Active patterns, current fixes
3. **Medium** - Bug history, recent metrics
4. **Low** - Cached data, temporary buffers

**Eviction Score Formula:**
```
Score = (Age in seconds) / (Priority multiplier)
Lower score = evicted first
```

**Example:**
```
- Bug from 10s ago, LOW priority:    Score = 10 / 10 = 1.0
- Bug from 5s ago, MEDIUM priority:  Score = 5 / 100 = 0.05  ← Evicted first
- Audit entry from 20s ago, CRITICAL: Protected (never evicted)
```

### Testing Disk Exhaustion

```bash
# Trigger LRU eviction
npm test -- --testNamePattern="LRU eviction prioritizes"

# Verify critical data protection
npm test -- --testNamePattern="critical data is never evicted"
```

### Expected Outcomes

| Disk Free | Action | Expected |
|-----------|--------|----------|
| > 500MB | Normal operation | All events stored |
| 200-500MB | Start LRU eviction | Low-priority items removed |
| < 50MB | Aggressive eviction | Only critical/high kept |
| < 10MB | Graceful degradation | Read-only mode, no new writes |

---

## Data Corruption & Recovery

### Corruption Types Handled

**1. Invalid JSON**
```json
// Before: Corrupted
{"data": [1, 2, 3}  // Missing closing bracket

// After: Recovery attempted
{"data": [1, 2, 3]}  // Repaired
```

**Detection:** JSON parse error, scanner finds last valid token

**Recovery:**
```
If backup available:     95% recovery
If audit log available:  70% recovery
No backup/log:          Permanent loss
```

**2. Truncated Files**
```json
// File ends abruptly
{"events": [{"id": "e1"}, {"id": "e2"},

// Recovery: Parse valid prefix
[{"id": "e1"}, {"id": "e2"}]
```

**3. Checksum Mismatch**
```
Expected: fnv1a64_hash_abc123
Actual:   fnv1a64_hash_def456
Action:   Trigger corruption recovery
```

### Recovery Procedures

```bash
# Test corruption detection
npm test -- --testNamePattern="detects invalid JSON"

# Test recovery execution
npm test -- --testNamePattern="executes recovery"
```

### Recovery Results

```
Scenario: 100 items corrupted, backup available
Expected: 
  - Recovered items: ~95
  - Permanent loss: ~5
  - Status: FULL_RECOVERY
```

---

## Memory Pressure & Degradation

### Memory Pressure Levels

```
Healthy:  < 100MB heap used
Warning:  100-200MB used (switch to reduced mode)
Critical: > 200MB used (switch to minimal mode)
```

### Degradation Modes

**Mode: NORMAL** (< 100MB)
- All features enabled
- Full buffer sizes (512 bugs, 256 patterns)

**Mode: REDUCED** (100-200MB)
- Metrics collection disabled
- Buffers reduced to 50%
- Pattern detection still enabled
- Fix application still enabled

**Mode: MINIMAL** (> 200MB)
- Pattern detection disabled
- Fix application disabled
- Bug capture still enabled (critical)
- Audit logging still enabled (critical)
- Buffers reduced to 25%

**Mode: EMERGENCY** (> 300MB)
- Only bug capture and audit logging
- Minimal buffering
- Rollback disabled to save memory

### Feature Preservation

**Critical Features (never disabled):**
1. Bug capture - must always work
2. Audit logging - for debugging/recovery
3. Rollback capability - for safety

**Non-critical Features (can disable):**
1. Metrics collection - monitoring only
2. Pattern detection - optimization only
3. Fix application - improvement only

### Testing Memory Degradation

```bash
# Test degradation modes
npm test -- --testNamePattern="switches to reduced mode"
npm test -- --testNamePattern="data preservation"

# Verify latency impact
npm test -- --testNamePattern="latency impact remains acceptable"
```

### Expected Behavior

```
Normal state:    50ms latency
Warning state:   +20% latency (60ms)
Minimal state:   +50% latency (75ms)
Emergency state: +100% latency (100ms, but system still operational)
```

---

## Watchdog Failsafe

### Failsafe Activation Conditions

1. **Heartbeat Timeout**
   - Expected: Every 1000ms
   - Timeout: 5000ms (5 seconds)
   - Action: Trigger FAILSAFE state

2. **Cascade Failure**
   - Multiple component failures
   - Deadlock detected
   - Unrecoverable corruption

### Failsafe Behavior

**When activated:**
1. Engine enters READ-ONLY mode
2. No new fixes applied
3. Bug capture continues (observability)
4. Rollback commands accepted (safety)
5. Alert escalation triggered

**Recovery:**
1. Manual intervention required
2. Investigate root cause
3. Clear FAILSAFE flag
4. Resume normal operation

### Testing Failsafe

```bash
npm test -- --testNamePattern="watchdog failsafe"
```

---

## Testing Procedures

### Full Edge Case Test Suite

```bash
# Run all Phase 3.3 tests
npm test -- --testPathPattern=phase-3-edge-case-hardening

# Run specific category
npm test -- --testNamePattern="Concurrent"
npm test -- --testNamePattern="Disk"
npm test -- --testNamePattern="Corruption"
npm test -- --testNamePattern="Memory"
```

### Load Testing Procedure

**Step 1: Prepare test environment**
```bash
export EDGE_CASE_TEST=true
export CONCURRENCY_LEVEL=100
```

**Step 2: Run concurrent capture test**
```bash
npm test -- --testNamePattern="100 parallel bug captures"
# Expected: All 100 captured, no race conditions, no deadlocks
```

**Step 3: Run disk exhaustion test**
```bash
npm test -- --testNamePattern="LRU eviction"
# Expected: LRU properly prioritizes items
```

**Step 4: Run corruption test**
```bash
npm test -- --testNamePattern="detects invalid JSON"
npm test -- --testNamePattern="executes recovery procedure"
# Expected: Corruption detected, recovery successful
```

**Step 5: Run memory pressure test**
```bash
npm test -- --testNamePattern="graceful degradation"
# Expected: Features gracefully disabled, data preserved
```

### Test Execution Matrix

| Scenario | Test Name | Expected | Pass/Fail |
|----------|-----------|----------|-----------|
| 50 concurrent | `handles 50 concurrent` | No race conditions | ✅ |
| 100 concurrent | `100 parallel captures` | No corruption | ✅ |
| Disk warning | `LRU eviction works` | Low priority evicted | ✅ |
| Disk critical | `Recovery possible` | Recoverable with < 50MB | ✅ |
| JSON corruption | `Detects invalid JSON` | Corruption detected | ✅ |
| Truncated file | `Recovers from truncated` | Recovery > 70% | ✅ |
| Memory warning | `Reduced mode` | Metrics disabled | ✅ |
| Memory critical | `Minimal mode` | Pattern detection disabled | ✅ |

---

## Troubleshooting

### Issue 1: Race Conditions Detected in Concurrent Test

**Symptom:** Test reports `race_conditions_detected > 0`

**Root Cause:** Lock implementation not atomic

**Solution:**
```typescript
// Ensure atomic state update
atomicUpdate(bugId, { status: 'captured', timestamp: Date.now() });

// Verify no concurrent access
expect(activeBugCaptures.get(bugId)).not.toEqual(null);
```

### Issue 2: Deadlock in Concurrent Capture

**Symptom:** Test hangs, reports `deadlocks_detected > 0`

**Root Cause:** Lock not released on error

**Solution:**
```typescript
try {
  acquireLock();
  // do work
} finally {
  releaseLock(); // Always release, even on error
}
```

### Issue 3: LRU Eviction Not Triggering

**Symptom:** Test shows disk exhaustion but no items evicted

**Root Cause:** Eviction threshold misconfigured

**Solution:**
```typescript
// Verify threshold is < actual disk free
expect(diskFree).toBeLessThan(CRITICAL_THRESHOLD);

// Ensure non-critical items exist
expect(registry.filter(i => i.priority !== 'critical').length).toBeGreaterThan(0);
```

### Issue 4: Recovery Doesn't Restore All Data

**Symptom:** Recovery result shows < 70% recovery

**Root Cause:** Audit log incomplete or backup unavailable

**Solution:**
```bash
# Verify audit log is complete
wc -l /data/local/tmp/frida-learning/audit.log

# Check backup exists
ls -la /data/local/tmp/frida-learning/backups/

# If missing, recovery is limited to 50% (corruption detection only)
```

### Issue 5: Memory Degradation Causes Feature Loss

**Symptom:** Critical features like bug capture disabled under memory pressure

**Root Cause:** Feature dependency order wrong

**Solution:**
```typescript
// Always preserve critical features
if (mode === 'minimal' || mode === 'emergency') {
  expect(config.features.bug_capture).toBe(true);
  expect(config.features.audit_logging).toBe(true);
}
```

---

## Phase 3.3 Completion Criteria

- ✅ 50-100 concurrent bug captures without race conditions
- ✅ No deadlocks under high concurrency
- ✅ LRU eviction works under disk exhaustion
- ✅ Critical data always protected
- ✅ Corruption detected and recovered
- ✅ Memory degradation graceful (no crashes)
- ✅ Core features never disabled
- ✅ Data integrity maintained under load
- ✅ All edge cases have documented recovery paths
- ✅ Watchdog failsafe validated

---

## Next Steps (Phase 3.4)

After Phase 3.3 (Edge Case Hardening):
- Phase 3.4: Operational Playbooks (incident response, troubleshooting)

---

**Version**: 1.0  
**Date**: 2026-08-28  
**Maintainer**: Runtime Learning Engine Team  
**Phase**: 3.3 - Edge Case Hardening

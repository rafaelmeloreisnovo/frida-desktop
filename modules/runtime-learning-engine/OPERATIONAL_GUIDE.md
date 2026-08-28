# Runtime Learning Engine - Operational Guide

## Table of Contents

1. [Deployment](#deployment)
2. [Monitoring & Alerts](#monitoring--alerts)
3. [SLA Management](#sla-management)
4. [Troubleshooting](#troubleshooting)
5. [Playbooks](#playbooks)
6. [FAQ](#faq)

---

## Deployment

### Pre-Deployment Checklist

Before deploying to production Android 10+ devices:

- [ ] Device running Android 10+ (API level >= 29)
- [ ] Frida server version >= 14.0.0 installed
- [ ] SELinux mode verified (enforcing/permissive/disabled)
- [ ] Storage available: >= 1GB for logs and metrics
- [ ] Memory available: >= 256MB for engine runtime
- [ ] Network access for alert notifications (Slack/PagerDuty)

### Deployment Steps

```bash
# 1. Compile TypeScript to JavaScript
tsc modules/runtime-learning-engine/*.ts --outDir dist

# 2. Connect to device via ADB
adb connect <device-ip>:<port>

# 3. Deploy via Frida
frida -H <device-ip>:<frida-port> -p <app-pid> -l dist/index.js

# 4. Verify deployment
# Check device logs for: "[RuntimeLearningEngine] Engine started successfully"
adb logcat | grep "RuntimeLearningEngine"
```

### Configuration

Default configuration in `index.ts`:

```typescript
{
  storage_path: '/data/local/tmp/frida-learning',
  bug_capacity: 512,
  confidence_threshold: 0.75,
  min_occurrences_before_fix: 3,
  heartbeat_interval_ms: 1000,
  epoch_timeout_ms: 5000
}
```

Customize via:

```typescript
const engine = await initializeEngine({
  storage_path: '/custom/path',
  confidence_threshold: 0.80,
  // ... other options
});
```

---

## Monitoring & Alerts

### Health Check Endpoint

The engine provides a health status endpoint (to be integrated with your monitoring system):

```typescript
const engine = await getEngine();
const health = await engine.getHealthCheckEndpoint().getHealthStatus();

console.log(health);
// {
//   status: 'healthy' | 'degraded' | 'critical',
//   engine_running: boolean,
//   bugs_captured: number,
//   success_rate: number,
//   sla_violations: { critical: number, warnings: number },
//   memory_usage_mb: number,
//   storage_used_mb: number
// }
```

### Metrics Export

Export metrics in Prometheus format:

```typescript
const metricsCollector = engine.getMetricsCollector();
await metricsCollector.exportMetrics('prometheus');

// File: /data/local/tmp/frida-learning/prometheus-metrics.txt
// Format: Prometheus-compatible metrics for Grafana/Prometheus scraping
```

### Alert Rules

Default alert rules triggered when:

| Rule | Condition | Severity |
|------|-----------|----------|
| Bug Capture Latency SLA | > 100ms | CRITICAL |
| Pattern Detection Latency SLA | > 500ms | WARNING |
| Fix Application Latency SLA | > 1000ms | WARNING |
| Fix Success Rate SLA | < 80% | CRITICAL |
| Memory Usage | > 500MB | WARNING |
| Storage Usage | > 900MB | CRITICAL |
| Watchdog FAILSAFE | State = FAILSAFE | CRITICAL |
| High Error Rate | > 20 errors/hour | WARNING |
| Rollback Failure | Success rate < 95% | CRITICAL |

### Receiving Alerts

```typescript
const alertManager = engine.getAlertManager();

// Format for Slack
const slackMessage = alertManager.formatAlertForSlack(alert);

// Format for Email
const emailBody = alertManager.formatAlertForEmail(alert);

// Send notification
await alertManager.sendAlertNotification(alert, 'slack');
```

---

## SLA Management

### Defined SLAs

1. **Bug Capture Latency**: < 100ms
2. **Pattern Detection Latency**: < 500ms
3. **Fix Application Latency**: < 1000ms
4. **Rollback Completion**: < 500ms
5. **Fix Success Rate**: >= 80%
6. **Rollback Success Rate**: >= 95%
7. **Audit Trail Completeness**: >= 99%
8. **Data Integrity**: Zero corruption
9. **Memory Usage**: < 500MB

### Monitoring Compliance

```bash
# Check SLA compliance
adb shell cat /data/local/tmp/frida-learning/sla-compliance.json

# Example:
{
  "timestamp": 1693456789000,
  "sla_compliance": {
    "bug_capture_latency": true,
    "pattern_detection_latency": true,
    "fix_application_latency": false,  # < VIOLATION
    "rollback_latency": true,
    "success_rate_target": true
  }
}
```

### SLA Violation Response

When SLA violation detected:

1. **CRITICAL violations** (< 5 min response):
   - Bug capture latency SLA
   - Success rate below 80%
   - Storage > 900MB
   - Watchdog FAILSAFE activated

2. **WARNING violations** (< 30 min response):
   - Pattern detection latency SLA
   - Fix application latency SLA
   - Memory > 500MB
   - High error rate

---

## Troubleshooting

### Common Issues

#### 1. Engine Not Starting

**Symptom:** `[RuntimeLearningEngine] INCOMPATIBLE ENVIRONMENT - Cannot proceed with deployment`

**Causes:**
- Frida version < 14.0.0
- Android API level < 29
- Required hooks not available

**Resolution:**
```bash
# Check Frida version
frida --version  # Should be >= 14.0.0

# Check Android API level
adb shell getprop ro.build.version.sdk  # Should be >= 29

# Review compatibility report
adb shell cat /data/local/tmp/frida-learning/compatibility-report.json
```

#### 2. High Memory Usage

**Symptom:** Engine crashes with out-of-memory, `memory_usage_mb` > 500

**Causes:**
- Too many bug events in memory (bug_capacity too high)
- Memory leak in pattern detection
- Audit log growing unbounded

**Resolution:**
```typescript
// Reduce bug capacity
const engine = await initializeEngine({
  bug_capacity: 256  // Reduced from 512
});

// Clear old audit logs
// (Implement log rotation in audit-logger.ts)

// Check metrics for memory leaks
const metrics = engine.getMetricsCollector().getExporter().getMetricsSnapshot();
```

#### 3. High Storage Usage

**Symptom:** `storage_used_mb` > 900, allocation failure

**Causes:**
- Audit log not rotating
- Bug history growing indefinitely
- Provenance tracking accumulating

**Resolution:**
```bash
# Check storage breakdown
adb shell ls -lh /data/local/tmp/frida-learning/

# Clear old files (keep recent 7 days)
adb shell find /data/local/tmp/frida-learning -mtime +7 -delete

# Verify storage is freed
adb shell du -sh /data/local/tmp/frida-learning
```

#### 4. SLA Violations

**Symptom:** Repeated alerts for latency SLA violations

**Causes:**
- Device under load
- Pattern detection too aggressive
- Fix application strategy inefficient

**Resolution:**
```typescript
// Adjust confidence threshold (higher = fewer fixes)
const engine = await initializeEngine({
  confidence_threshold: 0.80  // Increased from 0.75
});

// Increase min_occurrences_before_fix to reduce false positives
const engine = await initializeEngine({
  min_occurrences_before_fix: 5  // Increased from 3
});

// Monitor auto-optimizer adjustments
adb shell cat /data/local/tmp/frida-learning/optimization-log.json
```

#### 5. Watchdog in FAILSAFE

**Symptom:** Alert: "Watchdog: FAILSAFE activated"

**Causes:**
- Engine heartbeat timeout (> 5000ms)
- Epoch lockout triggered
- Critical error during fix application

**Resolution:**
```bash
# Check watchdog events
adb shell cat /data/local/tmp/frida-learning/watchdog-events.json

# Review audit trail for root cause
adb shell tail -100 /data/local/tmp/frida-learning/audit.log

# If stuck: restart engine
# (Implementation: re-run initializeEngine)
```

---

## Playbooks

### Playbook 1: Responding to Critical Alert

**Scenario:** Receive alert "Fix Success Rate 65% below 80% SLA"

**Steps:**

1. Check alert details:
   ```bash
   adb shell cat /data/local/tmp/frida-learning/alerts.json | jq '.[] | select(.severity=="critical")'
   ```

2. Review failed fixes:
   ```bash
   adb shell cat /data/local/tmp/frida-learning/fix-events.json | jq '.[] | select(.success==false)'
   ```

3. Identify pattern:
   ```bash
   adb shell cat /data/local/tmp/frida-learning/audit.log | grep "FIX_ROLLED_BACK"
   ```

4. Increase confidence threshold:
   ```typescript
   // Require higher confidence before attempting fix
   const engine = await initializeEngine({
     confidence_threshold: 0.85
   });
   ```

5. Verify fix rate improves within 1 hour

6. If still failing: escalate to dev team with audit log

---

### Playbook 2: Storage Exhaustion Recovery

**Scenario:** Alert "Storage usage 950MB exceeds 900MB threshold"

**Steps:**

1. SSH to device and check storage:
   ```bash
   adb shell df /data/local/tmp
   adb shell du -sh /data/local/tmp/frida-learning/*
   ```

2. Identify largest files:
   ```bash
   adb shell ls -lhS /data/local/tmp/frida-learning/
   ```

3. Archive old data (keep 7 days):
   ```bash
   adb shell find /data/local/tmp/frida-learning -name "*.json" -mtime +7 -delete
   adb shell find /data/local/tmp/frida-learning -name "audit.log*" -mtime +7 -delete
   ```

4. Restart engine:
   ```bash
   frida -H <device-ip> restart  # Or restart app hosting engine
   ```

5. Verify storage < 500MB:
   ```bash
   adb shell du -sh /data/local/tmp/frida-learning
   ```

6. Implement log rotation in codebase to prevent recurrence

---

### Playbook 3: Rollback Failure Investigation

**Scenario:** Alert "Rollback success rate 80% below 95% threshold"

**Steps:**

1. Check rollback journal:
   ```bash
   adb shell cat /data/local/tmp/frida-learning/rollback-journal.json | tail -20
   ```

2. Review failed rollbacks in audit log:
   ```bash
   adb shell tail -200 /data/local/tmp/frida-learning/audit.log | grep "ROLLBACK"
   ```

3. Check which fixes are failing rollback:
   ```bash
   adb shell cat /data/local/tmp/frida-learning/fix-events.json | \
     jq '.[] | select(.rollback_status=="failed")'
   ```

4. Verify device state post-rollback:
   ```bash
   # Check if app is still functional
   adb shell am dump-hprof <pid>  # Verify heap state
   ```

5. If app state corrupted:
   - Restart app
   - Review fix strategy (might be too aggressive)
   - Consider reverting latest auto-optimizer changes

6. If rollback mechanism broken:
   - Escalate to dev team
   - Disable auto-fix temporarily: `confidence_threshold: 1.0`

---

## FAQ

### Q1: What's the expected memory footprint?

**A:** Typically 50-150MB on Arm32, 100-250MB on Arm64. If exceeding 400MB, investigate memory leaks via:

```bash
adb shell dumpsys meminfo <package>
adb shell cat /data/local/tmp/frida-learning/health-check.json
```

### Q2: How often should I check SLA compliance?

**A:** Minimum every 1 hour for production. Set up automated checks via:

```bash
# Cron job or scheduler
0 * * * * adb shell cat /data/local/tmp/frida-learning/sla-compliance.json | jq .
```

### Q3: Can I adjust SLAs?

**A:** No. SLAs are operational guarantees. Instead, adjust thresholds that trigger fixes:

```typescript
// Reduce fixes (higher threshold)
confidence_threshold: 0.80

// Require more evidence (higher min_occurrences)
min_occurrences_before_fix: 5
```

### Q4: What if device loses network temporarily?

**A:** Alert notifications may queue and send when connection restored. Engine continues locally. No data loss expected.

### Q5: How do I disable the engine safely?

```typescript
await engine.stop();
// Verify: engine.isRunning() === false

// Clean shutdown will:
// - Stop bug capture hooks
// - Stop watchdog monitoring
// - Flush audit log to disk
// - Export final metrics
```

### Q6: Can I run multiple engines on same device?

**A:** Not recommended. Each would write to same storage path, causing conflicts. Use separate storage paths if needed:

```typescript
const engine1 = await initializeEngine({
  storage_path: '/data/local/tmp/frida-learning-1'
});

const engine2 = await initializeEngine({
  storage_path: '/data/local/tmp/frida-learning-2'
});
```

### Q7: How do I audit who made changes?

**A:** Check audit trail with timestamps and actions:

```bash
adb shell cat /data/local/tmp/frida-learning/audit.log | jq .

# Example entry:
# {
#   "timestamp": 1693456789000,
#   "action": "FIX_APPLIED",
#   "actor": "auto_fixer",
#   "context": { "pattern_id": "pat_001", ... }
# }
```

### Q8: What's the rollout strategy?

**A:** Canary deployment in 4 stages:

1. **5%** traffic - Monitor 1 hour for critical issues
2. **25%** traffic - Monitor 2 hours for SLA compliance
3. **50%** traffic - Monitor 4 hours, check performance
4. **100%** traffic - Full rollout if all metrics green

Auto-rollback triggers at any stage if:
- Success rate < 70%
- Error rate > 50/hour
- Memory growth > 10MB/min

---

## Contact & Escalation

For production issues:

1. **Operational**: Check this guide first
2. **SLA Violations**: Follow playbooks above
3. **Data Integrity Issues**: Contact data team immediately
4. **Code Bugs**: File issue with audit log + health check
5. **Critical Outage**: Page on-call engineer with device state snapshot

---

**Last Updated:** 2026-08-28
**Version:** 1.0
**Maintainer:** Runtime Learning Engine Team

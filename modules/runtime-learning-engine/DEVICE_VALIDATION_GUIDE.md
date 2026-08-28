# Runtime Learning Engine - Device Real Validation Guide

## Phase 4.1: Device Real Deployment & Validation

This guide covers validation of the Runtime Learning Engine on real Android 10+ devices using Frida runtime instrumentation.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Device Deployment](#device-deployment)
3. [Bug Trigger & Capture Validation](#bug-trigger--capture-validation)
4. [SLA Compliance Validation](#sla-compliance-validation)
5. [Metrics Collection & Analysis](#metrics-collection--analysis)
6. [Troubleshooting Device Issues](#troubleshooting-device-issues)
7. [Performance Profiles](#performance-profiles)

---

## Prerequisites

### Device Requirements

- **Android Version**: 10.0+ (API level >= 29)
- **Architecture**: ARM32 (armeabi-v7a) or ARM64 (arm64-v8a)
- **Storage**: >= 500MB free in `/data/local/tmp`
- **Memory**: >= 256MB available for engine runtime
- **Network**: USB connection to host (for ADB) or network connectivity (for Frida remote)

### Host Requirements

- **Frida**: >= 14.0.0 (`frida --version` to verify)
- **ADB**: >= 1.0.40 (Android Debug Bridge)
- **Node.js**: >= 14.0.0
- **TypeScript**: Compiled to JavaScript before deployment

### Connectivity Setup

```bash
# Enable USB debugging on device
Settings → Developer options → USB debugging: ON

# Connect device via ADB
adb connect <device-ip>:5555
# or
adb devices  # for USB connection

# Start Frida server on device
adb push frida-server /data/local/tmp/
adb shell chmod +x /data/local/tmp/frida-server
adb shell /data/local/tmp/frida-server &

# Verify Frida server is running
adb shell pgrep -l frida-server
```

---

## Device Deployment

### Step 1: Prepare Engine Module

```bash
# Compile TypeScript to JavaScript
npm run build:learning-engine

# Or manually:
cd modules/runtime-learning-engine
tsc *.ts --outDir ../../dist/learning-engine
```

### Step 2: Identify Target Process

```bash
# List running processes
adb shell pm list packages -3  # User-installed apps

# Get process ID
adb shell pidof com.example.testapp
# Or
adb shell ps | grep com.example.testapp

# Example output: com.example.testapp 12345
```

### Step 3: Deploy via Frida

```bash
# Deploy to device with process injection
frida -H <device-ip>:27042 -p <app-pid> -c "console.log('[Deploy] Connected')"

# Full command with script:
frida -H 192.168.1.100:27042 -p 12345 -l dist/learning-engine/index.js

# Expected output:
# [RuntimeLearningEngine] Starting engine...
# [RuntimeLearningEngine] Running compatibility checks...
# [RuntimeLearningEngine] Engine started successfully
```

### Step 4: Verify Deployment Success

```bash
# Check device logs
adb logcat | grep RuntimeLearningEngine

# Verify storage path created
adb shell ls -la /data/local/tmp/frida-learning/

# Expected files:
# -rw-r--r-- bug-history.json
# -rw-r--r-- health-check.json
# -rw-r--r-- metrics.json
# -rw-r--r-- alerts.json
```

### Deployment Checklist

- [ ] Device running Android 10+ (API >= 29)
- [ ] Frida server version >= 14.0.0 installed
- [ ] ADB connectivity verified (`adb devices`)
- [ ] Target app running and process ID identified
- [ ] Engine deployed via Frida
- [ ] Storage path `/data/local/tmp/frida-learning` exists
- [ ] Engine logs show "Engine started successfully"

---

## Bug Trigger & Capture Validation

### Scenario 1: Trigger Crash (NullPointerException)

**Method 1: Via Test Activity**
```bash
# If test app has crash activity
adb shell am start -n com.example.testapp/com.example.testapp.CrashActivity

# Monitor logs
adb logcat | grep -E "(NullPointerException|crash)"
```

**Method 2: Via Frida Script**
```javascript
// In Frida console
const Activity = Java.use('com.example.testapp.MainActivity');
Activity.onResume.implementation = function() {
  var nullObj = null;
  nullObj.toString(); // Trigger NPE
  this.onResume.call(this);
};
```

**Verify Capture**
```bash
# Check bug-history.json
adb shell cat /data/local/tmp/frida-learning/bug-history.json | jq '.events[] | select(.bug_type=="crash")'

# Expected output:
{
  "id": "evt_001",
  "timestamp": 1693456789000,
  "bug_type": "crash",
  "exception_type": "NullPointerException",
  "severity": "critical",
  "class": "com.example.testapp.MainActivity",
  "status": "new"
}
```

### Scenario 2: Trigger ANR (Application Not Responding)

```bash
# Lock main thread for > 5 seconds
adb shell am hang app com.example.testapp

# Or via Frida:
# java.lang.Thread.sleep(6000) on main thread
```

**Verify Capture**
```bash
adb shell cat /data/local/tmp/frida-learning/bug-history.json | jq '.events[] | select(.bug_type=="anr")'
```

### Scenario 3: Pattern Detection Trigger (Multiple Crashes)

```bash
# Trigger same crash 3+ times
for i in {1..5}; do
  adb shell am start -n com.example.testapp/com.example.testapp.CrashActivity
  sleep 2  # Wait for crash to register
done

# Wait for pattern detection (default: 5-10 seconds)
sleep 10

# Check patterns.json
adb shell cat /data/local/tmp/frida-learning/patterns.json | jq '.patterns[]'

# Expected: pattern with confidence >= 0.75 (75%)
```

### Validation Checklist

- [ ] First crash triggered and captured in bug-history.json
- [ ] Crash recorded with correct exception type
- [ ] Multiple crashes of same type trigger pattern detection
- [ ] Pattern confidence >= 0.75 (75%)
- [ ] Fix application attempted after pattern detection
- [ ] Engine remains running after crash

---

## SLA Compliance Validation

### Running SLA Validator

```bash
# Navigate to tests directory
cd modules/runtime-learning-engine/tests

# Run SLA validation test
npm test -- --testNamePattern="SLA Compliance Validation"

# Or manually with environment variables
DEVICE_IP=192.168.1.100 FRIDA_PORT=27042 npm test -- device-validation.test.ts
```

### Expected SLAs

| SLA | Threshold | Measurement | Status |
|-----|-----------|-------------|--------|
| Bug Capture Latency | < 100ms | Real device latency | ✅/❌ |
| Pattern Detection | < 500ms | Time to detect pattern | ✅/❌ |
| Fix Application | < 1000ms | Time to apply fix | ✅/❌ |
| Rollback Completion | < 500ms | Time to rollback | ✅/❌ |
| Fix Success Rate | >= 80% | % of successful fixes | ✅/❌ |
| Rollback Success Rate | >= 95% | % of successful rollbacks | ✅/❌ |
| Audit Completeness | >= 99% | % of actions logged | ✅/❌ |
| Memory Usage | < 500MB | Process memory | ✅/❌ |
| Data Integrity | 0 corruption | Corruption count | ✅/❌ |

### Validation Procedure

```bash
# 1. Pull health check from device
adb pull /data/local/tmp/frida-learning/health-check.json device-health.json

# 2. Run validator
npm test -- --testNamePattern="can be validated from health check"

# 3. Review report
cat /tmp/device-validation-results/device-deployment-report.json | jq '.sla_report'

# Expected results:
# {
#   "timestamp": 1693456789000,
#   "totalSLAs": 9,
#   "passedSLAs": 9,
#   "failedSLAs": 0,
#   "compliancePercentage": 100.0
# }
```

### SLA Baseline by Device Type

**ARM32 Device (Slower)**
- Bug capture: 40-80ms
- Pattern detection: 200-400ms
- Fix application: 600-900ms
- Memory usage: 80-150MB

**ARM64 Device (Faster)**
- Bug capture: 30-50ms
- Pattern detection: 100-250ms
- Fix application: 300-600ms
- Memory usage: 100-200MB

---

## Metrics Collection & Analysis

### Pull All Metrics from Device

```bash
# Create directory
mkdir -p device-metrics-$(date +%s)
cd device-metrics-*/

# Pull all metrics files
adb pull /data/local/tmp/frida-learning/health-check.json
adb pull /data/local/tmp/frida-learning/metrics.json
adb pull /data/local/tmp/frida-learning/alerts.json
adb pull /data/local/tmp/frida-learning/audit.log
adb pull /data/local/tmp/frida-learning/sla-compliance.json
adb pull /data/local/tmp/frida-learning/integrity-checks.json

# View metrics
cat health-check.json | jq .
cat metrics.json | jq .
cat sla-compliance.json | jq .
```

### Analyze Performance

```bash
# Extract latency measurements
cat metrics.json | jq '.[] | select(.type=="histogram")'

# Calculate percentiles
cat audit.log | grep "BUG_CAPTURED" | \
  jq '.latency_ms' | \
  sort -n | \
  awk '{a[NR]=$1} END { \
    print "p50:", a[int(NR*0.5)]; \
    print "p95:", a[int(NR*0.95)]; \
    print "p99:", a[int(NR*0.99)]; \
  }'

# Check for errors
grep "ERROR\|FAIL" audit.log | wc -l
```

### Export to Prometheus

```bash
# Export metrics in Prometheus format
adb shell cat /data/local/tmp/frida-learning/prometheus-metrics.txt

# Expected format:
# # TYPE frida_bugs_captured_total counter
# frida_bugs_captured_total 42
# # TYPE frida_bug_capture_latency_ms histogram
# frida_bug_capture_latency_ms_bucket{le="50"} 35
# frida_bug_capture_latency_ms_bucket{le="100"} 42
```

---

## Troubleshooting Device Issues

### Issue 1: Frida Server Not Connecting

**Symptom**: `frida: Timed out while trying to connect to remote frida-server`

**Solution**:
```bash
# Verify server is running
adb shell pgrep -l frida-server

# If not running, start it
adb shell /data/local/tmp/frida-server &

# Check port is accessible
adb forward tcp:27042 tcp:27042
adb shell netstat -tlnp | grep 27042

# Retry connection
frida -H localhost:27042 -l script.js
```

### Issue 2: Engine Not Starting

**Symptom**: `INCOMPATIBLE ENVIRONMENT - Cannot proceed with deployment`

**Solution**:
```bash
# Check Android version
adb shell getprop ro.build.version.sdk
# Must be >= 29

# Check Frida version
frida --version
# Must be >= 14.0.0

# Check available hooks
adb shell find /system -name "*.odex" | head
# If SELinux enforcing, may need to adjust policies
```

### Issue 3: No Bugs Captured

**Symptom**: `bug-history.json is empty after triggering crash`

**Solution**:
```bash
# Verify hooks are registered
adb logcat | grep "hook"

# Check if crash is actually occurring
adb logcat | grep -E "(crash|exception|NullPointer)"

# Verify storage is writable
adb shell ls -la /data/local/tmp/frida-learning/
adb shell touch /data/local/tmp/frida-learning/test.txt
adb shell rm /data/local/tmp/frida-learning/test.txt

# Enable verbose logging
FRIDA_LOGGING=all frida -H 192.168.1.100:27042 -p <pid> -l script.js
```

### Issue 4: High Memory Usage

**Symptom**: `Engine crash due to out-of-memory`

**Solution**:
```bash
# Check memory limit
adb shell getprop dalvik.vm.heapsize

# Monitor memory usage
adb shell dumpsys meminfo com.example.testapp

# Reduce bug capacity (in configuration)
{
  "bug_capacity": 256  // Reduced from 512
}

# Clear old logs
adb shell find /data/local/tmp/frida-learning -mtime +7 -delete
```

### Issue 5: SLA Violations on Device

**Symptom**: `Bug capture latency exceeds 100ms`

**Solution**:
```bash
# Measure actual latency
cat audit.log | grep "BUG_CAPTURED" | jq '.latency_ms' | sort -n | tail

# Check device load
adb shell top -n 1 | head -20

# Reduce concurrent loads
# Lower concurrent bug capture rate during testing

# Adjust thresholds if device is slower
{
  "confidence_threshold": 0.80,      // Higher = fewer fixes
  "min_occurrences_before_fix": 5   // More evidence required
}
```

---

## Performance Profiles

### Baseline Expectations

**Typical ARM64 Device (Nexus 5X, Pixel)**
```
Bug Capture: 35-50ms (p95: 80ms)
Pattern Detection: 150-250ms (p95: 400ms)
Fix Application: 400-600ms (p95: 900ms)
Memory Usage: 120-180MB
Success Rate: 92-98%
```

**Typical ARM32 Device (Moto G)**
```
Bug Capture: 50-100ms (p95: 150ms)
Pattern Detection: 250-400ms (p95: 600ms)
Fix Application: 700-1000ms (p95: 1300ms)
Memory Usage: 100-150MB
Success Rate: 85-95%
```

### Load Testing

```bash
# Simulate high crash rate
for i in {1..100}; do
  adb shell am start -n com.example.testapp/com.example.testapp.CrashActivity &
  sleep 0.1
done

# Monitor engine behavior
adb logcat | grep -E "(capture|latency|memory)"

# Pull metrics after test
adb pull /data/local/tmp/frida-learning/metrics.json
cat metrics.json | jq '.performance_percentiles'
```

---

## Phase 4.1 Validation Checklist

- [ ] Prerequisites verified (Android 10+, Frida 14+, ADB)
- [ ] Device connected and accessible via ADB
- [ ] Frida server running on device
- [ ] Engine deployed successfully
- [ ] First crash triggered and captured
- [ ] Pattern detected after multiple crashes
- [ ] Fix applied and rollback validated
- [ ] All 9 SLAs measured and passing
- [ ] Health check endpoint functional
- [ ] Metrics exported successfully
- [ ] Alerts fire on SLA violations
- [ ] Audit trail complete and queryable
- [ ] No data corruption detected
- [ ] Deployment report generated
- [ ] SLA compliance report generated

---

## Next Steps (Phase 4.2)

- Canary deployment: 5% → 25% → 50% → 100%
- Auto-rollback validation on success rate drop
- Performance benchmarking under sustained load
- End-to-end conformance testing

---

**Version**: 1.0  
**Date**: 2026-08-28  
**Maintainer**: Runtime Learning Engine Team


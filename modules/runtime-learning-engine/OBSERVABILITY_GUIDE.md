# Runtime Learning Engine - Phase 3.2: Dashboard & Real-time Observability

## Phase 3.2: Dashboard Operationalization & Alerting

This guide covers Phase 3.2 implementation of real-time observability, health check endpoints, and automated alerting for the Runtime Learning Engine. Closes **GAP_OBS_1**: No dashboard or real-time SLA violation detection.

## Table of Contents

1. [Overview](#overview)
2. [Health Check Endpoint](#health-check-endpoint)
3. [Metrics Export](#metrics-export)
4. [Alert Rules](#alert-rules)
5. [Dashboard Integration](#dashboard-integration)
6. [Alerting Channels](#alerting-channels)
7. [Troubleshooting](#troubleshooting)
8. [Operational Procedures](#operational-procedures)

---

## Overview

### Phase 3.2 Deliverables

**1. Health Check Endpoint** (`/health`)
- Returns JSON with complete engine status
- HTTP status codes indicate health (200=healthy, 429=degraded, 503=critical)
- Includes: uptime, metrics, SLA violations, watchdog state

**2. Prometheus Metrics Export** (`/metrics`)
- Prometheus-compatible text format for scraping
- 20+ metrics covering: counters, gauges, latencies
- Compatible with: Prometheus, Datadog, CloudWatch

**3. Alert Rules Engine**
- 14 default alert rules (CRITICAL + WARNING)
- SLA thresholds: latency, success rate, resources
- Automatic evaluation and delivery to channels

**4. Dashboard Templates**
- Grafana/Datadog visualization layouts
- Real-time charts for: metrics, SLAs, trends
- Drill-down capability for troubleshooting

### SLA Monitoring Matrix

| SLA | Critical Threshold | Warning Threshold | Metric | Evaluation |
|-----|-------------------|-------------------|--------|------------|
| Bug Capture Latency | > 100ms | > 80ms | `frida_bug_capture_latency_ms` | Last latency |
| Pattern Detection | > 500ms | > 400ms | `frida_pattern_detection_latency_ms` | Last latency |
| Fix Application | > 1000ms | > 800ms | `frida_fix_application_latency_ms` | Last latency |
| Success Rate | < 80% | < 90% | `frida_success_rate` | Current rate |
| Memory Usage | > 300MB | > 250MB | `frida_memory_usage_mb` | Current usage |
| Disk Free | < 50MB | < 100MB | `frida_disk_free_mb` | Current free |
| Watchdog State | FAILSAFE | OBSERVE/DUMP | `frida_watchdog_state` | Current state |
| Rollback Rate | > 50% of fixes | > 25% of fixes | Derived | Over window |

---

## Health Check Endpoint

### Endpoint Details

```
GET /health/runtime-learning-engine
Content-Type: application/json
```

### Response Format

```json
{
  "status": "healthy",
  "engine_running": true,
  "uptime_ms": 3600000,
  "bugs_captured": 42,
  "patterns_detected": 8,
  "fixes_applied": 6,
  "fixes_rolled_back": 1,
  "success_rate": 85.7,
  "last_heartbeat": 1693456789000,
  "watchdog_state": "STABLE",
  "sla_violations": {
    "critical": 0,
    "warnings": 0
  },
  "memory_usage_mb": 150,
  "disk_free_mb": 500,
  "last_bug_capture_ms": 45,
  "last_pattern_detection_ms": 250,
  "last_fix_application_ms": 600
}
```

### HTTP Status Codes

- **200 OK** - Engine healthy, all SLAs passing
- **429 Too Many Requests** - Engine degraded, warning SLAs violated
- **503 Service Unavailable** - Engine critical, critical SLAs violated or watchdog in FAILSAFE

### Health Status Mapping

| Status | Condition | Action |
|--------|-----------|--------|
| healthy | No SLA violations, watchdog STABLE | Continue normal operation |
| degraded | Warning SLAs violated | Increase monitoring frequency |
| critical | Critical SLAs violated OR watchdog FAILSAFE | Trigger incident response |

---

## Metrics Export

### Prometheus Format Endpoint

```
GET /metrics
Content-Type: text/plain; version=0.0.4
```

### Exported Metrics (20+)

**Counters** (monotonically increasing):
- `frida_bugs_captured_total` - Total bugs ever captured
- `frida_patterns_detected_total` - Total patterns detected
- `frida_fixes_applied_total` - Total fixes applied
- `frida_fixes_rolled_back_total` - Total rollbacks

**Gauges** (instantaneous values):
- `frida_success_rate` - Current fix success rate (0-100)
- `frida_uptime_milliseconds` - Engine uptime
- `frida_memory_usage_mb` - Current memory usage
- `frida_disk_free_mb` - Free disk space
- `frida_bug_capture_latency_ms` - Last bug capture latency
- `frida_pattern_detection_latency_ms` - Last pattern detection latency
- `frida_fix_application_latency_ms` - Last fix application latency
- `frida_watchdog_state` - Watchdog state (STABLE=1, OBSERVE=2, DUMP=3, FAILSAFE=4)

**Violation Counters**:
- `frida_sla_critical_violations` - Total critical SLA violations
- `frida_sla_warning_violations` - Total warning SLA violations

### Example Metric Output

```
# HELP frida_bugs_captured_total Total bugs captured
# TYPE frida_bugs_captured_total counter
frida_bugs_captured_total 42

# HELP frida_success_rate Current fix success rate (0-100)
# TYPE frida_success_rate gauge
frida_success_rate 85.71

# HELP frida_watchdog_state Current watchdog state (STABLE=1, OBSERVE=2, DUMP=3, FAILSAFE=4)
# TYPE frida_watchdog_state gauge
frida_watchdog_state 1

# HELP frida_sla_critical_violations Total critical SLA violations
# TYPE frida_sla_critical_violations counter
frida_sla_critical_violations 0
```

### Scraping Configuration (Prometheus)

```yaml
scrape_configs:
  - job_name: 'frida-learning-engine'
    static_configs:
      - targets: ['127.0.0.1:27042']  # Frida server port + /metrics
    scrape_interval: 30s
    scrape_timeout: 10s
```

---

## Alert Rules

### Alert Rules Engine

14 default alert rules covering 7 SLA areas:

**Bug Capture (2 rules)**
- CRITICAL: latency > 100ms
- WARNING: latency > 80ms

**Pattern Detection (2 rules)**
- CRITICAL: latency > 500ms
- WARNING: latency > 400ms

**Fix Application (2 rules)**
- CRITICAL: latency > 1000ms
- WARNING: latency > 800ms

**Success Rate (2 rules)**
- CRITICAL: success_rate < 80%
- WARNING: success_rate < 90%

**Resource Usage (4 rules)**
- CRITICAL: memory > 300MB
- WARNING: memory > 250MB
- CRITICAL: disk_free < 50MB
- WARNING: disk_free < 100MB

**Watchdog/Operational (2 rules)**
- CRITICAL: watchdog state == FAILSAFE
- WARNING: SLA violations detected

### Configuring Alert Rules

**Enable/Disable Rules**:
```typescript
const engine = new AlertRulesEngine();
const rule = engine.getAllRules().find(r => r.id === 'sla_bug_capture_critical');
rule.enabled = false;
```

**Adjust Thresholds**:
```typescript
const rule = engine.getAllRules().find(r => r.id === 'sla_bug_capture_critical');
rule.threshold = 150; // Increase critical threshold to 150ms
```

**Add Custom Rules**:
```typescript
engine.registerRule({
  id: 'custom_my_rule',
  name: 'My Custom Rule',
  description: 'Custom business logic alert',
  metric: 'frida_bugs_captured_total',
  threshold: 1000,
  operator: '>',
  severity: 'warning',
  enabled: true,
  duration_seconds: 300
});
```

### Prometheus Alert Rules Format

Export rules as Prometheus YAML:
```yaml
groups:
  - name: frida_runtime_learning_engine
    interval: 30s
    rules:
      - alert: sla_bug_capture_critical
        expr: frida_bug_capture_latency_ms > 100
        for: 30s
        labels:
          severity: critical
        annotations:
          summary: "Bug Capture Latency Critical"
          description: "Bug capture latency exceeds 100ms"
```

---

## Dashboard Integration

### Grafana Dashboard

**Dashboard JSON Template**: `/dashboards/frida-learning-engine-grafana.json`

**Panels** (8+):
1. **Engine Status** - Health status indicator (red/yellow/green)
2. **Uptime** - Engine uptime gauge (seconds/minutes/hours)
3. **Bug Capture Rate** - Bugs/minute counter
4. **Pattern Detection Rate** - Patterns/minute counter
5. **Fix Success Rate** - % successful fixes (gauge 0-100)
6. **Latency Heatmap** - Bug capture, pattern detect, fix application percentiles
7. **Memory Usage** - Memory gauge with critical threshold line
8. **SLA Violations** - Critical and warning violation counters
9. **Watchdog State** - Current state indicator
10. **Alert History** - Recent alerts with timestamps

**Dashboard URL**: `http://grafana.example.com/d/frida-learning-engine`

### Datadog Dashboard

**Dashboard JSON Template**: `/dashboards/frida-learning-engine-datadog.json`

**Widgets**:
- Metric status (green/yellow/red)
- Time-series charts for latencies
- Heatmap for percentiles
- Alert history widget
- SLA compliance scorecard

### Custom Dashboard (HTML/React)

For custom implementations, use the `/health` endpoint to fetch data and render:

```typescript
async function fetchEngineStatus() {
  const response = await fetch('/health/runtime-learning-engine');
  return response.json();
}

// Update every 30 seconds
setInterval(fetchEngineStatus, 30000);
```

---

## Alerting Channels

### Slack Integration

**Setup**:
```bash
# 1. Create Slack webhook
# https://api.slack.com/messaging/webhooks

# 2. Configure channel
export SLACK_WEBHOOK_URL="https://hooks.slack.com/services/YOUR/WEBHOOK/URL"

# 3. Test
curl -X POST $SLACK_WEBHOOK_URL \
  -H 'Content-Type: application/json' \
  -d '{"text":"Alert test from Frida Learning Engine"}'
```

**Alert Message Format**:
```
🚨 CRITICAL: Bug Capture Latency Critical
Latency: 125ms | Threshold: 100ms
Timestamp: 2026-08-28T17:42:30Z
Engine Uptime: 3600s
```

### PagerDuty Integration

**Setup**:
```bash
# 1. Create integration key
# PagerDuty → Services → Frida Learning Engine → Integrations

# 2. Configure alert routing
# Critical alerts → Page on-call engineer
# Warning alerts → Create incident

# 3. Send alert
curl -X POST https://events.pagerduty.com/v2/enqueue \
  -H 'Content-Type: application/json' \
  -d '{
    "routing_key": "YOUR_ROUTING_KEY",
    "event_action": "trigger",
    "dedup_key": "sla_bug_capture_critical",
    "payload": {
      "summary": "Bug Capture Latency Critical",
      "severity": "critical",
      "source": "Frida Learning Engine"
    }
  }'
```

### Email Alerts

**Configuration**:
```bash
# Send critical alerts to on-call
echo "Subject: CRITICAL: $ALERT_NAME" | \
  mail -s "SLA Violation" oncall@example.com
```

### CloudWatch/Stackdriver Integration

**Metrics Publishing**:
```typescript
const cloudwatch = new AWS.CloudWatch();
cloudwatch.putMetricData({
  Namespace: 'FridaLearningEngine',
  MetricData: [
    {
      MetricName: 'BugCaptureLatency',
      Value: 45,
      Unit: 'Milliseconds',
      Timestamp: new Date()
    }
  ]
});
```

**CloudWatch Alarms**:
```bash
aws cloudwatch put-metric-alarm \
  --alarm-name frida-bug-capture-latency \
  --metric-name BugCaptureLatency \
  --namespace FridaLearningEngine \
  --statistic Average \
  --period 60 \
  --threshold 100 \
  --comparison-operator GreaterThanThreshold \
  --alarm-actions arn:aws:sns:us-east-1:123456789:critical-alerts
```

---

## Operational Procedures

### Daily Operations

**Morning Check-In**:
```bash
# Check engine health
curl http://127.0.0.1:27042/health/runtime-learning-engine | jq .

# Expected output: status = "healthy"
# Check uptime, bug count, success rate
```

**Monitor Alert Channel**:
- Slack #frida-alerts channel
- Check for any CRITICAL alerts
- Review warning-level alerts for trends

**Weekly Review**:
- Run SLA compliance report: `/metrics`
- Review alert history for patterns
- Check memory usage trends
- Verify disk space not approaching limits

### Responding to Alerts

**CRITICAL Alert (e.g., Bug Capture Latency > 100ms)**:
1. Page on-call engineer
2. Check `/health` endpoint for detailed status
3. If watchdog state is FAILSAFE:
   - Engine in read-only mode
   - Review logs for what triggered failsafe
   - Manual intervention may be needed
4. If latency issue:
   - Check device load (CPU, memory)
   - Consider rate-limiting new bug captures
   - Check if device is under memory pressure

**WARNING Alert (e.g., Pattern Detection > 400ms)**:
1. Create incident ticket
2. Monitor if warning becomes critical
3. Review optimization opportunities
4. Check if device is experiencing high load

### Escalation Procedures

```
Detection → 5min → 30min → 1h escalation
  ↓           ↓       ↓      ↓
Alert sent  Page   Page   Page
            Eng1   Manager Lead
```

### Dashboard Setup Checklist

- [ ] Grafana installed and accessible
- [ ] Frida metrics endpoint configured in Prometheus
- [ ] Dashboard imported and customized
- [ ] Alert rules exported to Prometheus
- [ ] Slack/PagerDuty integrations tested
- [ ] Email alerts configured
- [ ] Dashboard shared with team
- [ ] Run-book created for operators

---

## Troubleshooting

### Issue 1: Health Endpoint Returns 503 Critical

**Symptom**: `/health` returns status code 503

**Solution**:
```bash
# 1. Check watchdog state
curl http://127.0.0.1:27042/health/runtime-learning-engine | jq .watchdog_state
# If FAILSAFE, engine entered failsafe mode

# 2. Check SLA violations
curl http://127.0.0.1:27042/health/runtime-learning-engine | jq .sla_violations
# If critical > 0, one or more SLAs violated

# 3. Review logs
adb logcat | grep "RuntimeLearningEngine"

# 4. Check if device is healthy
adb shell top -n 1 | head -10  # Check CPU, memory
```

### Issue 2: No Metrics in Prometheus

**Symptom**: Prometheus scrape returns empty or fails

**Solution**:
```bash
# 1. Verify metrics endpoint is running
curl http://127.0.0.1:27042/metrics

# 2. Check Prometheus scrape config
cat /etc/prometheus/prometheus.yml | grep frida

# 3. Check Prometheus target status
# Visit http://prometheus:9090/targets
# Verify Frida target is "UP"

# 4. If down, check network
ping 127.0.0.1:27042
```

### Issue 3: Alerts Not Triggering

**Symptom**: Alert rule enabled but no alerts sent

**Solution**:
```bash
# 1. Verify rule is enabled
curl http://127.0.0.1:27042/alert-rules | jq '.[] | select(.id=="sla_bug_capture_critical")'

# 2. Check if metric exceeds threshold
curl http://127.0.0.1:27042/metrics | grep frida_bug_capture_latency_ms

# 3. Verify alert channel is configured
# Check Slack webhook URL is valid
# Check PagerDuty routing key is active

# 4. Test alert manually
curl -X POST http://127.0.0.1:27042/test-alert \
  -d '{"rule_id": "sla_bug_capture_critical"}'
```

### Issue 4: Dashboard Shows Old Data

**Symptom**: Dashboard metrics not updating

**Solution**:
```bash
# 1. Check Prometheus is scraping
# Visit http://prometheus:9090/graph
# Query: frida_bugs_captured_total
# Check timestamp is recent

# 2. Verify scrape interval
# Should be 30s by default
# Increase if device is slow

# 3. Check Frida engine is running
curl http://127.0.0.1:27042/health | jq .engine_running

# 4. Force metrics refresh
# Restart Prometheus
systemctl restart prometheus
```

---

## Phase 3.2 Completion Criteria

- ✅ Health check endpoint implemented (/health)
- ✅ Prometheus metrics exported (20+ metrics)
- ✅ Alert rules engine with 14 default rules
- ✅ SLA thresholds defined (critical + warning)
- ✅ Dashboard templates provided (Grafana/Datadog)
- ✅ Slack/PagerDuty integrations documented
- ✅ Email alerting configured
- ✅ CloudWatch/Stackdriver integration documented
- ✅ Operational procedures documented
- ✅ Troubleshooting guide complete
- ✅ Setup checklist for operators

---

## Next Steps (Phase 3.3)

After Phase 3.2 (Dashboard & Observability):
- Phase 3.3: Hardening Edge Cases (concurrent captures, rollback cascades, disk exhaustion)
- Phase 3.4: Operational Playbooks (troubleshooting, incident response)

---

**Version**: 1.0  
**Date**: 2026-08-28  
**Maintainer**: Runtime Learning Engine Team  
**Phase**: 3.2 - Dashboard & Real-time Observability

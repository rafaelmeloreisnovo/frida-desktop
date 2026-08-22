# GUI Architecture: Test & Results Navigation System

**Date:** 2026-08-22  
**Status:** Design + Implementation Phase 1  
**Audience:** Developers, DevOps, Researchers

---

## Overview

Frida-desktop now includes a **hybrid GUI system** for observing, testing, and analyzing RFL (Runtime Feedback Learning) behavior:

```
On-Device (Android)           Backend (Node.js)             Frontend (React)
┌──────────────────┐          ┌──────────────────┐          ┌──────────────────┐
│ MainActivity     │◄────────►│ Express API      │◄────────►│ Dashboard        │
│ + ResearchPanel  │  JNI     │ + SQLite cache   │  REST    │ + Charts         │
│ Live metrics     │          │ Data aggregation │          │ + Timeline       │
└──────────────────┘          └──────────────────┘          └──────────────────┘
        │
        └──► Frida Gadget (port 27042)
```

---

## 1. On-Device GUI (MainActivity)

### Architecture

**File:** `android/frida-lab/src/io/rafaelia/fridalab/MainActivity.java`

The MainActivity expands from single-panel to **triple-panel layout**:

```
┌─────────────────────────────────────────────────┐
│ System Status Panel                             │
├─────────────────────────────────────────────────┤
│ Device: ${ABI} | SDK: ${SDK} | Debuggable: ok  │
│ Endpoint: 127.0.0.1:27042                      │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│ Developer Mode                                  │
├─────────────────────────────────────────────────┤
│ ☑ Enable Developer Mode                         │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│ Research Mode (NEW)                             │
├─────────────────────────────────────────────────┤
│ Mode: [OFF ▼]  ← Spinner                       │
│                                                 │
│ Live Metrics:                                   │
│ • Accuracy:        -- %                         │
│ • Overhead:        -- %                         │
│ • Memory:          -- KB                        │
│ • Contexts:        -- count                     │
│                                                 │
│ [Start Test] [Stop] [Snapshot]                  │
│ [Export Data] [View Timeline]                   │
└─────────────────────────────────────────────────┘
```

### Components

| Component | Class | Purpose |
|-----------|-------|---------|
| Mode Spinner | `ResearchModeSpinner` | Select OBSERVE/LEARN/PREDICT/VALIDATE/FROZEN |
| Metrics Display | `MetricsDisplay` | Real-time gauge for 4 key metrics |
| Action Buttons | `ResearchActionButtons` | Start/Stop/Snapshot/Export |
| Timeline View | `TimelineFragment` | Historical progression (modal overlay) |
| Snapshot Popup | `SnapshotDialog` | Capture state at moment-in-time |

### Data Flow

```
MainActivity.onCreate()
  ├─ loadRFLBridge()  [JNI to native RFL]
  ├─ startMetricsPoller() [100ms interval]
  │   └─ nativeLearningSnapshot() → JSON
  │       └─ MetricsDisplay.update()
  └─ setupResearchPanel()
      ├─ ModeSpinner.setOnItemSelectedListener()
      ├─ startButton.setOnClickListener()
      │   └─ nativeLearningSetMode(mode)
      └─ snapshotButton.setOnClickListener()
          └─ captureSnapshot() → device storage + log
```

### Metrics Collected (100ms polling)

| Metric | Source | Type | Update Freq |
|--------|--------|------|------------|
| `accuracy_percent` | native RFL | gauge | 100ms |
| `overhead_percent` | CPU sampler | gauge | 1s |
| `memory_bytes` | Java Runtime | gauge | 1s |
| `context_count` | native RFL | counter | 100ms |

---

## 2. Backend API (Node.js + Express)

### Architecture

**Directory:** `dashboard/backend/`

Express server aggregates data from:
1. Device snapshots (pushed via HTTP POST)
2. SQLite local cache (historical results)
3. Test results (from pytest harness)

### Endpoints

```
GET    /api/metrics/latest           → Current snapshot
GET    /api/metrics/timeline/:run_id → Historical points (1min bins)
GET    /api/runs                      → List test runs
GET    /api/runs/:run_id              → Single run details + results
POST   /api/snapshot                  → Device pushes snapshot
GET    /api/ontology                  → Semantic tree
GET    /api/ontology/component/:name  → Component detail
GET    /api/health                    → Service status
```

### Database Schema

```sql
CREATE TABLE test_runs (
    id TEXT PRIMARY KEY,
    created_at TIMESTAMP,
    device_abi TEXT,
    device_sdk INTEGER,
    suite_id TEXT,
    status TEXT,  -- PASS, FAIL, SKIPPED
    summary JSON
);

CREATE TABLE snapshots (
    id TEXT PRIMARY KEY,
    run_id TEXT,
    timestamp TIMESTAMP,
    accuracy_percent REAL,
    overhead_percent REAL,
    memory_bytes INTEGER,
    context_count INTEGER,
    FOREIGN KEY(run_id) REFERENCES test_runs(id)
);

CREATE TABLE metrics (
    id TEXT PRIMARY KEY,
    run_id TEXT,
    scenario_id TEXT,
    metric_name TEXT,
    value REAL,
    unit TEXT,
    timestamp TIMESTAMP,
    FOREIGN KEY(run_id) REFERENCES test_runs(id)
);
```

---

## 3. Frontend Dashboard (React)

### Architecture

**Directory:** `dashboard/web/src/`

Single-page application with 4 main views:

### View 1: Live Dashboard

```
┌─────────────────────────────────────┐
│ RFL Learning Dashboard              │
├─────────────────────────────────────┤
│ Current Run: ${run_id}  │ Device: ${abi}
│ ─────────────────────────────────────
│ ┌──────────────────────────────────┐ │
│ │ Accuracy:  85.5%                 │ │
│ │ Overhead:   8.3%                 │ │
│ │ Memory:  45 KB                   │ │
│ │ Contexts:  127 active            │ │
│ └──────────────────────────────────┘ │
│                                       │
│ Last Update: 100ms ago                │
│ ─────────────────────────────────────
│ [Pause] [Download] [Compare Runs]     │
└─────────────────────────────────────┘
```

### View 2: Test Timeline

```
Scenario: Cold Start Behavior
Start Time: 2026-08-22 10:30:15 UTC
Duration: 20s

Accuracy over time:
  ├─ Phase 1 (OBSERVE): 0%  ─────────┐
  │                                    ├─ Rise to 85.5%
  ├─ Phase 2 (LEARN_SHADOW): 45%  ─┐  │
  │                                  ├─ Steep climb
  └─ Phase 3 (PREDICT): 85.5% ────┘  │
                                      └─ Plateau

Overlay: [Accuracy] [Overhead] [Memory] [Contexts]
```

### View 3: Test Runs History

| Suite ID | Date | Device | Status | Accuracy | Overhead | Duration |
|----------|------|--------|--------|----------|----------|----------|
| abc123 | 2026-08-22 10:30 | arm64-v8a | ✅ PASS | 85.5% | 8.3% | 20s |
| abc124 | 2026-08-22 11:45 | arm64-v8a | ✅ PASS | 87.2% | 7.1% | 19s |
| abc125 | 2026-08-22 13:00 | armeabi-v7a | ⚠️ FAIL | 62.1% | 18.5% | 18s |

### View 4: Architecture Navigator

```
┌─────────────────────────────────────┐
│ RFL Component Map                   │
├─────────────────────────────────────┤
│                                     │
│  RFLPredictor  ────────┐            │
│  1024 entries  (1KiB)  │            │
│  +-- ContextCache      │            │
│  +-- Slab Allocator    ├─ Affects  │
│  +-- DeltaMissMode     │            │
│  +-- ErrorRecovery ────┤ Tests:    │
│  +-- Confidence        │ •Cold Start
│  +-- GC         ───────┤ •Cache Miss
│                        │ •Adversarial
│                        └─ Metrics:
│                          •Accuracy
│                          •Overhead
│                          •Memory
│
└─────────────────────────────────────┘

Click component → show all tests affecting it
```

---

## 4. Ontology Integration

The **semantic tree** (`ontology/learning-semantic-tree.v1.json`) powers navigation:

```json
{
  "scenario": {
    "id": "scenario_cold_start",
    "affects_components": ["RFLPredictor", "ContextCache"],
    "metrics": ["accuracy_percent", "overhead_percent"],
    "expected_outcomes": {
      "accuracy_min": 60.0,
      "overhead_max_percent": 15.0
    }
  }
}
```

**UI behavior:**
- Click test → highlight affected components
- Click component → show all tests using it
- Color code gates: 🟢 PASS, 🔴 FAIL, 🟡 BORDERLINE

---

## 5. Data Flow: End-to-End

### Scenario 1: Live Observation

```
[Device]                    [Backend]              [Browser]
RFL running in OBSERVE mode
    │
    ├─ nativeLearningSnapshot() (100ms)
    │     │
    │     ├─ → JSON: {accuracy, overhead, memory, contexts}
    │     │
    │     └─ POST /api/snapshot
    │           │
    │           ├─ Store in SQLite.snapshots
    │           │
    │           └─ Broadcast via WebSocket → React Dashboard
    │
[UI updates in real-time]
```

### Scenario 2: Test Execution

```
[Host]                      [Backend]              [Device]
pytest test_runner.py
    │
    ├─ For each scenario:
    │     ├─ POST /api/runs/{run_id}/start
    │     │
    │     ├─ → Device: adb shell am start ...
    │     │
    │     ├─ Poll device every 500ms
    │     │     └─ adb logcat | grep RFL_METRIC
    │     │
    │     ├─ Collect metrics
    │     │
    │     └─ POST /api/runs/{run_id}/metrics {scenario, results}
    │           │
    │           └─ Store in SQLite.metrics
    │
    ├─ Final: POST /api/runs/{run_id}/complete {summary}
    │
[Web dashboard updates with full results]
```

---

## 6. Technology Stack

| Layer | Technology | Role |
|-------|-----------|------|
| On-Device UI | Android (Java 11) | Live metrics, mode control |
| Backend API | Node.js 18 + Express | Data aggregation, persistence |
| Frontend | React 18 + Recharts | Dashboard, visualization |
| Database | SQLite 3 | Persistent cache |
| Communication | REST + WebSocket | API calls + real-time updates |
| Ontology | JSON Schema | Semantic structure |

---

## 7. Build & Deployment

### Prerequisites

```bash
# Android NDK + SDK
export ANDROID_HOME=/opt/android-sdk
export NDK_VERSION=26.1.10909125

# Node.js
node --version  # v18+

# npm
npm --version   # v9+
```

### Build Steps

```bash
# 1. Compile Android app
cd android/frida-lab
./gradlew :app:assembleDebug

# 2. Install on device
adb install -r build/outputs/apk/debug/fridalab-debug.apk

# 3. Start backend
cd ../../dashboard/backend
npm install
npm start      # Runs on http://localhost:3000

# 4. Start web dashboard
cd ../web
npm install
npm run dev    # Runs on http://localhost:5173 (Vite)

# 5. Run tests
cd ../../tests/harness
python3 test_runner.py
```

---

## 8. File Structure

```
frida-desktop/
├── ontology/
│   └── learning-semantic-tree.v1.json        (Semantic model)
│
├── android/frida-lab/
│   ├── src/io/rafaelia/fridalab/
│   │   ├── MainActivity.java                 (Expanded with Research Mode)
│   │   ├── ui/
│   │   │   ├── ResearchModeSpinner.java      (NEW)
│   │   │   ├── MetricsDisplay.java           (NEW)
│   │   │   └── ResearchActionButtons.java    (NEW)
│   │   └── learning/
│   │       ├── RFLBridge.java                (JNI interface)
│   │       └── MetricsPoller.java            (NEW)
│   │
│   └── build.gradle
│
├── tests/
│   ├── harness/
│   │   ├── test_runner.py                    (Main orchestrator)
│   │   ├── scenarios/
│   │   │   ├── scenario_cold_start.py        (Scenario implementation)
│   │   │   ├── scenario_cache_miss.py
│   │   │   ├── scenario_adversarial.py
│   │   │   └── scenario_sustained_load.py
│   │   └── fixtures/
│   │       └── device_states.py              (Predefined device configs)
│   │
│   └── results/                              (Generated)
│       ├── index.json
│       └── ${suite_id}/
│           ├── summary.json
│           └── ${scenario_id}.json
│
├── dashboard/
│   ├── backend/
│   │   ├── server.js                        (Express entry)
│   │   ├── routes/
│   │   │   ├── metrics.js                   (GET /api/metrics/*)
│   │   │   ├── runs.js                      (GET/POST /api/runs/*)
│   │   │   └── ontology.js                  (GET /api/ontology/*)
│   │   ├── db/
│   │   │   └── schema.sql                   (SQLite DDL)
│   │   └── package.json
│   │
│   └── web/
│       ├── src/
│       │   ├── components/
│       │   │   ├── Dashboard.tsx             (Live view)
│       │   │   ├── TestTimeline.tsx          (Historical view)
│       │   │   ├── TestRunsList.tsx          (History table)
│       │   │   ├── ArchitectureNavigator.tsx (Component map)
│       │   │   └── MetricsChart.tsx          (Recharts wrapper)
│       │   ├── pages/
│       │   │   ├── HomePage.tsx
│       │   │   └── RunDetailPage.tsx
│       │   ├── api.ts                       (REST client)
│       │   └── App.tsx
│       └── package.json
│
└── docs/
    ├── GUI_ARCHITECTURE.md                  (This file)
    └── TEST_HARNESS_GUIDE.md                (Testing guide)
```

---

## 9. Next Steps

### Phase 1 (This week)
- ✅ Design ontology (learning-semantic-tree.v1.json)
- ✅ Implement test harness (test_runner.py)
- 🔄 Expand MainActivity with Research Mode Panel
- 🔄 Create Node.js backend skeleton

### Phase 2 (Next week)
- Create React dashboard
- Integrate WebSocket for real-time updates
- Implement scenario tests

### Phase 3 (Final)
- Physical device validation
- Performance optimization
- Production hardening

---

## 10. Testing & Validation

### Unit Tests
```bash
python3 -m pytest tests/harness/test_runner.py -v
npm test --prefix dashboard/backend
npm test --prefix dashboard/web
```

### Integration Tests
```bash
# End-to-end: device → backend → web
./tests/harness/adb-test-harness.sh
```

### Device Validation
```bash
adb shell logcat | grep RFL_METRIC
# Verify metrics flowing to backend
curl http://localhost:3000/api/metrics/latest
```

---

**Responsible:** RFL Learning Engine Team  
**Last Updated:** 2026-08-22  
**Status:** Design Complete, Implementation In Progress

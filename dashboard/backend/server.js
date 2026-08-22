#!/usr/bin/env node
/**
 * RFL Learning Dashboard Backend
 *
 * Express server aggregating:
 * - Device metrics (pushed from Android app)
 * - Test results (from pytest harness)
 * - Ontology navigation (semantic tree)
 *
 * Usage:
 *   node server.js           # Production mode (port 3000)
 *   PORT=3001 node server.js # Custom port
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const sqlite3 = require('sqlite3').verbose();
const WebSocket = require('ws');
const http = require('http');

// ============================================================================
// Configuration
// ============================================================================

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || './data/rfl_metrics.db';
const ONTOLOGY_PATH = process.env.ONTOLOGY_PATH || '../../ontology/learning-semantic-tree.v1.json';

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// ============================================================================
// Express Setup
// ============================================================================

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../web/dist')));

// ============================================================================
// Database
// ============================================================================

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Database connection error:', err);
    process.exit(1);
  }
  console.log('Connected to SQLite database:', DB_PATH);
  initializeDatabase();
});

function initializeDatabase() {
  db.serialize(() => {
    // Test runs table
    db.run(`
      CREATE TABLE IF NOT EXISTS test_runs (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        device_abi TEXT,
        device_sdk INTEGER,
        suite_id TEXT,
        status TEXT DEFAULT 'PENDING',
        summary JSON
      )
    `);

    // Snapshots table
    db.run(`
      CREATE TABLE IF NOT EXISTS snapshots (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        accuracy_percent REAL,
        overhead_percent REAL,
        memory_bytes INTEGER,
        context_count INTEGER,
        FOREIGN KEY(run_id) REFERENCES test_runs(id)
      )
    `);

    // Metrics table (fine-grained metrics per test)
    db.run(`
      CREATE TABLE IF NOT EXISTS metrics (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        scenario_id TEXT,
        metric_name TEXT,
        value REAL,
        unit TEXT,
        timestamp TEXT,
        FOREIGN KEY(run_id) REFERENCES test_runs(id)
      )
    `);

    console.log('Database initialized');
  });
}

// ============================================================================
// Ontology Loading
// ============================================================================

let ontology = null;

function loadOntology() {
  try {
    const fullPath = path.resolve(__dirname, ONTOLOGY_PATH);
    ontology = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    console.log('Loaded ontology:', fullPath);
  } catch (err) {
    console.warn('Warning: Could not load ontology:', err.message);
    ontology = { version: '1.0.0', test_scenarios: [], components: [] };
  }
}

loadOntology();

// ============================================================================
// Metrics Endpoints
// ============================================================================

/**
 * GET /api/metrics/latest
 * Return most recent snapshot across all runs
 */
app.get('/api/metrics/latest', (req, res) => {
  db.get(
    `SELECT * FROM snapshots ORDER BY timestamp DESC LIMIT 1`,
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json(row || {});
    }
  );
});

/**
 * GET /api/metrics/timeline/:run_id
 * Return timeline of metrics for a specific run
 * Query params: ?bin_size_ms=1000 (aggregate by time bucket)
 */
app.get('/api/metrics/timeline/:run_id', (req, res) => {
  const { run_id } = req.params;
  const { bin_size_ms = '1000' } = req.query;

  db.all(
    `SELECT timestamp, accuracy_percent, overhead_percent, memory_bytes, context_count
     FROM snapshots
     WHERE run_id = ?
     ORDER BY timestamp ASC`,
    [run_id],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      // Bin results by time window
      const binSize = parseInt(bin_size_ms);
      const binned = {};

      rows.forEach((row) => {
        const ts = new Date(row.timestamp).getTime();
        const bin = Math.floor(ts / binSize) * binSize;
        if (!binned[bin]) {
          binned[bin] = { count: 0, ...row };
        } else {
          // Average within bin
          binned[bin].accuracy_percent =
            (binned[bin].accuracy_percent + row.accuracy_percent) / 2;
          binned[bin].overhead_percent =
            (binned[bin].overhead_percent + row.overhead_percent) / 2;
          binned[bin].context_count =
            Math.max(binned[bin].context_count, row.context_count);
        }
      });

      const timeline = Object.keys(binned)
        .sort()
        .map((k) => ({
          timestamp: new Date(parseInt(k)).toISOString(),
          ...binned[k],
        }));

      res.json(timeline);
    }
  );
});

/**
 * POST /api/snapshot
 * Device pushes a snapshot
 */
app.post('/api/snapshot', (req, res) => {
  const { run_id, accuracy_percent, overhead_percent, memory_bytes, context_count } = req.body;

  if (!run_id) {
    return res.status(400).json({ error: 'run_id required' });
  }

  const snapshot = {
    id: uuidv4(),
    run_id,
    timestamp: new Date().toISOString(),
    accuracy_percent,
    overhead_percent,
    memory_bytes,
    context_count,
  };

  db.run(
    `INSERT INTO snapshots (id, run_id, timestamp, accuracy_percent, overhead_percent, memory_bytes, context_count)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      snapshot.id,
      snapshot.run_id,
      snapshot.timestamp,
      snapshot.accuracy_percent,
      snapshot.overhead_percent,
      snapshot.memory_bytes,
      snapshot.context_count,
    ],
    function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      // Broadcast to WebSocket clients
      broadcastSnapshot(snapshot);

      res.status(201).json(snapshot);
    }
  );
});

// ============================================================================
// Test Runs Endpoints
// ============================================================================

/**
 * GET /api/runs
 * List all test runs
 */
app.get('/api/runs', (req, res) => {
  db.all(
    `SELECT * FROM test_runs ORDER BY created_at DESC LIMIT 50`,
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json(rows || []);
    }
  );
});

/**
 * POST /api/runs
 * Start a new test run
 */
app.post('/api/runs', (req, res) => {
  const { suite_id, device_abi, device_sdk } = req.body;

  const run = {
    id: uuidv4(),
    created_at: new Date().toISOString(),
    device_abi,
    device_sdk,
    suite_id: suite_id || uuidv4(),
    status: 'RUNNING',
  };

  db.run(
    `INSERT INTO test_runs (id, created_at, device_abi, device_sdk, suite_id, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [run.id, run.created_at, run.device_abi, run.device_sdk, run.suite_id, run.status],
    function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.status(201).json(run);
    }
  );
});

/**
 * GET /api/runs/:run_id
 * Get details for a specific run
 */
app.get('/api/runs/:run_id', (req, res) => {
  const { run_id } = req.params;

  db.get(
    `SELECT * FROM test_runs WHERE id = ?`,
    [run_id],
    (err, run) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      if (!run) {
        return res.status(404).json({ error: 'Run not found' });
      }

      // Fetch snapshots for this run
      db.all(
        `SELECT * FROM snapshots WHERE run_id = ? ORDER BY timestamp ASC`,
        [run_id],
        (err, snapshots) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }

          res.json({
            ...run,
            snapshots: snapshots || [],
          });
        }
      );
    }
  );
});

/**
 * POST /api/runs/:run_id/complete
 * Mark run as complete with summary
 */
app.post('/api/runs/:run_id/complete', (req, res) => {
  const { run_id } = req.params;
  const { status, summary } = req.body;

  db.run(
    `UPDATE test_runs SET status = ?, summary = ? WHERE id = ?`,
    [status || 'COMPLETE', JSON.stringify(summary), run_id],
    function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      res.json({ id: run_id, status, summary });
    }
  );
});

// ============================================================================
// Ontology Endpoints
// ============================================================================

/**
 * GET /api/ontology
 * Return full ontology
 */
app.get('/api/ontology', (req, res) => {
  res.json(ontology);
});

/**
 * GET /api/ontology/scenario/:scenario_id
 * Get details for a specific scenario
 */
app.get('/api/ontology/scenario/:scenario_id', (req, res) => {
  const { scenario_id } = req.params;

  const scenario = ontology.test_scenarios?.find((s) => s.id === scenario_id);

  if (!scenario) {
    return res.status(404).json({ error: 'Scenario not found' });
  }

  res.json(scenario);
});

/**
 * GET /api/ontology/component/:component_id
 * Get details for a specific component
 */
app.get('/api/ontology/component/:component_id', (req, res) => {
  const { component_id } = req.params;

  const component = ontology.components?.find((c) => c.id === component_id);

  if (!component) {
    return res.status(404).json({ error: 'Component not found' });
  }

  // Find all tests that affect this component
  const affectingTests = ontology.test_scenarios?.filter((s) =>
    s.affects_components?.includes(component.name)
  ) || [];

  res.json({
    ...component,
    affected_by_tests: affectingTests,
  });
});

// ============================================================================
// Health Check
// ============================================================================

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

// ============================================================================
// WebSocket (Real-time updates)
// ============================================================================

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  console.log('WebSocket client connected');

  ws.send(JSON.stringify({ type: 'connected', message: 'Connected to RFL Dashboard' }));

  ws.on('close', () => {
    console.log('WebSocket client disconnected');
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });
});

function broadcastSnapshot(snapshot) {
  const message = JSON.stringify({
    type: 'snapshot',
    data: snapshot,
  });

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// ============================================================================
// Static Files (SPA fallback)
// ============================================================================

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../web/dist/index.html'), (err) => {
    if (err) {
      res.status(404).json({ error: 'Not found' });
    }
  });
});

// ============================================================================
// Error Handler
// ============================================================================

app.use((err, req, res, next) => {
  console.error('Express error:', err);
  res.status(500).json({ error: err.message });
});

// ============================================================================
// Server Start
// ============================================================================

server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║   RFL Learning Dashboard Backend                           ║
║   listening on http://localhost:${PORT}                       ║
║                                                            ║
║   API:      http://localhost:${PORT}/api/*                  ║
║   WebSocket:ws://localhost:${PORT}                          ║
║   Database:${DB_PATH}              ║
║                                                            ║
║   Ontology: ${ONTOLOGY_PATH}         ║
╚════════════════════════════════════════════════════════════╝
  `);
});

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  db.close();
  server.close();
  process.exit(0);
});

const express = require('express');
const fs = require('fs');
const path = require('path');

const DEFAULT_CONTRACT_PATH = path.resolve(
  __dirname,
  '../../docs/contracts/frida_lifecycle.v1.json'
);
const DEFAULT_EVIDENCE_PATH = path.resolve(
  __dirname,
  '../../evidence/lifecycle/lifecycle-state.v1.json'
);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function statOrNull(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return {
      path: filePath,
      bytes: stat.size,
      modified_at: stat.mtime.toISOString(),
    };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

function createLifecycleRouter(options = {}) {
  const router = express.Router();
  const contractPath = options.contractPath || process.env.LIFECYCLE_CONTRACT_PATH || DEFAULT_CONTRACT_PATH;
  const evidencePath = options.evidencePath || process.env.LIFECYCLE_EVIDENCE_PATH || DEFAULT_EVIDENCE_PATH;

  router.get('/', (req, res) => {
    try {
      const contract = readJson(contractPath);
      const evidenceMeta = statOrNull(evidencePath);
      let evidence = null;

      if (evidenceMeta) {
        evidence = readJson(evidencePath);
      }

      res.json({
        schema: 'rafaelia.frida.lifecycle.dashboard/v1',
        mode: 'READ_ONLY',
        source_first: true,
        claim_allowed: false,
        contract,
        evidence_state: evidence ? 'LOCAL_RECEIPT_PRESENT' : 'TOKEN_VAZIO_LOCAL_RECEIPT_NOT_PRESENT',
        evidence,
        sources: {
          contract: statOrNull(contractPath),
          evidence: evidenceMeta,
        },
        boundaries: [
          'DASHBOARD_VIEW!=AUTHORITY',
          'LOCAL_RECEIPT_ABSENT!=ZERO',
          'HOSTED_CI!=PHYSICAL_DEVICE_EVIDENCE',
          'PR_PASS!=SERVER_SIDE_PROTECTION',
          'ARTIFACT!=RELEASE_AUTHORITY',
        ],
      });
    } catch (err) {
      res.status(500).json({
        schema: 'rafaelia.frida.lifecycle.dashboard/v1',
        mode: 'READ_ONLY',
        claim_allowed: false,
        evidence_state: 'TOKEN_VAZIO_READ_ERROR',
        error: err.message,
      });
    }
  });

  router.get('/contract', (req, res) => {
    try {
      res.json(readJson(contractPath));
    } catch (err) {
      res.status(500).json({
        error: err.message,
        claim_allowed: false,
        state: 'TOKEN_VAZIO_CONTRACT_READ_ERROR',
      });
    }
  });

  router.get('/evidence', (req, res) => {
    try {
      if (!fs.existsSync(evidencePath)) {
        return res.status(404).json({
          state: 'TOKEN_VAZIO_LOCAL_RECEIPT_NOT_PRESENT',
          claim_allowed: false,
        });
      }
      res.json(readJson(evidencePath));
    } catch (err) {
      res.status(500).json({
        error: err.message,
        claim_allowed: false,
        state: 'TOKEN_VAZIO_EVIDENCE_READ_ERROR',
      });
    }
  });

  return router;
}

module.exports = createLifecycleRouter;

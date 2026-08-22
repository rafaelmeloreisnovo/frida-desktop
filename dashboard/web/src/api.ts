import axios from 'axios';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3000/api';

const client = axios.create({
  baseURL: API_BASE,
});

export const api = {
  // Metrics
  getLatestMetrics: () => client.get('/metrics/latest').then((r) => r.data),
  getMetricsTimeline: (runId: string, binSizeMs?: number) =>
    client.get(`/metrics/timeline/${runId}`, { params: { bin_size_ms: binSizeMs } }).then((r) => r.data),

  // Runs
  listRuns: () => client.get('/runs').then((r) => r.data),
  getRun: (runId: string) => client.get(`/runs/${runId}`).then((r) => r.data),
  createRun: (data: any) => client.post('/runs', data).then((r) => r.data),
  completeRun: (runId: string, data: any) => client.post(`/runs/${runId}/complete`, data).then((r) => r.data),

  // Ontology
  getOntology: () => client.get('/ontology').then((r) => r.data),
  getScenario: (scenarioId: string) => client.get(`/ontology/scenario/${scenarioId}`).then((r) => r.data),
  getComponent: (componentId: string) => client.get(`/ontology/component/${componentId}`).then((r) => r.data),

  // Snapshot (push from device)
  pushSnapshot: (data: any) => client.post('/snapshot', data).then((r) => r.data),

  // Health
  health: () => client.get('/health').then((r) => r.data),
};

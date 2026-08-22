import React, { useState, useEffect } from 'react';
import { api } from '../api';
import '../styles/TestRunsList.css';

interface Run {
  id: string;
  created_at: string;
  device_abi: string;
  device_sdk: number;
  status: string;
  summary?: any;
}

interface Props {
  onSelectRun: (runId: string) => void;
}

export default function TestRunsList({ onSelectRun }: Props) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadRuns();
    const interval = setInterval(loadRuns, 5000); // Refresh every 5s
    return () => clearInterval(interval);
  }, []);

  const loadRuns = async () => {
    try {
      const data = await api.listRuns();
      setRuns(data);
      setLoading(false);
    } catch (err) {
      console.error('Failed to load runs:', err);
      setLoading(false);
    }
  };

  const getStatusEmoji = (status: string) => {
    switch (status) {
      case 'PASS':
        return '✅';
      case 'FAIL':
        return '❌';
      case 'RUNNING':
        return '🔄';
      default:
        return '⏹️';
    }
  };

  if (loading) {
    return <div className="test-runs-list loading">Loading test runs...</div>;
  }

  return (
    <div className="test-runs-list">
      <h2>Test Execution History</h2>

      <table className="runs-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Device</th>
            <th>Status</th>
            <th>Accuracy</th>
            <th>Overhead</th>
            <th>Duration</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id} className={`status-${run.status.toLowerCase()}`}>
              <td>{new Date(run.created_at).toLocaleString()}</td>
              <td>{run.device_abi} (SDK {run.device_sdk})</td>
              <td>
                <span className="status-badge">
                  {getStatusEmoji(run.status)} {run.status}
                </span>
              </td>
              <td>
                {run.summary?.accuracy_percent ? `${run.summary.accuracy_percent.toFixed(1)}%` : '—'}
              </td>
              <td>
                {run.summary?.overhead_percent ? `${run.summary.overhead_percent.toFixed(1)}%` : '—'}
              </td>
              <td>
                {run.summary?.total_duration_ms
                  ? `${(run.summary.total_duration_ms / 1000).toFixed(1)}s`
                  : '—'}
              </td>
              <td>
                <button className="btn btn-small" onClick={() => onSelectRun(run.id)}>
                  View
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {runs.length === 0 && (
        <div className="no-data">
          <p>No test runs yet. Start a test to see results.</p>
        </div>
      )}
    </div>
  );
}

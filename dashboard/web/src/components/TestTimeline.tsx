import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { api } from '../api';
import '../styles/TestTimeline.css';

interface Props {
  runId: string;
}

interface TimelineData {
  timestamp: string;
  accuracy_percent: number;
  overhead_percent: number;
  memory_bytes: number;
  context_count: number;
}

export default function TestTimeline({ runId }: Props) {
  const [timeline, setTimeline] = useState<TimelineData[]>([]);
  const [run, setRun] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTimeline();
  }, [runId]);

  const loadTimeline = async () => {
    try {
      const [timelineData, runData] = await Promise.all([
        api.getMetricsTimeline(runId, 1000),
        api.getRun(runId),
      ]);
      setTimeline(timelineData);
      setRun(runData);
      setLoading(false);
    } catch (err) {
      console.error('Failed to load timeline:', err);
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="test-timeline loading">Loading timeline...</div>;
  }

  if (!run) {
    return <div className="test-timeline error">Failed to load run data</div>;
  }

  const avgAccuracy = timeline.length > 0
    ? timeline.reduce((sum, d) => sum + d.accuracy_percent, 0) / timeline.length
    : 0;

  return (
    <div className="test-timeline">
      <div className="timeline-header">
        <h2>Test Timeline</h2>
        <div className="timeline-info">
          <div className="info-item">
            <span className="label">Run ID:</span>
            <span className="value">{runId}</span>
          </div>
          <div className="info-item">
            <span className="label">Started:</span>
            <span className="value">{new Date(run.created_at).toLocaleString()}</span>
          </div>
          <div className="info-item">
            <span className="label">Device:</span>
            <span className="value">{run.device_abi} (SDK {run.device_sdk})</span>
          </div>
          <div className="info-item">
            <span className="label">Avg Accuracy:</span>
            <span className="value" style={{ color: avgAccuracy > 80 ? '#4caf50' : '#ff9800' }}>
              {avgAccuracy.toFixed(1)}%
            </span>
          </div>
        </div>
      </div>

      <div className="charts">
        <div className="chart-container full-width">
          <h3>Accuracy Progression</h3>
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={timeline}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="timestamp"
                tickFormatter={(val) => new Date(val).toLocaleTimeString()}
              />
              <YAxis domain={[0, 100]} />
              <Tooltip
                labelFormatter={(val) => new Date(val).toLocaleTimeString()}
                formatter={(val: number) => val.toFixed(2)}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="accuracy_percent"
                stroke="#4caf50"
                strokeWidth={2}
                dot={false}
                name="Accuracy (%)"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-container full-width">
          <h3>Resource Usage Over Time</h3>
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={timeline}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="timestamp"
                tickFormatter={(val) => new Date(val).toLocaleTimeString()}
              />
              <YAxis yAxisId="left" label={{ value: 'Overhead (%)', angle: -90, position: 'insideLeft' }} />
              <YAxis
                yAxisId="right"
                orientation="right"
                label={{ value: 'Memory (bytes)', angle: 90, position: 'insideRight' }}
              />
              <Tooltip
                labelFormatter={(val) => new Date(val).toLocaleTimeString()}
              />
              <Legend />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="overhead_percent"
                stroke="#ff9800"
                dot={false}
                name="Overhead (%)"
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="memory_bytes"
                stroke="#2196f3"
                dot={false}
                name="Memory (bytes)"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-container full-width">
          <h3>Context Count Evolution</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={timeline}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="timestamp"
                tickFormatter={(val) => new Date(val).toLocaleTimeString()}
              />
              <YAxis />
              <Tooltip
                labelFormatter={(val) => new Date(val).toLocaleTimeString()}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="context_count"
                stroke="#9c27b0"
                dot={false}
                name="Active Contexts"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

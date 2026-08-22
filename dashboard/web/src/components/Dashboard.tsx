import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Gauge, PieChart, Pie, Cell } from 'recharts';
import { api } from '../api';
import '../styles/Dashboard.css';

interface Metrics {
  accuracy_percent: number;
  overhead_percent: number;
  memory_bytes: number;
  context_count: number;
  timestamp: string;
}

export default function Dashboard() {
  const [metrics, setMetrics] = useState<Metrics>({
    accuracy_percent: 0,
    overhead_percent: 0,
    memory_bytes: 0,
    context_count: 0,
    timestamp: new Date().toISOString(),
  });
  const [history, setHistory] = useState<Metrics[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [ws, setWs] = useState<WebSocket | null>(null);

  useEffect(() => {
    // Fetch latest metrics
    fetchLatestMetrics();

    // Setup WebSocket for real-time updates
    connectWebSocket();

    return () => {
      if (ws) {
        ws.close();
      }
    };
  }, []);

  const fetchLatestMetrics = async () => {
    try {
      const data = await api.getLatestMetrics();
      setMetrics(data);
      setHistory((prev) => [...prev.slice(-59), data]); // Keep last 60
    } catch (err) {
      console.error('Failed to fetch metrics:', err);
    }
  };

  const connectWebSocket = () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    const websocket = new WebSocket(wsUrl);

    websocket.onopen = () => {
      console.log('WebSocket connected');
      setIsConnected(true);
    };

    websocket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'snapshot') {
          setMetrics(message.data);
          setHistory((prev) => [...prev.slice(-59), message.data]);
        }
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    };

    websocket.onerror = (err) => {
      console.error('WebSocket error:', err);
      setIsConnected(false);
    };

    websocket.onclose = () => {
      console.log('WebSocket closed');
      setIsConnected(false);
      // Attempt reconnect after 3s
      setTimeout(connectWebSocket, 3000);
    };

    setWs(websocket);
  };

  const memoryKB = Math.round(metrics.memory_bytes / 1024);
  const statusColor = metrics.accuracy_percent > 80 ? '#4caf50' : metrics.accuracy_percent > 60 ? '#ff9800' : '#f44336';

  return (
    <div className="dashboard">
      <div className="status-bar">
        <div className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}>
          {isConnected ? '🟢 Live' : '🔴 Offline'}
        </div>
        <span className="last-update">Last update: {new Date(metrics.timestamp).toLocaleTimeString()}</span>
      </div>

      <div className="metrics-grid">
        <div className="metric-card accuracy">
          <div className="metric-label">Accuracy</div>
          <div className="metric-value" style={{ color: statusColor }}>
            {metrics.accuracy_percent.toFixed(1)}%
          </div>
          <div className="metric-bar">
            <div
              className="metric-fill"
              style={{
                width: `${metrics.accuracy_percent}%`,
                backgroundColor: statusColor,
              }}
            />
          </div>
        </div>

        <div className="metric-card overhead">
          <div className="metric-label">Overhead</div>
          <div className="metric-value">{metrics.overhead_percent.toFixed(1)}%</div>
          <div className="metric-bar">
            <div
              className="metric-fill"
              style={{
                width: `${Math.min(metrics.overhead_percent, 100)}%`,
                backgroundColor: metrics.overhead_percent < 10 ? '#4caf50' : '#ff9800',
              }}
            />
          </div>
        </div>

        <div className="metric-card memory">
          <div className="metric-label">Memory</div>
          <div className="metric-value">{memoryKB} KB</div>
          <div className="metric-subtext">of 64 KB max</div>
        </div>

        <div className="metric-card contexts">
          <div className="metric-label">Contexts</div>
          <div className="metric-value">{metrics.context_count}</div>
          <div className="metric-subtext">active contexts</div>
        </div>
      </div>

      <div className="charts-grid">
        <div className="chart-container">
          <h3>Accuracy Timeline</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={history}>
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
                dot={false}
                isAnimationActive={false}
                name="Accuracy (%)"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-container">
          <h3>Resource Usage</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={history}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="timestamp"
                tickFormatter={(val) => new Date(val).toLocaleTimeString()}
              />
              <YAxis yAxisId="left" />
              <YAxis yAxisId="right" orientation="right" />
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
      </div>

      <div className="actions">
        <button onClick={fetchLatestMetrics} className="btn btn-primary">
          🔄 Refresh
        </button>
        <button className="btn btn-secondary">📥 Download CSV</button>
        <button className="btn btn-secondary">📊 Export Report</button>
      </div>
    </div>
  );
}

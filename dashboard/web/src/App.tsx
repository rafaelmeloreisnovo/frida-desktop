import React, { useState, useEffect } from 'react';
import Dashboard from './components/Dashboard';
import TestTimeline from './components/TestTimeline';
import TestRunsList from './components/TestRunsList';
import ArchitectureNavigator from './components/ArchitectureNavigator';
import './App.css';

type View = 'dashboard' | 'timeline' | 'runs' | 'architecture';

function App() {
  const [currentView, setCurrentView] = useState<View>('dashboard');
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  return (
    <div className="app">
      <header className="app-header">
        <h1>RFL Learning Dashboard</h1>
        <nav className="nav">
          <button
            className={`nav-button ${currentView === 'dashboard' ? 'active' : ''}`}
            onClick={() => setCurrentView('dashboard')}
          >
            📊 Live Dashboard
          </button>
          <button
            className={`nav-button ${currentView === 'timeline' ? 'active' : ''}`}
            onClick={() => setCurrentView('timeline')}
            disabled={!selectedRunId}
          >
            📈 Timeline
          </button>
          <button
            className={`nav-button ${currentView === 'runs' ? 'active' : ''}`}
            onClick={() => setCurrentView('runs')}
          >
            🧪 Test Runs
          </button>
          <button
            className={`nav-button ${currentView === 'architecture' ? 'active' : ''}`}
            onClick={() => setCurrentView('architecture')}
          >
            🏗️ Architecture
          </button>
        </nav>
      </header>

      <main className="app-main">
        {currentView === 'dashboard' && <Dashboard />}
        {currentView === 'timeline' && selectedRunId && (
          <TestTimeline runId={selectedRunId} />
        )}
        {currentView === 'runs' && (
          <TestRunsList
            onSelectRun={(runId) => {
              setSelectedRunId(runId);
              setCurrentView('timeline');
            }}
          />
        )}
        {currentView === 'architecture' && <ArchitectureNavigator />}
      </main>

      <footer className="app-footer">
        <p>RFL Learning Dashboard v1.0.0 | Frida Desktop</p>
        <p>
          Last update: {new Date().toLocaleTimeString()}
        </p>
      </footer>
    </div>
  );
}

export default App;

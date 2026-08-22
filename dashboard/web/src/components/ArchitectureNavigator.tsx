import React, { useState, useEffect } from 'react';
import { api } from '../api';
import '../styles/ArchitectureNavigator.css';

interface Component {
  id: string;
  name: string;
  type: string;
  description: string;
  affected_by_tests?: any[];
}

export default function ArchitectureNavigator() {
  const [ontology, setOntology] = useState<any>(null);
  const [components, setComponents] = useState<Component[]>([]);
  const [selectedComponent, setSelectedComponent] = useState<Component | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadOntology();
  }, []);

  const loadOntology = async () => {
    try {
      const data = await api.getOntology();
      setOntology(data);
      setComponents(data.components || []);
      setLoading(false);
    } catch (err) {
      console.error('Failed to load ontology:', err);
      setLoading(false);
    }
  };

  const handleComponentClick = async (component: Component) => {
    try {
      const details = await api.getComponent(component.id);
      setSelectedComponent(details);
    } catch (err) {
      console.error('Failed to load component:', err);
    }
  };

  const getTypeColor = (type: string) => {
    const colors: { [key: string]: string } = {
      core_learning: '#4caf50',
      cache: '#2196f3',
      memory: '#ff9800',
      analysis: '#9c27b0',
      decision: '#f44336',
      resilience: '#00bcd4',
      memory_management: '#ffc107',
    };
    return colors[type] || '#757575';
  };

  if (loading) {
    return <div className="architecture-navigator loading">Loading architecture...</div>;
  }

  return (
    <div className="architecture-navigator">
      <div className="navigator-container">
        <div className="component-list">
          <h2>RFL Components</h2>
          <div className="components">
            {components.map((comp) => (
              <div
                key={comp.id}
                className={`component-card ${selectedComponent?.id === comp.id ? 'selected' : ''}`}
                style={{ borderLeftColor: getTypeColor(comp.type) }}
                onClick={() => handleComponentClick(comp)}
              >
                <div className="component-name">{comp.name}</div>
                <div className="component-type" style={{ color: getTypeColor(comp.type) }}>
                  {comp.type.replace(/_/g, ' ')}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="component-detail">
          {selectedComponent ? (
            <>
              <h2>{selectedComponent.name}</h2>
              <div className="detail-section">
                <div className="detail-row">
                  <span className="label">Type:</span>
                  <span className="value">{selectedComponent.type.replace(/_/g, ' ')}</span>
                </div>
                <div className="detail-row">
                  <span className="label">File:</span>
                  <span className="value monospace">{selectedComponent.file_path}</span>
                </div>
              </div>

              <div className="detail-section">
                <h3>Description</h3>
                <p>{selectedComponent.description}</p>
              </div>

              {selectedComponent.interfaces && selectedComponent.interfaces.length > 0 && (
                <div className="detail-section">
                  <h3>Public Interfaces</h3>
                  <ul className="interfaces">
                    {selectedComponent.interfaces.map((iface: string, idx: number) => (
                      <li key={idx} className="monospace">{iface}</li>
                    ))}
                  </ul>
                </div>
              )}

              {selectedComponent.affected_by_tests && selectedComponent.affected_by_tests.length > 0 && (
                <div className="detail-section">
                  <h3>Affected By Tests</h3>
                  <ul className="test-list">
                    {selectedComponent.affected_by_tests.map((test: any) => (
                      <li key={test.id}>
                        <span className="test-name">{test.name}</span>
                        <span className="test-id">({test.id})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {selectedComponent.depends_on && selectedComponent.depends_on.length > 0 && (
                <div className="detail-section">
                  <h3>Dependencies</h3>
                  <ul className="dependency-list">
                    {selectedComponent.depends_on.map((dep: string) => (
                      <li key={dep} className="dependency">{dep}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <div className="no-selection">
              <p>Select a component to view details</p>
            </div>
          )}
        </div>
      </div>

      <div className="legend">
        <h3>Component Types</h3>
        <div className="legend-items">
          {['core_learning', 'cache', 'memory', 'analysis', 'decision', 'resilience', 'memory_management'].map(
            (type) => (
              <div key={type} className="legend-item">
                <div className="legend-color" style={{ backgroundColor: getTypeColor(type) }} />
                <span>{type.replace(/_/g, ' ')}</span>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import './LifecycleNavigator.css';

type Lane = {
  order: number;
  branch: string;
  channel: string;
  role: string;
  purpose: string;
  promotes_to: string | null;
  provider_protection_state: string;
};

type LifecycleContract = {
  schema: string;
  lifecycle_id: string;
  baseline: {
    repository: string;
    main_commit: string;
    state: string;
  };
  claim_allowed: boolean;
  automatic_merge: boolean;
  automatic_stable_release: boolean;
  principles: string[];
  lanes: Lane[];
  promotion: {
    topology: string;
    failure_rule: string;
  };
  runtime_boundaries: Record<string, string>;
};

type LifecycleEvidence = {
  status?: string;
  mode?: string;
  lane?: string;
  context?: {
    sha?: string;
    run_id?: string;
    run_attempt?: string;
    event_name?: string;
  };
  promotion?: {
    state?: string;
    reason?: string;
  };
};

type LifecycleDashboardPayload = {
  schema: string;
  mode: string;
  claim_allowed: boolean;
  contract: LifecycleContract;
  evidence_state: string;
  evidence: LifecycleEvidence | null;
  boundaries: string[];
};

function display(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return 'TOKEN_VAZIO';
  }
  return String(value);
}

function LifecycleNavigator() {
  const [data, setData] = useState<LifecycleDashboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.getLifecycle()
      .then((payload) => {
        if (active) {
          setData(payload);
          setError(null);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err?.message || 'Lifecycle read failed');
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const currentLane = useMemo(() => data?.evidence?.lane || 'TOKEN_VAZIO', [data]);

  if (loading) {
    return <section className="lifecycle-shell"><p>Loading lifecycle evidence…</p></section>;
  }

  if (error || !data) {
    return (
      <section className="lifecycle-shell">
        <h2>Lifecycle Control Plane</h2>
        <div className="lifecycle-alert">
          <strong>Evidence unavailable</strong>
          <p>{error || 'TOKEN_VAZIO'}</p>
          <code>TOKEN_VAZIO != PASS</code>
        </div>
      </section>
    );
  }

  return (
    <section className="lifecycle-shell">
      <div className="lifecycle-heading">
        <div>
          <p className="eyebrow">READ-ONLY GOVERNANCE VIEW</p>
          <h2>Frida Lifecycle Control Plane</h2>
          <p className="lifecycle-subtitle">{data.contract.promotion.topology}</p>
        </div>
        <div className="lifecycle-state">
          <span>Evidence</span>
          <strong>{data.evidence_state}</strong>
          <small>claim_allowed={String(data.claim_allowed)}</small>
        </div>
      </div>

      <div className="lifecycle-summary-grid">
        <article>
          <span>Current lane</span>
          <strong>{currentLane}</strong>
        </article>
        <article>
          <span>Observed status</span>
          <strong>{display(data.evidence?.status)}</strong>
        </article>
        <article>
          <span>Exact SHA</span>
          <code>{display(data.evidence?.context?.sha)}</code>
        </article>
        <article>
          <span>Run identity</span>
          <code>{display(data.evidence?.context?.run_id)} / {display(data.evidence?.context?.run_attempt)}</code>
        </article>
      </div>

      <div className="lifecycle-lanes" aria-label="Lifecycle lanes">
        {data.contract.lanes.map((lane) => {
          const activeLane = lane.branch === currentLane;
          return (
            <article className={`lifecycle-lane ${activeLane ? 'active' : ''}`} key={lane.branch}>
              <div className="lane-order">{String(lane.order).padStart(2, '0')}</div>
              <div className="lane-channel">{lane.channel}</div>
              <h3>{lane.branch}</h3>
              <p>{lane.purpose}</p>
              <dl>
                <div>
                  <dt>Role</dt>
                  <dd>{lane.role}</dd>
                </div>
                <div>
                  <dt>Next</dt>
                  <dd>{display(lane.promotes_to)}</dd>
                </div>
                <div>
                  <dt>Protection</dt>
                  <dd><code>{lane.provider_protection_state}</code></dd>
                </div>
              </dl>
            </article>
          );
        })}
      </div>

      <div className="lifecycle-columns">
        <article className="lifecycle-panel">
          <h3>Promotion evidence</h3>
          <p><strong>{display(data.evidence?.promotion?.state)}</strong></p>
          <p>{display(data.evidence?.promotion?.reason)}</p>
          <code>{data.contract.promotion.failure_rule}</code>
        </article>

        <article className="lifecycle-panel">
          <h3>Runtime boundaries</h3>
          <ul>
            {Object.entries(data.contract.runtime_boundaries).map(([key, value]) => (
              <li key={key}>
                <span>{key}</span>
                <code>{value}</code>
              </li>
            ))}
          </ul>
        </article>
      </div>

      <article className="lifecycle-panel lifecycle-boundaries">
        <h3>Claim boundaries</h3>
        <div>
          {data.boundaries.map((boundary) => <code key={boundary}>{boundary}</code>)}
        </div>
      </article>
    </section>
  );
}

export default LifecycleNavigator;

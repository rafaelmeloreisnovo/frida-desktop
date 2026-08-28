import * as fs from 'fs';
import * as path from 'path';

export interface ComponentDoc {
  name: string;
  description: string;
  responsibilities: string[];
  inputs: string[];
  outputs: string[];
  dependencies: string[];
  evidence_boundary?: string;
}

export interface FlowStep {
  name: string;
  description: string;
  actor: string;
  actions: string[];
}

/** Serializable atlas document. Kept distinct from the generator class so
 * TypeScript declaration merging cannot accidentally require private class
 * state on a plain data object. */
export interface ArchitectureAtlasDocument {
  version: string;
  generated: string;
  title: string;
  overview: string;
  components: ComponentDoc[];
  flows: { name: string; steps: FlowStep[] }[];
  slas: Record<string, { target: string; metric: string }>;
  data_flows: { from: string; to: string; data_type: string }[];
  epistemic_boundary: {
    physical_device_smoke: 'TOKEN_VAZIO';
    claim_allowed: false;
  };
}

export class ArchitectureAtlas {
  private atlasPath: string;

  constructor(private storagePath: string = '/data/local/tmp/frida-learning') {
    this.atlasPath = path.join(storagePath, 'atlas.md');
    this.ensureDirectory();
  }

  private ensureDirectory(): void {
    if (!fs.existsSync(this.storagePath)) {
      fs.mkdirSync(this.storagePath, { recursive: true });
    }
  }

  generateAtlas(): ArchitectureAtlasDocument {
    return {
      version: '2.0.0',
      generated: new Date().toISOString(),
      title: 'Runtime Learning Engine Architecture',
      overview:
        'Evidence-aware Frida runtime learning system: capture, pattern detection, safety gate, reversible fix, validation, rollback, metrics and alerts.',
      components: this.getComponentDocs(),
      flows: this.getFlows(),
      slas: this.getSLAs(),
      data_flows: this.getDataFlows(),
      epistemic_boundary: {
        physical_device_smoke: 'TOKEN_VAZIO',
        claim_allowed: false
      }
    };
  }

  private getComponentDocs(): ComponentDoc[] {
    return [
      {
        name: 'BugCapture',
        description: 'Captures supported Java/runtime events through Frida hooks.',
        responsibilities: ['Install hooks', 'Emit BugEvent through callback', 'Stop hooks on shutdown'],
        inputs: ['Frida Java/runtime events'],
        outputs: ['BugEvent'],
        dependencies: ['Frida Java API'],
        evidence_boundary: 'Physical hook behavior requires Android/Frida runtime receipt.'
      },
      {
        name: 'BugStore',
        description: 'Bounded persistent event history with integrity metadata and corruption quarantine.',
        responsibilities: ['Append events', 'Bound history', 'Verify integrity', 'Quarantine corrupt history'],
        inputs: ['BugEvent'],
        outputs: ['bug-history.json', 'corruption quarantine metadata'],
        dependencies: ['filesystem', 'FNV-1a integrity helper']
      },
      {
        name: 'PatternDetector',
        description: 'Derives recurring bug patterns and confidence from observed history.',
        responsibilities: ['Detect patterns', 'Update confidence', 'Gate fix eligibility'],
        inputs: ['BugEvent[]'],
        outputs: ['BugPattern[]'],
        dependencies: ['BugStore data']
      },
      {
        name: 'RuntimeSafetyMesh',
        description: 'Pre-mutation evidence and resource gate.',
        responsibilities: [
          'Observe process memory',
          'Observe filesystem free space when statfs is available',
          'Inspect critical JSON files read-only',
          'Evaluate canonical alert rules'
        ],
        inputs: ['process/filesystem/runtime state'],
        outputs: ['RuntimeSafetySnapshot', 'AlertCondition[]'],
        dependencies: ['MemoryPressureHandler', 'DiskExhaustionHandler', 'CorruptionRecoveryHandler', 'AlertRulesEngine'],
        evidence_boundary: 'Unknown observations remain TOKEN_VAZIO; no simulated lock is promoted to live safety evidence.'
      },
      {
        name: 'AutoFixer',
        description: 'Applies Frida hook fixes and records their rollback capability by fix_id.',
        responsibilities: [
          'Apply try-catch hook wrapper',
          'Apply method hook patch',
          'Capture prior hook implementation',
          'Restore reversible hooks by fix_id',
          'Mark process/component restart as non-reversible'
        ],
        inputs: ['BugPattern'],
        outputs: ['FixEvent'],
        dependencies: ['Frida Java API'],
        evidence_boundary: 'Hook restoration is distinct from raw-memory journal rollback.'
      },
      {
        name: 'RollbackEngine',
        description: 'Fail-closed raw-memory journal rollback for addressable mutations.',
        responsibilities: ['Journal bytes before mutation', 'Bind journal to fix_id', 'Restore bytes', 'Verify checksum'],
        inputs: ['address', 'size', 'fix_id'],
        outputs: ['RollbackJournal', 'verified boolean'],
        dependencies: ['Frida Memory API'],
        evidence_boundary: 'Missing Memory API returns false/TOKEN_VAZIO, never PASS.'
      },
      {
        name: 'WatchdogMonitor',
        description: 'Configured heartbeat/epoch monitor with FAILSAFE rollback callback.',
        responsibilities: ['Heartbeat', 'Persist events', 'Detect timeout', 'Request pending rollback'],
        inputs: ['engine timing config'],
        outputs: ['WatchdogEvent'],
        dependencies: ['filesystem', 'timers']
      },
      {
        name: 'MetricsCollector',
        description: 'Lifecycle metrics and valid Prometheus histogram export.',
        responsibilities: ['Record latency samples', 'Track fix/rollback success', 'Track SLA violations', 'Export JSON/Prometheus'],
        inputs: ['lifecycle observations'],
        outputs: ['metrics.json', 'prometheus-metrics.txt'],
        dependencies: ['filesystem']
      },
      {
        name: 'HealthCheckEndpoint',
        description: 'Engine-bound health and SLA snapshot.',
        responsibilities: ['Read engine stats', 'Compute health state', 'Persist health/metric snapshots'],
        inputs: ['engine stats', 'latencies', 'audit log'],
        outputs: ['HealthCheckResponse', 'MetricsSnapshot'],
        dependencies: ['RuntimeLearningEngine']
      },
      {
        name: 'AlertManager + AlertRulesEngine',
        description: 'Persistent alert queue plus canonical SLA threshold evaluation.',
        responsibilities: ['Evaluate runtime metrics', 'Debounce alerts', 'Persist alerts', 'Export Prometheus alert rules'],
        inputs: ['health and metric snapshots'],
        outputs: ['Alert[]', 'AlertCondition[]'],
        dependencies: ['filesystem']
      },
      {
        name: 'ConcurrentBugCaptureHandler',
        description: 'Concurrency stress-test harness.',
        responsibilities: ['Exercise parallel capture scenarios', 'Report race/deadlock counters'],
        inputs: ['synthetic test concurrency levels'],
        outputs: ['ConcurrentCaptureStats'],
        dependencies: [],
        evidence_boundary: 'TEST_HARNESS_ONLY: current lock/delay path is simulated and is not live hot-path synchronization.'
      }
    ];
  }

  private getFlows(): { name: string; steps: FlowStep[] }[] {
    return [
      {
        name: 'Capture → Evidence Gate → Fix → Validate → Rollback/Commit',
        steps: [
          {
            name: 'Capture and persist',
            description: 'Observed bug becomes a bounded persistent event.',
            actor: 'BugCapture + BugStore',
            actions: ['Emit BugEvent', 'Append history', 'Record capture latency']
          },
          {
            name: 'Detect pattern',
            description: 'History is evaluated for a fix-eligible pattern.',
            actor: 'PatternDetector',
            actions: ['Detect pattern', 'Compute confidence', 'Check fix eligibility']
          },
          {
            name: 'Safety gate',
            description: 'Mutation is blocked on critical resource/corruption evidence.',
            actor: 'RuntimeSafetyMesh',
            actions: ['Observe memory', 'Observe disk if available', 'Inspect corruption', 'Allow or block mutation']
          },
          {
            name: 'Apply reversible mutation',
            description: 'Hook mutation is bound to the returned FixEvent.fix_id.',
            actor: 'AutoFixer',
            actions: ['Capture prior implementation', 'Apply hook', 'Record rollback capability']
          },
          {
            name: 'Validate and decide',
            description: 'Post-fix tests decide whether mutation remains active.',
            actor: 'TestSuite + RuntimeLearningEngine',
            actions: ['Run tests', 'Keep verified fix or immediately rollback', 'Enter FAILSAFE if rollback is unverified']
          }
        ]
      },
      {
        name: 'Observation → Health → Alerts',
        steps: [
          {
            name: 'Record lifecycle metrics',
            description: 'Capture/pattern/fix/rollback observations become metrics.',
            actor: 'MetricsCollector',
            actions: ['Record histograms', 'Track success rates', 'Track SLA violation counters']
          },
          {
            name: 'Compute health',
            description: 'Engine-bound health is derived from observed state.',
            actor: 'HealthCheckEndpoint',
            actions: ['Read engine stats', 'Evaluate thresholds', 'Persist snapshot']
          },
          {
            name: 'Evaluate alerts',
            description: 'Normalized metrics flow to persistent and canonical alert engines.',
            actor: 'AlertManager + AlertRulesEngine',
            actions: ['Evaluate rules', 'Persist active alerts', 'Expose canonical Prometheus rules']
          }
        ]
      }
    ];
  }

  private getSLAs(): Record<string, { target: string; metric: string }> {
    return {
      'bug-capture-latency': { target: '<= 100ms critical boundary', metric: 'frida_bug_capture_latency_ms' },
      'pattern-detection-latency': { target: '<= 500ms critical boundary', metric: 'frida_pattern_detection_latency_ms' },
      'fix-application-latency': { target: '<= 1000ms critical boundary', metric: 'frida_fix_application_latency_ms' },
      'rollback-completion': { target: '<= 500ms critical boundary', metric: 'frida_rollback_latency_ms' },
      'fix-success-rate': { target: '>= 80%', metric: 'frida_success_rate' },
      'memory': { target: '<= 300MB critical boundary', metric: 'frida_memory_usage_mb' },
      'disk-free': { target: '>= 50MB critical boundary when observable', metric: 'frida_disk_free_mb' },
      'rollback-verification': { target: 'true or FAILSAFE/TOKEN_VAZIO', metric: 'FixEvent.rollback_verified' }
    };
  }

  private getDataFlows(): { from: string; to: string; data_type: string }[] {
    return [
      { from: 'BugCapture', to: 'BugStore', data_type: 'BugEvent' },
      { from: 'BugStore', to: 'PatternDetector', data_type: 'BugEvent[]' },
      { from: 'PatternDetector', to: 'RuntimeSafetyMesh', data_type: 'BugPattern + runtime observations' },
      { from: 'RuntimeSafetyMesh', to: 'AutoFixer', data_type: 'mutation gate' },
      { from: 'AutoFixer', to: 'TestSuite', data_type: 'FixEvent' },
      { from: 'TestSuite', to: 'AutoFixer.rollbackFix', data_type: 'post-fix failure' },
      { from: 'RuntimeLearningEngine', to: 'RollbackEngine', data_type: 'fix_id-bound memory journal fallback' },
      { from: 'RuntimeLearningEngine', to: 'MetricsCollector', data_type: 'lifecycle observations' },
      { from: 'MetricsCollector', to: 'HealthCheckEndpoint', data_type: 'metrics' },
      { from: 'HealthCheckEndpoint', to: 'AlertManager', data_type: 'normalized health metrics' },
      { from: 'RuntimeSafetyMesh', to: 'AlertRulesEngine', data_type: 'canonical SLA metrics' }
    ];
  }

  async generateMarkdownAtlas(): Promise<string> {
    const atlas = this.generateAtlas();
    const lines: string[] = [
      `# ${atlas.title}`,
      '',
      `**Generated**: ${atlas.generated}`,
      `**Version**: ${atlas.version}`,
      '',
      atlas.overview,
      '',
      '## Components',
      ''
    ];

    for (const component of atlas.components) {
      lines.push(`### ${component.name}`, '', component.description, '');
      lines.push(`- Responsibilities: ${component.responsibilities.join('; ')}`);
      lines.push(`- Inputs: ${component.inputs.join(', ') || 'none'}`);
      lines.push(`- Outputs: ${component.outputs.join(', ') || 'none'}`);
      lines.push(`- Dependencies: ${component.dependencies.join(', ') || 'none'}`);
      if (component.evidence_boundary) lines.push(`- Evidence boundary: ${component.evidence_boundary}`);
      lines.push('');
    }

    lines.push('## Workflows', '');
    for (const flow of atlas.flows) {
      lines.push(`### ${flow.name}`, '');
      flow.steps.forEach((step, index) => {
        lines.push(`${index + 1}. **${step.name}** — ${step.actor}: ${step.description}`);
        step.actions.forEach(action => lines.push(`   - ${action}`));
      });
      lines.push('');
    }

    lines.push('## SLAs', '');
    for (const [name, sla] of Object.entries(atlas.slas)) {
      lines.push(`- **${name}**: ${sla.target} — \`${sla.metric}\``);
    }

    lines.push('', '## Data Flows', '', '```');
    for (const flow of atlas.data_flows) {
      lines.push(`${flow.from} --[${flow.data_type}]--> ${flow.to}`);
    }
    lines.push('```', '', '## Evidence Boundary', '');
    lines.push(`- physical_device_smoke: ${atlas.epistemic_boundary.physical_device_smoke}`);
    lines.push(`- claim_allowed: ${atlas.epistemic_boundary.claim_allowed}`);
    lines.push('');

    return lines.join('\n');
  }

  async saveAtlas(): Promise<void> {
    try {
      const markdown = await this.generateMarkdownAtlas();
      fs.writeFileSync(this.atlasPath, markdown, 'utf-8');
      console.log(`[ArchitectureAtlas] Generated and saved to ${this.atlasPath}`);
    } catch (e) {
      console.error('[ArchitectureAtlas] Failed to save atlas:', e);
    }
  }
}

export function createArchitectureAtlas(storagePath?: string): ArchitectureAtlas {
  return new ArchitectureAtlas(storagePath);
}

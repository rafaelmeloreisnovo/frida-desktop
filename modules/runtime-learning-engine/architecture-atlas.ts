import * as fs from 'fs';
import * as path from 'path';

export interface ComponentDoc {
  name: string;
  description: string;
  responsibilities: string[];
  inputs: string[];
  outputs: string[];
  dependencies: string[];
}

export interface FlowStep {
  name: string;
  description: string;
  actor: string;
  actions: string[];
}

export interface ArchitectureAtlas {
  version: string;
  generated: string;
  title: string;
  overview: string;
  components: ComponentDoc[];
  flows: { name: string; steps: FlowStep[] }[];
  slas: Record<string, { target: string; metric: string }>;
  data_flows: { from: string; to: string; data_type: string }[];
}

export class ArchitectureAtlas {
  private storagePath: string;
  private atlasPath: string;

  constructor(storagePath: string = '/data/local/tmp/frida-learning') {
    this.storagePath = storagePath;
    this.atlasPath = path.join(storagePath, 'atlas.md');
    this.ensureDirectory();
  }

  private ensureDirectory(): void {
    if (!fs.existsSync(this.storagePath)) {
      fs.mkdirSync(this.storagePath, { recursive: true });
    }
  }

  generateAtlas(): ArchitectureAtlas {
    const atlas: ArchitectureAtlas = {
      version: '1.0.0',
      generated: new Date().toISOString(),
      title: 'Runtime Learning Engine Architecture',
      overview: `The Runtime Learning Engine is a Frida-based system that automatically captures Android runtime bugs, learns patterns, applies fixes, and evolves over time without regression.`,
      components: this.getComponentDocs(),
      flows: this.getFlows(),
      slas: this.getSLAs(),
      data_flows: this.getDataFlows()
    };

    return atlas;
  }

  private getComponentDocs(): ComponentDoc[] {
    return [
      {
        name: 'BugCapture',
        description: 'Intercepts Java exceptions and runtime events using Frida hooks',
        responsibilities: [
          'Hook java.lang.Throwable.printStackTrace() for crashes',
          'Hook android.os.Handler.post() for ANR detection',
          'Hook java.lang.Runtime.gc() for memory pressure',
          'Hook java.util.concurrent.locks.LockSupport.park() for deadlocks'
        ],
        inputs: ['Java method calls'],
        outputs: ['BugEvent objects with stack traces and timestamps'],
        dependencies: ['Frida API', 'utils.generateEventId()']
      },
      {
        name: 'BugStore',
        description: 'Circular buffer storage of captured bugs in JSON format on device',
        responsibilities: [
          'Append events to circular buffer (capacity: 512)',
          'Maintain FNV-1a 64 integrity checksum',
          'Load history from persistent storage',
          'Rotate old events when capacity exceeded'
        ],
        inputs: ['BugEvent objects'],
        outputs: ['Serialized JSON to /data/local/tmp/frida-learning/bug-history.json'],
        dependencies: ['fs module', 'utils.generateHash()']
      },
      {
        name: 'PatternDetector',
        description: 'Analyzes bug history to identify recurring patterns',
        responsibilities: [
          'Calculate bug frequency per class/method/exception',
          'Compute confidence score (0.0-1.0) based on occurrences',
          'Select fix strategy based on bug type and frequency',
          'Filter patterns by confidence threshold (default 0.75)'
        ],
        inputs: ['BugEvent array from BugStore'],
        outputs: ['BugPattern objects with confidence and suggested strategy'],
        dependencies: ['bug-store.ts', 'utils']
      },
      {
        name: 'AutoFixer',
        description: 'Applies automatic fixes using three strategies',
        responsibilities: [
          'Try-catch with fallback: wraps buggy methods in try-catch',
          'Monkey-patch from journal: modifies method bytecode',
          'Component restart: restarts failed Activity/Service',
          'Generate type-aware fallback values'
        ],
        inputs: ['BugPattern with fix strategy'],
        outputs: ['FixEvent with applied status'],
        dependencies: ['Frida API', 'Java.use()']
      },
      {
        name: 'RollbackEngine',
        description: 'Manages safe rollback of applied fixes',
        responsibilities: [
          'Journal method state before patching',
          'Verify integrity using checksums',
          'Atomically commit or revert changes',
          'Track rollback history for audit'
        ],
        inputs: ['Fix ID, original method bytes'],
        outputs: ['RollbackJournal with verification status'],
        dependencies: ['fs module', 'utils.generateHash()']
      },
      {
        name: 'WatchdogMonitor',
        description: 'Continuous health monitoring with epoch-based timeout detection',
        responsibilities: [
          'Send heartbeats every 1000ms',
          'Detect epoch timeout if heartbeat missing for 5000ms',
          'Transition state: STABLE → OBSERVE → FAILSAFE',
          'Trigger rollback callback on timeout'
        ],
        inputs: ['Monitored application state'],
        outputs: ['WatchdogEvent, rollback trigger'],
        dependencies: ['setInterval, fs module']
      },
      {
        name: 'TestSuite',
        description: 'Post-fix validation with smoke, regression, and performance tests',
        responsibilities: [
          'Run smoke test: verify basic functionality',
          'Run regression test: check memory, threads, null handling',
          'Run performance test: verify no latency degradation',
          'Fail if any test returns FAIL status'
        ],
        inputs: ['FixEvent to validate'],
        outputs: ['TestResult[] with PASS/FAIL/SKIPPED'],
        dependencies: ['Frida API', 'Java.use()']
      },
      {
        name: 'AuditLogger',
        description: 'Structured audit trail of all critical operations',
        responsibilities: [
          'Log every action: BUG_CAPTURED, FIX_APPLIED, ROLLBACK_INITIATED',
          'Rotate log when exceeds 5MB',
          'Record success/failure and error context',
          'Calculate audit statistics: success rate by action'
        ],
        inputs: ['AuditAction, resource_id, context, result'],
        outputs: ['NDJSON to /data/local/tmp/frida-learning/audit.log'],
        dependencies: ['fs module']
      },
      {
        name: 'ProvenanceTracker',
        description: 'Node-edge graph tracking origin and lineage of bugs and fixes',
        responsibilities: [
          'Record BUG nodes from captured events',
          'Record PATTERN nodes detected from bugs',
          'Record FIX nodes applied to patterns',
          'Record TEST and ROLLBACK nodes in chain',
          'Enable full chain reconstruction: BUG→PATTERN→FIX→TEST→ROLLBACK'
        ],
        inputs: ['Bug IDs, Pattern IDs, Fix IDs, Test results'],
        outputs: ['Graph JSON to /data/local/tmp/frida-learning/provenance.json'],
        dependencies: ['fs module']
      },
      {
        name: 'IntegrityVerifier',
        description: 'Continuous validation of data file integrity',
        responsibilities: [
          'Compute FNV-1a 64 checksums for 6 data files',
          'Detect corruption: format validation + checksum mismatch',
          'Alert on unexpected changes (was valid, now invalid)',
          'Maintain integrity report history (100 most recent)'
        ],
        inputs: ['File paths to monitor'],
        outputs: ['IntegrityReport JSON to /data/local/tmp/frida-learning/integrity-checks.json'],
        dependencies: ['fs module', 'utils.generateHash()']
      },
      {
        name: 'AutoOptimizer',
        description: 'Automatic tuning of engine parameters based on feedback',
        responsibilities: [
          'Adjust confidence_threshold: ±0.05 based on success rate',
          'Adjust min_occurrences: ±1 based on detection speed needed',
          'Identify best-performing fix strategy per pattern',
          'Run every 5 minutes to respond to metrics'
        ],
        inputs: ['Engine metrics from FeedbackCollector'],
        outputs: ['OptimizationLog, updated OptimizationConfig'],
        dependencies: ['feedback-collector.ts', 'fs module']
      },
      {
        name: 'RolloutManager',
        description: 'Staged canary deployment of new versions',
        responsibilities: [
          'Stage 1 (Canary): 5% traffic for 5 minutes',
          'Stage 2 (Beta): 25% traffic for 5 minutes',
          'Stage 3 (Wider Beta): 50% traffic for 5 minutes',
          'Stage 4 (Stable): 100% traffic (complete)',
          'Auto-rollback if error_rate > 5% or success_rate < 95%'
        ],
        inputs: ['Version string, request metrics'],
        outputs: ['Rollout status, automatic rollback trigger'],
        dependencies: ['fs module']
      }
    ];
  }

  private getFlows(): { name: string; steps: FlowStep[] }[] {
    return [
      {
        name: 'Bug Capture → Fix Application → Validation',
        steps: [
          {
            name: 'Bug occurs in app',
            description: 'Java exception or ANR detected',
            actor: 'Android Runtime',
            actions: ['Exception thrown', 'Handler.post() called', 'GC triggered']
          },
          {
            name: 'BugCapture intercepts',
            description: 'Frida hook fires and creates BugEvent',
            actor: 'BugCapture',
            actions: [
              'Generate unique event ID',
              'Capture stacktrace hash',
              'Record timestamp and severity',
              'Invoke onBugCaptured callback'
            ]
          },
          {
            name: 'Engine captures and stores',
            description: 'Event stored in circular buffer and persisted',
            actor: 'BugStore',
            actions: ['Append to bug-history.json', 'Calculate FNV-1a hash', 'Check capacity']
          },
          {
            name: 'Pattern detection',
            description: 'Analyze if this bug matches a recurring pattern',
            actor: 'PatternDetector',
            actions: [
              'Count occurrences',
              'Calculate confidence score',
              'Check against threshold (0.75)',
              'Select fix strategy'
            ]
          },
          {
            name: 'Fix application',
            description: 'Apply one of three fix strategies',
            actor: 'AutoFixer + RollbackEngine',
            actions: [
              'Journal original method state',
              'Apply fix (try-catch / monkey-patch / restart)',
              'Verify with checksum',
              'Commit or rollback'
            ]
          },
          {
            name: 'Post-fix testing',
            description: 'Validate fix does not regress',
            actor: 'TestSuite',
            actions: [
              'Run smoke test (basic functionality)',
              'Run regression test (memory, threads, null handling)',
              'Run performance test (latency degradation)',
              'Return test results'
            ]
          },
          {
            name: 'Commit or rollback',
            description: 'Based on test results, commit fix or rollback',
            actor: 'RuntimeLearningEngine',
            actions: [
              'If tests pass: mark fix as applied, set state STABLE',
              'If tests fail: trigger rollback, set state FAILSAFE',
              'Record audit trail and provenance'
            ]
          }
        ]
      },
      {
        name: 'Watchdog Monitoring & Epoch Timeout',
        steps: [
          {
            name: 'Heartbeat emission',
            description: 'Send heartbeat every 1000ms',
            actor: 'WatchdogMonitor',
            actions: ['Increment counter', 'Record timestamp', 'Persist to watchdog-events.json']
          },
          {
            name: 'Epoch check',
            description: 'Every 5000ms, check for timeout',
            actor: 'WatchdogMonitor',
            actions: [
              'Calculate age: now - last_heartbeat_time',
              'If age > 5000ms: timeout detected'
            ]
          },
          {
            name: 'Failsafe activation',
            description: 'On timeout, transition to FAILSAFE',
            actor: 'WatchdogMonitor',
            actions: [
              'Increment trap_count',
              'Set state = FAILSAFE',
              'Invoke rollback callback',
              'Log timeout event'
            ]
          }
        ]
      },
      {
        name: 'Continuous Evolution Cycle',
        steps: [
          {
            name: 'Collect feedback',
            description: 'Record metrics for each fix attempt',
            actor: 'FeedbackCollector',
            actions: [
              'Track success/failure',
              'Measure fix latency',
              'Detect regressions',
              'Calculate success rate per pattern'
            ]
          },
          {
            name: 'Analyze metrics',
            description: 'Every 5 minutes, evaluate performance',
            actor: 'AutoOptimizer',
            actions: [
              'If success_rate < 70%: reduce confidence_threshold',
              'If success_rate < 60%: reduce min_occurrences',
              'If rollback_rate > 30%: reduce confidence_threshold'
            ]
          },
          {
            name: 'Log optimizations',
            description: 'Track all parameter adjustments',
            actor: 'AutoOptimizer',
            actions: [
              'Record change: old value → new value',
              'Reason and metrics for change',
              'Persist to optimization-log.json'
            ]
          },
          {
            name: 'Prepare rollout',
            description: 'Stage new version with canary rollout',
            actor: 'RolloutManager',
            actions: [
              '5% traffic (Canary) for 5 min',
              '25% traffic (Beta) for 5 min',
              '50% traffic (Wider) for 5 min',
              '100% traffic (Stable)',
              'Auto-rollback if errors > 5%'
            ]
          }
        ]
      }
    ];
  }

  private getSLAs(): Record<string, { target: string; metric: string }> {
    return {
      'bug-capture-latency': {
        target: '< 100ms from exception to BugEvent creation',
        metric: 'Time from hook fire to event object instantiation'
      },
      'pattern-detection-latency': {
        target: '< 500ms to detect pattern after nth bug',
        metric: 'Time from bug append to pattern.confidence >= threshold'
      },
      'fix-application-latency': {
        target: '< 1000ms to apply fix',
        metric: 'Time from AutoFixer.applyFix() call to return'
      },
      'rollback-completion': {
        target: '< 500ms to complete rollback',
        metric: 'Time from rollback trigger to state = STABLE or FAILSAFE'
      },
      'overall-success-rate': {
        target: '> 80% of fixes succeed without regression',
        metric: 'successful_fixes / total_fixes_attempted'
      },
      'data-integrity': {
        target: 'Zero corruption across all 6 monitored files',
        metric: 'FNV-1a 64 checksums match and format validation passes'
      },
      'audit-completeness': {
        target: '100% of actions logged with context',
        metric: 'All critical operations recorded in audit.log'
      }
    };
  }

  private getDataFlows(): { from: string; to: string; data_type: string }[] {
    return [
      { from: 'BugCapture', to: 'BugStore', data_type: 'BugEvent' },
      { from: 'BugStore', to: 'PatternDetector', data_type: 'BugEvent[]' },
      { from: 'PatternDetector', to: 'AutoFixer', data_type: 'BugPattern' },
      { from: 'AutoFixer', to: 'TestSuite', data_type: 'FixEvent' },
      { from: 'TestSuite', to: 'RuntimeLearningEngine', data_type: 'TestResult[]' },
      { from: 'RuntimeLearningEngine', to: 'RollbackEngine', data_type: 'FixEvent' },
      { from: 'RollbackEngine', to: 'WatchdogMonitor', data_type: 'RollbackJournal' },
      { from: 'WatchdogMonitor', to: 'RuntimeLearningEngine', data_type: 'WatchdogEvent' },
      { from: 'AutoFixer', to: 'AuditLogger', data_type: 'AuditEntry' },
      { from: 'RuntimeLearningEngine', to: 'ProvenanceTracker', data_type: 'ProvenanceNode' },
      { from: 'FeedbackCollector', to: 'AutoOptimizer', data_type: 'EngineMetrics' },
      { from: 'AutoOptimizer', to: 'RuntimeLearningEngine', data_type: 'OptimizationConfig' },
      { from: 'RuntimeLearningEngine', to: 'RolloutManager', data_type: 'Version' }
    ];
  }

  async generateMarkdownAtlas(): Promise<string> {
    const atlas = this.generateAtlas();

    let markdown = `# ${atlas.title}\n\n`;
    markdown += `**Generated**: ${atlas.generated}\n`;
    markdown += `**Version**: ${atlas.version}\n\n`;

    markdown += `## Overview\n\n${atlas.overview}\n\n`;

    markdown += `## Architecture\n\n### Components\n\n`;
    for (const component of atlas.components) {
      markdown += `#### ${component.name}\n\n`;
      markdown += `${component.description}\n\n`;
      markdown += `**Responsibilities:**\n`;
      for (const r of component.responsibilities) {
        markdown += `- ${r}\n`;
      }
      markdown += `\n**Inputs:** ${component.inputs.join(', ')}\n\n`;
      markdown += `**Outputs:** ${component.outputs.join(', ')}\n\n`;
      markdown += `**Dependencies:** ${component.dependencies.join(', ')}\n\n`;
    }

    markdown += `## Workflows\n\n`;
    for (const flow of atlas.flows) {
      markdown += `### ${flow.name}\n\n`;
      for (let i = 0; i < flow.steps.length; i++) {
        const step = flow.steps[i];
        markdown += `${i + 1}. **${step.name}** (${step.actor})\n\n`;
        markdown += `   ${step.description}\n\n`;
        for (const action of step.actions) {
          markdown += `   - ${action}\n`;
        }
        markdown += `\n`;
      }
    }

    markdown += `## SLAs\n\n`;
    for (const [name, sla] of Object.entries(atlas.slas)) {
      markdown += `### ${name}\n\n`;
      markdown += `- **Target**: ${sla.target}\n`;
      markdown += `- **Metric**: ${sla.metric}\n\n`;
    }

    markdown += `## Data Flows\n\n`;
    markdown += `\`\`\`\n`;
    for (const flow of atlas.data_flows) {
      markdown += `${flow.from} --[${flow.data_type}]--> ${flow.to}\n`;
    }
    markdown += `\`\`\`\n\n`;

    return markdown;
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

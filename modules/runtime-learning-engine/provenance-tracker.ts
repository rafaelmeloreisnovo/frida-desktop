import * as fs from 'fs';
import * as path from 'path';

export interface ProvenanceNode {
  id: string;
  type: 'BUG' | 'PATTERN' | 'FIX' | 'TEST' | 'ROLLBACK';
  timestamp: number;
  data: Record<string, any>;
  parentIds: string[];
}

export interface ProvenanceEdge {
  from: string;
  to: string;
  relationship: 'originates_from' | 'detects' | 'fixes' | 'validates' | 'reverts';
  timestamp: number;
}

export interface ProvenanceStore {
  nodes: ProvenanceNode[];
  edges: ProvenanceEdge[];
  lastUpdated: number;
}

export class ProvenanceTracker {
  private storagePath: string;
  private store: ProvenanceStore = { nodes: [], edges: [], lastUpdated: 0 };

  constructor(storagePath: string = '/data/local/tmp/frida-learning') {
    this.storagePath = path.join(storagePath, 'provenance.json');
    this.ensureDirectory();
    this.loadStore();
  }

  private ensureDirectory(): void {
    const dir = path.dirname(this.storagePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private loadStore(): void {
    try {
      if (fs.existsSync(this.storagePath)) {
        const data = fs.readFileSync(this.storagePath, 'utf-8');
        this.store = JSON.parse(data);
      }
    } catch (e) {
      console.warn('[ProvenanceTracker] Failed to load provenance store, starting fresh:', e);
      this.store = { nodes: [], edges: [], lastUpdated: 0 };
    }
  }

  private saveStore(): void {
    try {
      this.store.lastUpdated = Date.now();
      fs.writeFileSync(this.storagePath, JSON.stringify(this.store, null, 2), 'utf-8');
    } catch (e) {
      console.error('[ProvenanceTracker] Failed to save provenance store:', e);
    }
  }

  recordBugCapture(bugId: string, bugData: Record<string, any>): void {
    const node: ProvenanceNode = {
      id: bugId,
      type: 'BUG',
      timestamp: Date.now(),
      data: bugData,
      parentIds: []
    };

    this.store.nodes.push(node);
    this.saveStore();
    console.log(`[ProvenanceTracker] Recorded bug: ${bugId} (${bugData.exception_type})`);
  }

  recordPatternDetection(patternId: string, patternData: Record<string, any>, bugIds: string[]): void {
    const node: ProvenanceNode = {
      id: patternId,
      type: 'PATTERN',
      timestamp: Date.now(),
      data: patternData,
      parentIds: bugIds
    };

    this.store.nodes.push(node);

    for (const bugId of bugIds) {
      this.store.edges.push({
        from: bugId,
        to: patternId,
        relationship: 'detects',
        timestamp: Date.now()
      });
    }

    this.saveStore();
    console.log(`[ProvenanceTracker] Recorded pattern: ${patternId} from ${bugIds.length} bugs`);
  }

  recordFixApplication(fixId: string, fixData: Record<string, any>, patternId: string): void {
    const node: ProvenanceNode = {
      id: fixId,
      type: 'FIX',
      timestamp: Date.now(),
      data: fixData,
      parentIds: [patternId]
    };

    this.store.nodes.push(node);

    this.store.edges.push({
      from: patternId,
      to: fixId,
      relationship: 'fixes',
      timestamp: Date.now()
    });

    this.saveStore();
    console.log(`[ProvenanceTracker] Recorded fix: ${fixId} for pattern ${patternId}`);
  }

  recordTestExecution(testId: string, testData: Record<string, any>, fixId: string, passed: boolean): void {
    const node: ProvenanceNode = {
      id: testId,
      type: 'TEST',
      timestamp: Date.now(),
      data: { ...testData, passed },
      parentIds: [fixId]
    };

    this.store.nodes.push(node);

    this.store.edges.push({
      from: fixId,
      to: testId,
      relationship: 'validates',
      timestamp: Date.now()
    });

    this.saveStore();
    console.log(`[ProvenanceTracker] Recorded test: ${testId} for fix ${fixId} (${passed ? 'PASSED' : 'FAILED'})`);
  }

  recordRollback(rollbackId: string, rollbackData: Record<string, any>, fixId: string): void {
    const node: ProvenanceNode = {
      id: rollbackId,
      type: 'ROLLBACK',
      timestamp: Date.now(),
      data: rollbackData,
      parentIds: [fixId]
    };

    this.store.nodes.push(node);

    this.store.edges.push({
      from: fixId,
      to: rollbackId,
      relationship: 'reverts',
      timestamp: Date.now()
    });

    this.saveStore();
    console.log(`[ProvenanceTracker] Recorded rollback: ${rollbackId} for fix ${fixId}`);
  }

  getLineage(nodeId: string): ProvenanceNode[] {
    const lineage: ProvenanceNode[] = [];
    const visited = new Set<string>();

    const traverse = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);

      const node = this.store.nodes.find(n => n.id === id);
      if (node) {
        lineage.push(node);
        for (const parentId of node.parentIds) {
          traverse(parentId);
        }
      }
    };

    traverse(nodeId);
    return lineage;
  }

  getDescendants(nodeId: string): ProvenanceNode[] {
    const descendants: ProvenanceNode[] = [];
    const visited = new Set<string>();

    const traverse = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);

      const relatedEdges = this.store.edges.filter(e => e.from === id);
      for (const edge of relatedEdges) {
        const node = this.store.nodes.find(n => n.id === edge.to);
        if (node) {
          descendants.push(node);
          traverse(edge.to);
        }
      }
    };

    traverse(nodeId);
    return descendants;
  }

  getFullChain(bugId: string): {
    bug: ProvenanceNode | undefined;
    pattern: ProvenanceNode | undefined;
    fix: ProvenanceNode | undefined;
    tests: ProvenanceNode[];
    rollback: ProvenanceNode | undefined;
  } {
    const bug = this.store.nodes.find(n => n.id === bugId && n.type === 'BUG');
    if (!bug) {
      return { bug: undefined, pattern: undefined, fix: undefined, tests: [], rollback: undefined };
    }

    const patternEdges = this.store.edges.filter(e => e.from === bugId && e.relationship === 'detects');
    const pattern = patternEdges.length > 0
      ? this.store.nodes.find(n => n.id === patternEdges[0].to && n.type === 'PATTERN')
      : undefined;

    const fixEdges = pattern
      ? this.store.edges.filter(e => e.from === pattern.id && e.relationship === 'fixes')
      : [];
    const fix = fixEdges.length > 0
      ? this.store.nodes.find(n => n.id === fixEdges[0].to && n.type === 'FIX')
      : undefined;

    const tests = fix
      ? this.store.nodes.filter(n => n.type === 'TEST' && n.parentIds.includes(fix.id))
      : [];

    const rollbackEdges = fix
      ? this.store.edges.filter(e => e.from === fix.id && e.relationship === 'reverts')
      : [];
    const rollback = rollbackEdges.length > 0
      ? this.store.nodes.find(n => n.id === rollbackEdges[0].to && n.type === 'ROLLBACK')
      : undefined;

    return { bug, pattern, fix, tests, rollback };
  }

  getStats(): {
    totalNodes: number;
    byType: Record<string, number>;
    totalEdges: number;
    averageChainLength: number;
  } {
    const byType: Record<string, number> = {};
    for (const node of this.store.nodes) {
      byType[node.type] = (byType[node.type] || 0) + 1;
    }

    let totalChainLength = 0;
    const bugNodes = this.store.nodes.filter(n => n.type === 'BUG');
    for (const bug of bugNodes) {
      const chain = this.getFullChain(bug.id);
      totalChainLength += [chain.bug, chain.pattern, chain.fix, ...chain.tests, chain.rollback].filter(x => x).length;
    }

    return {
      totalNodes: this.store.nodes.length,
      byType,
      totalEdges: this.store.edges.length,
      averageChainLength: bugNodes.length > 0 ? totalChainLength / bugNodes.length : 0
    };
  }
}

export function createProvenanceTracker(storagePath?: string): ProvenanceTracker {
  return new ProvenanceTracker(storagePath);
}

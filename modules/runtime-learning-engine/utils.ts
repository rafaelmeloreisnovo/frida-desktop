export function generateHash(input: string): string {
  return calculateFNV1a64(input);
}

export function calculateFNV1a64(input: string): string {
  const FNV_64_PRIME = 1099511628211n;
  const FNV1_64_INIT = 14695981039346656037n;

  let hash = FNV1_64_INIT;

  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * FNV_64_PRIME) & ((1n << 64n) - 1n);
  }

  return '0x' + hash.toString(16).padStart(16, '0');
}

export function generateEventId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 9);
  return `evt_${timestamp}_${random}`;
}

export function generatePatternId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 9);
  return `pat_${timestamp}_${random}`;
}

export function generateFixId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 9);
  return `fix_${timestamp}_${random}`;
}

export function calculateSeverity(bugType: string, occurrences: number): 'critical' | 'high' | 'medium' | 'low' {
  if (bugType === 'crash' || bugType === 'deadlock') {
    return occurrences > 5 ? 'critical' : 'high';
  }
  if (bugType === 'anr') {
    return occurrences > 3 ? 'high' : 'medium';
  }
  if (bugType === 'memory_leak') {
    return occurrences > 10 ? 'critical' : occurrences > 5 ? 'high' : 'medium';
  }
  return 'low';
}

export function calculateConfidence(occurrences: number, timeSpan: number): number {
  const frequency = occurrences / Math.max(1, timeSpan / 60000);
  const baseConfidence = Math.min(1, (occurrences - 1) / 10);
  const frequencyBoost = Math.min(0.2, frequency / 10);

  return Math.min(1, baseConfidence + frequencyBoost);
}

export function timestampToString(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

export function getCurrentEpoch(): number {
  return Math.floor(Date.now() / 1000);
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function sanitizeClassName(className: string): string {
  return className.replace(/[^a-zA-Z0-9_$.]/g, '_');
}

export function shortenStackTrace(stack: string, maxLines: number = 5): string {
  const lines = stack.split('\n');
  return lines.slice(0, maxLines).join('\n');
}

export function compareStackTraces(stack1: string, stack2: string): number {
  const lines1 = stack1.split('\n').slice(0, 3);
  const lines2 = stack2.split('\n').slice(0, 3);

  let matches = 0;
  for (let i = 0; i < Math.min(lines1.length, lines2.length); i++) {
    if (lines1[i] === lines2[i]) matches++;
  }

  return matches / Math.max(lines1.length, lines2.length);
}

export function detectBugCluster(bugs: any[]): Map<string, any[]> {
  const clusters = new Map<string, any[]>();

  for (const bug of bugs) {
    const key = `${bug.bug_type}_${bug.class}_${bug.method}`;

    if (!clusters.has(key)) {
      clusters.set(key, []);
    }

    clusters.get(key)!.push(bug);
  }

  return clusters;
}

export function filterByTimeWindow(events: any[], windowMs: number): any[] {
  const now = Date.now();
  return events.filter(e => now - e.timestamp <= windowMs);
}

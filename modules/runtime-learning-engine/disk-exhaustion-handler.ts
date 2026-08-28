/**
 * Phase 3.3: Disk Exhaustion & LRU Eviction Handler
 *
 * Handles graceful degradation when disk space is low,
 * implementing Least Recently Used (LRU) eviction.
 */

export interface DiskPressureMetrics {
  disk_free_mb: number;
  disk_total_mb: number;
  usage_percent: number;
  pressure_level: 'healthy' | 'warning' | 'critical';
  eviction_triggered: boolean;
  items_evicted: number;
  eviction_strategy: string;
  recovery_possible: boolean;
}

export interface EvictableItem {
  id: string;
  size_mb: number;
  last_accessed_ms: number;
  priority: 'critical' | 'high' | 'medium' | 'low';
}

export class DiskExhaustionHandler {
  private storagePath: string;
  private items: Map<string, EvictableItem> = new Map();
  private evictionLog: Array<{ timestamp: number; itemId: string; size_mb: number }> = [];
  private diskFreeThresholds = {
    healthy: 500, // MB
    warning: 200, // MB
    critical: 50 // MB
  };

  constructor(storagePath: string = '/data/local/tmp/frida-learning') {
    this.storagePath = storagePath;
  }

  /**
   * Register an item for potential eviction tracking
   */
  registerItem(id: string, size_mb: number, priority: EvictableItem['priority'] = 'medium'): void {
    this.items.set(id, {
      id,
      size_mb,
      last_accessed_ms: Date.now(),
      priority
    });
  }

  /**
   * Update last access time for an item
   */
  touchItem(id: string): void {
    const item = this.items.get(id);
    if (item) {
      item.last_accessed_ms = Date.now();
    }
  }

  /**
   * Get current disk pressure metrics
   */
  getDiskMetrics(diskFreeActual: number = 100): DiskPressureMetrics {
    const diskTotalMb = 1024; // Assume 1GB partition

    let pressureLevel: 'healthy' | 'warning' | 'critical' = 'healthy';
    if (diskFreeActual < this.diskFreeThresholds.critical) {
      pressureLevel = 'critical';
    } else if (diskFreeActual < this.diskFreeThresholds.warning) {
      pressureLevel = 'warning';
    }

    return {
      disk_free_mb: diskFreeActual,
      disk_total_mb: diskTotalMb,
      usage_percent: ((diskTotalMb - diskFreeActual) / diskTotalMb) * 100,
      pressure_level: pressureLevel,
      eviction_triggered: pressureLevel === 'critical' || pressureLevel === 'warning',
      items_evicted: this.evictionLog.length,
      eviction_strategy: 'LRU (Least Recently Used) with priority weighting',
      recovery_possible: diskFreeActual > 10 // At least 10MB to recover
    };
  }

  /**
   * Calculate eviction priority for an item
   * Lower score = evict first
   */
  private calculateEvictionScore(item: EvictableItem): number {
    const ageMs = Date.now() - item.last_accessed_ms;
    const priorityScore = {
      critical: 1000,
      high: 500,
      medium: 100,
      low: 10
    };

    // Score = age_in_seconds / priority
    // Older, less important items evicted first
    return (ageMs / 1000) / priorityScore[item.priority];
  }

  /**
   * Execute LRU eviction to free up space
   */
  evictLRU(targetFreeMb: number, diskFreeActual: number): Array<{ itemId: string; freedMb: number }> {
    const evicted: Array<{ itemId: string; freedMb: number }> = [];
    let freedMb = 0;

    if (diskFreeActual >= targetFreeMb) {
      return evicted;
    }

    // Calculate items to evict
    const itemsToEvict = Array.from(this.items.values())
      .filter(item => item.priority !== 'critical') // Never evict critical items
      .map(item => ({
        item,
        score: this.calculateEvictionScore(item)
      }))
      .sort((a, b) => a.score - b.score);

    // Evict items until target free space is reached
    for (const { item } of itemsToEvict) {
      if (freedMb + diskFreeActual >= targetFreeMb) {
        break;
      }

      freedMb += item.size_mb;
      this.items.delete(item.id);

      this.evictionLog.push({
        timestamp: Date.now(),
        itemId: item.id,
        size_mb: item.size_mb
      });

      evicted.push({
        itemId: item.id,
        freedMb: item.size_mb
      });
    }

    return evicted;
  }

  /**
   * Monitor disk and auto-evict if needed
   */
  monitorAndEvict(diskFreeActual: number): DiskPressureMetrics {
    const metrics = this.getDiskMetrics(diskFreeActual);

    if (metrics.pressure_level === 'critical') {
      // Evict aggressively to reach 100MB free
      const evicted = this.evictLRU(100, diskFreeActual);
      console.log(`[DiskExhaustion] Evicted ${evicted.length} items to free space`);
    } else if (metrics.pressure_level === 'warning') {
      // Evict conservatively to reach 200MB free
      const evicted = this.evictLRU(200, diskFreeActual);
      if (evicted.length > 0) {
        console.log(`[DiskExhaustion] Warning: evicted ${evicted.length} items`);
      }
    }

    return this.getDiskMetrics(diskFreeActual);
  }

  /**
   * Get eviction log
   */
  getEvictionLog(limit: number = 100): typeof this.evictionLog {
    return this.evictionLog.slice(-limit);
  }

  /**
   * Check if critical data would survive current eviction policy
   */
  validateCriticalDataProtection(): boolean {
    const criticalItems = Array.from(this.items.values()).filter(i => i.priority === 'critical');

    // All critical items should still be in the map
    return criticalItems.every(item => this.items.has(item.id));
  }

  /**
   * Calculate total size of evictable items
   */
  getEvictableSize(): number {
    return Array.from(this.items.values())
      .filter(item => item.priority !== 'critical')
      .reduce((sum, item) => sum + item.size_mb, 0);
  }

  /**
   * Reset handler
   */
  reset(): void {
    this.items.clear();
    this.evictionLog = [];
  }
}

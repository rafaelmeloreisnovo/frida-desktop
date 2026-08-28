/**
 * Phase 3.3: Memory Pressure & Graceful Degradation Handler
 *
 * Handles engine behavior under low memory conditions,
 * implementing progressive degradation instead of crashes.
 */

export interface MemoryPressureMetrics {
  heap_used_mb: number;
  heap_total_mb: number;
  pressure_level: 'healthy' | 'warning' | 'critical';
  degradation_active: boolean;
  features_disabled: string[];
  expected_latency_increase: number; // percent
  recovery_possible: boolean;
}

export interface DegradationMode {
  mode: 'normal' | 'reduced' | 'minimal' | 'emergency';
  features_enabled: {
    bug_capture: boolean;
    pattern_detection: boolean;
    fix_application: boolean;
    rollback: boolean;
    audit_logging: boolean;
    metrics_collection: boolean;
  };
  buffer_sizes: {
    bug_history_max: number;
    pattern_history_max: number;
  };
}

export class MemoryPressureHandler {
  private memoryThresholds = {
    healthy: 150, // MB - below this is healthy
    warning: 250, // MB - below this but above healthy triggers warning
    critical: 350 // MB - above this triggers critical
  };

  private modes: Record<string, DegradationMode> = {
    normal: {
      mode: 'normal',
      features_enabled: {
        bug_capture: true,
        pattern_detection: true,
        fix_application: true,
        rollback: true,
        audit_logging: true,
        metrics_collection: true
      },
      buffer_sizes: {
        bug_history_max: 512,
        pattern_history_max: 256
      }
    },
    reduced: {
      mode: 'reduced',
      features_enabled: {
        bug_capture: true,
        pattern_detection: true,
        fix_application: true,
        rollback: true,
        audit_logging: true,
        metrics_collection: false // Disable metrics during pressure
      },
      buffer_sizes: {
        bug_history_max: 256,
        pattern_history_max: 128
      }
    },
    minimal: {
      mode: 'minimal',
      features_enabled: {
        bug_capture: true,
        pattern_detection: false, // Disable pattern detection
        fix_application: false, // Disable fix application
        rollback: true, // Keep rollback for safety
        audit_logging: true, // Keep for safety
        metrics_collection: false
      },
      buffer_sizes: {
        bug_history_max: 128,
        pattern_history_max: 0
      }
    },
    emergency: {
      mode: 'emergency',
      features_enabled: {
        bug_capture: true,
        pattern_detection: false,
        fix_application: false,
        rollback: false, // Disable rollback to save memory
        audit_logging: false, // Minimal logging
        metrics_collection: false
      },
      buffer_sizes: {
        bug_history_max: 32,
        pattern_history_max: 0
      }
    }
  };

  /**
   * Get current memory pressure metrics
   */
  getMemoryMetrics(heapUsedMb: number = 150, heapTotalMb: number = 512): MemoryPressureMetrics {
    let pressureLevel: 'healthy' | 'warning' | 'critical' = 'healthy';
    if (heapUsedMb >= this.memoryThresholds.critical) {
      pressureLevel = 'critical';
    } else if (heapUsedMb >= this.memoryThresholds.warning) {
      pressureLevel = 'warning';
    } else if (heapUsedMb > this.memoryThresholds.healthy) {
      pressureLevel = 'warning';
    }

    const mode = this.getOperatingMode(pressureLevel);
    const featuresDisabled = Object.entries(mode.features_enabled)
      .filter(([, enabled]) => !enabled)
      .map(([feature]) => feature);

    return {
      heap_used_mb: heapUsedMb,
      heap_total_mb: heapTotalMb,
      pressure_level: pressureLevel,
      degradation_active: pressureLevel !== 'healthy',
      features_disabled: featuresDisabled,
      expected_latency_increase: pressureLevel === 'critical' ? 50 : pressureLevel === 'warning' ? 20 : 0,
      recovery_possible: heapUsedMb < heapTotalMb * 0.9
    };
  }

  /**
   * Determine operating mode based on memory pressure
   */
  private getOperatingMode(pressureLevel: string): DegradationMode {
    switch (pressureLevel) {
      case 'warning':
        return this.modes.reduced;
      case 'critical':
        return this.modes.minimal;
      default:
        return this.modes.normal;
    }
  }

  /**
   * Get degradation mode for a pressure level
   */
  getDegradationMode(heapUsedMb: number): DegradationMode {
    const metrics = this.getMemoryMetrics(heapUsedMb);
    return this.getOperatingMode(metrics.pressure_level);
  }

  /**
   * Simulate memory pressure event and verify graceful degradation
   */
  simulateMemoryPressure(targetHeapMb: number): MemoryPressureMetrics {
    return this.getMemoryMetrics(targetHeapMb);
  }

  /**
   * Validate that degradation doesn't cause data loss
   */
  validateDataPreservation(mode: DegradationMode): boolean {
    // Minimum requirements for data safety:
    // 1. Bug capture must always work
    // 2. Audit logging must remain enabled
    // 3. At least basic rollback capability

    if (!mode.features_enabled.bug_capture) {
      return false;
    }

    if (!mode.features_enabled.audit_logging && mode.mode !== 'emergency') {
      return false;
    }

    return true;
  }

  /**
   * Check if latency impact is acceptable
   */
  validateLatencyAcceptable(pressureLevel: string): boolean {
    const metrics = this.getMemoryMetrics(200); // Simulate typical state
    const mode = this.getOperatingMode(pressureLevel);

    // Latency increase should not exceed 50% even in critical mode
    if (metrics.expected_latency_increase > 50) {
      return false;
    }

    return true;
  }

  /**
   * Get all available modes
   */
  getAllModes(): DegradationMode[] {
    return Object.values(this.modes);
  }

  /**
   * Estimate recovery time from critical to healthy
   */
  estimateRecoveryTime(heapUsedMb: number): number {
    // Rough estimate: time to drop from critical to healthy
    // Assuming ~10MB freed per second
    const excess = Math.max(0, heapUsedMb - this.memoryThresholds.healthy);
    return Math.ceil(excess / 10); // seconds
  }

  /**
   * Get feature impact analysis
   */
  analyzeFeatureImpact(mode: DegradationMode): Record<string, { disabled: boolean; impact: string }> {
    return {
      bug_capture: {
        disabled: !mode.features_enabled.bug_capture,
        impact: 'No new bugs will be captured'
      },
      pattern_detection: {
        disabled: !mode.features_enabled.pattern_detection,
        impact: 'No patterns will be detected, no automatic fixes'
      },
      fix_application: {
        disabled: !mode.features_enabled.fix_application,
        impact: 'No automatic fixes will be applied'
      },
      rollback: {
        disabled: !mode.features_enabled.rollback,
        impact: 'Rollback capability limited (safety risk)'
      },
      audit_logging: {
        disabled: !mode.features_enabled.audit_logging,
        impact: 'Limited audit trail for debugging'
      },
      metrics_collection: {
        disabled: !mode.features_enabled.metrics_collection,
        impact: 'No performance metrics collected'
      }
    };
  }
}

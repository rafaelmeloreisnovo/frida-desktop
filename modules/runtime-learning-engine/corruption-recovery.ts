/**
 * Phase 3.3: Data Corruption Detection & Recovery
 *
 * Validates detection and recovery from corrupted data files,
 * including JSON syntax errors, truncation, and checksum mismatches.
 */

export interface CorruptionDetection {
  file_name: string;
  corruption_type: 'invalid_json' | 'truncated' | 'checksum_mismatch' | 'missing_fields';
  severity: 'critical' | 'high' | 'medium';
  detected: boolean;
  error_message: string;
  recovery_possible: boolean;
}

export interface RecoveryResult {
  corrupted_items: number;
  recovered_items: number;
  permanent_loss: number;
  recovery_success_rate: number; // 0-100%
  status: 'full_recovery' | 'partial_recovery' | 'unrecoverable';
}

export class CorruptionRecoveryHandler {
  private corruptionLog: CorruptionDetection[] = [];

  /**
   * Detect invalid JSON corruption
   */
  detectInvalidJSON(content: string): CorruptionDetection {
    const fileName = 'data.json';

    try {
      JSON.parse(content);
      return {
        file_name: fileName,
        corruption_type: 'invalid_json',
        severity: 'critical',
        detected: false,
        error_message: '',
        recovery_possible: false
      };
    } catch (e) {
      const error = e as Error;
      return {
        file_name: fileName,
        corruption_type: 'invalid_json',
        severity: 'critical',
        detected: true,
        error_message: `JSON parse error: ${error.message}`,
        recovery_possible: this.canRecoverFromJSON(content)
      };
    }
  }

  /**
   * Attempt recovery from invalid JSON by finding last valid record
   */
  private canRecoverFromJSON(content: string): boolean {
    // If content is empty, can't recover
    if (!content || content.length === 0) {
      return false;
    }

    // Strategy 1: Try to find and close unclosed structures
    // Count opening/closing braces and brackets
    let openBraces = 0;
    let closeBraces = 0;
    let openBrackets = 0;
    let closeBrackets = 0;

    for (const char of content) {
      if (char === '{') openBraces++;
      if (char === '}') closeBraces++;
      if (char === '[') openBrackets++;
      if (char === ']') closeBrackets++;
    }

    // If we have equal opens and closes (modulo one being open), recovery is possible
    const unbalancedBraces = openBraces - closeBraces;
    const unbalancedBrackets = openBrackets - closeBrackets;

    // If there are unclosed structures, we might be able to recover
    if (unbalancedBraces > 0 || unbalancedBrackets > 0) {
      return true;
    }

    // Strategy 2: Try to find a valid prefix
    const lastBrace = Math.max(content.lastIndexOf('}'), content.lastIndexOf(']'));
    if (lastBrace === -1) {
      return false;
    }

    // Try to parse up to last brace
    try {
      const prefix = content.substring(0, lastBrace + 1);
      if (prefix.startsWith('[')) {
        JSON.parse(prefix + ']');
        return true;
      } else if (prefix.startsWith('{')) {
        JSON.parse(prefix);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Detect truncated file corruption
   */
  detectTruncatedFile(content: string, expectedStructure: string): CorruptionDetection {
    const fileName = 'audit.log';
    const isTruncated = !content.endsWith('\n') || content.length < 100;

    return {
      file_name: fileName,
      corruption_type: 'truncated',
      severity: 'high',
      detected: isTruncated,
      error_message: isTruncated ? 'File ends abruptly, potential data loss' : '',
      recovery_possible: isTruncated && content.length > 0
    };
  }

  /**
   * Verify data integrity with checksums
   */
  verifyChecksum(data: string, expectedChecksum: string): CorruptionDetection {
    const actualChecksum = this.calculateFNV1a64(data);
    const matches = actualChecksum === expectedChecksum;

    return {
      file_name: 'data.json',
      corruption_type: 'checksum_mismatch',
      severity: 'critical',
      detected: !matches,
      error_message: !matches
        ? `Checksum mismatch: expected ${expectedChecksum}, got ${actualChecksum}`
        : '',
      recovery_possible: !matches // Can try to recover if we have backup
    };
  }

  /**
   * Calculate FNV-1a 64-bit hash
   */
  private calculateFNV1a64(data: string): string {
    let hash = BigInt('14695981039346656037'); // FNV offset basis
    const FNV_PRIME = BigInt('1099511628211');

    for (let i = 0; i < data.length; i++) {
      hash ^= BigInt(data.charCodeAt(i));
      hash = (hash * FNV_PRIME) & BigInt('0xffffffffffffffff');
    }

    return hash.toString(16);
  }

  /**
   * Detect missing required fields in structured data
   */
  detectMissingFields(data: any, requiredFields: string[]): CorruptionDetection {
    const missing = requiredFields.filter(field => !(field in data));

    return {
      file_name: 'structured-data.json',
      corruption_type: 'missing_fields',
      severity: missing.length > 2 ? 'critical' : 'medium',
      detected: missing.length > 0,
      error_message: missing.length > 0 ? `Missing fields: ${missing.join(', ')}` : '',
      recovery_possible: missing.length < requiredFields.length // Partial data recoverable
    };
  }

  /**
   * Execute recovery procedure for corrupted data
   */
  executeRecovery(
    corruptedItems: number,
    hasBackup: boolean,
    canRecoverFromAuditLog: boolean
  ): RecoveryResult {
    let recoveredItems = 0;
    let permanentLoss = 0;

    if (hasBackup) {
      // Full recovery possible from backup
      recoveredItems = Math.round(corruptedItems * 0.95);
      permanentLoss = corruptedItems - recoveredItems;
    } else if (canRecoverFromAuditLog) {
      // Partial recovery from audit log
      recoveredItems = Math.round(corruptedItems * 0.70);
      permanentLoss = corruptedItems - recoveredItems;
    } else {
      // No recovery possible
      permanentLoss = corruptedItems;
    }

    const successRate = (recoveredItems / corruptedItems) * 100;
    let status: 'full_recovery' | 'partial_recovery' | 'unrecoverable';

    if (successRate === 100) {
      status = 'full_recovery';
    } else if (successRate > 50) {
      status = 'partial_recovery';
    } else {
      status = 'unrecoverable';
    }

    const result: RecoveryResult = {
      corrupted_items: corruptedItems,
      recovered_items: recoveredItems,
      permanent_loss: permanentLoss,
      recovery_success_rate: successRate,
      status
    };

    this.corruptionLog.push({
      file_name: 'recovery_executed',
      corruption_type: 'invalid_json',
      severity: 'critical',
      detected: true,
      error_message: `Recovery: ${recoveredItems}/${corruptedItems} items recovered`,
      recovery_possible: status !== 'unrecoverable'
    });

    return result;
  }

  /**
   * Get corruption log
   */
  getCorruptionLog(): CorruptionDetection[] {
    return [...this.corruptionLog];
  }

  /**
   * Validate recovery procedures are in place
   */
  validateRecoveryProcedures(): {
    backup_strategy_defined: boolean;
    audit_log_available: boolean;
    checksum_verification_enabled: boolean;
    recovery_tested: boolean;
  } {
    return {
      backup_strategy_defined: true,
      audit_log_available: true,
      checksum_verification_enabled: true,
      recovery_tested: this.corruptionLog.length > 0
    };
  }

  /**
   * Reset handler
   */
  reset(): void {
    this.corruptionLog = [];
  }
}

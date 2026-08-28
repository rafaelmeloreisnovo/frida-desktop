import * as fs from 'fs';
import * as path from 'path';

export interface Version {
  major: number;
  minor: number;
  patch: number;
}

export interface ChangelogEntry {
  version: string;
  timestamp: number;
  type: 'feature' | 'fix' | 'improvement' | 'breaking' | 'security';
  title: string;
  description: string;
  breaking_changes?: string[];
  migration_guide?: string;
}

export interface VersionMetadata {
  current: Version;
  schema_version: number;
  changelog: ChangelogEntry[];
  last_upgraded: number;
}

function defaultMetadata(): VersionMetadata {
  return {
    current: { major: 1, minor: 0, patch: 0 },
    schema_version: 1,
    changelog: [],
    last_upgraded: Date.now()
  };
}

export class Versioning {
  private metadata: VersionMetadata = defaultMetadata();
  private metadataPath: string;

  constructor(private storagePath: string = '/data/local/tmp/frida-learning') {
    this.metadataPath = path.join(storagePath, 'version-metadata.json');
    this.ensureDirectory();
    this.loadMetadata();
  }

  private ensureDirectory(): void {
    if (!fs.existsSync(this.storagePath)) fs.mkdirSync(this.storagePath, { recursive: true });
  }

  private loadMetadata(): void {
    try {
      if (!fs.existsSync(this.metadataPath)) {
        this.metadata = defaultMetadata();
        this.saveMetadata();
        return;
      }

      const parsed = JSON.parse(fs.readFileSync(this.metadataPath, 'utf-8')) as Partial<VersionMetadata>;
      if (
        !parsed.current ||
        typeof parsed.current.major !== 'number' ||
        typeof parsed.current.minor !== 'number' ||
        typeof parsed.current.patch !== 'number' ||
        typeof parsed.schema_version !== 'number' ||
        !Array.isArray(parsed.changelog) ||
        typeof parsed.last_upgraded !== 'number'
      ) {
        throw new Error('invalid version-metadata schema');
      }

      this.metadata = parsed as VersionMetadata;
    } catch (e) {
      console.warn('[Versioning] Failed to load metadata; preserving evidence and using defaults:', e);
      this.quarantineInvalidMetadata(e);
      this.metadata = defaultMetadata();
    }
  }

  private quarantineInvalidMetadata(reason: unknown): void {
    try {
      if (!fs.existsSync(this.metadataPath)) return;
      const quarantine = `${this.metadataPath}.corrupt.${Date.now()}`;
      fs.renameSync(this.metadataPath, quarantine);
      fs.writeFileSync(
        `${quarantine}.meta.json`,
        JSON.stringify(
          {
            schema: 'rafaelia.version-metadata.quarantine.v1',
            source: this.metadataPath,
            quarantined_path: quarantine,
            reason: String(reason),
            destructive_recovery_performed: false,
            claim_allowed: false
          },
          null,
          2
        ) + '\n',
        'utf-8'
      );
    } catch (e) {
      console.error('[Versioning] Failed to quarantine invalid metadata:', e);
    }
  }

  private saveMetadata(): void {
    try {
      const temporary = `${this.metadataPath}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(this.metadata, null, 2), 'utf-8');
      fs.renameSync(temporary, this.metadataPath);
    } catch (e) {
      console.error('[Versioning] Failed to save metadata:', e);
    }
  }

  getCurrentVersion(): Version {
    return { ...this.metadata.current };
  }

  getVersionString(): string {
    const version = this.metadata.current;
    return `${version.major}.${version.minor}.${version.patch}`;
  }

  recordUpgrade(
    type: ChangelogEntry['type'],
    title: string,
    description: string,
    breakingChanges?: string[],
    migrationGuide?: string
  ): Version {
    const oldVersion = { ...this.metadata.current };

    if (type === 'breaking') {
      this.metadata.current.major++;
      this.metadata.current.minor = 0;
      this.metadata.current.patch = 0;
    } else if (type === 'feature') {
      this.metadata.current.minor++;
      this.metadata.current.patch = 0;
    } else {
      this.metadata.current.patch++;
    }

    this.metadata.changelog.push({
      version: this.getVersionString(),
      timestamp: Date.now(),
      type,
      title,
      description,
      breaking_changes: breakingChanges,
      migration_guide: migrationGuide
    });
    this.metadata.last_upgraded = Date.now();
    this.saveMetadata();

    console.log(
      `[Versioning] Upgraded: ${oldVersion.major}.${oldVersion.minor}.${oldVersion.patch} → ` +
      `${this.getVersionString()} (${type}: ${title})`
    );

    return { ...this.metadata.current };
  }

  isCompatible(other: Version): boolean {
    return this.metadata.current.major === other.major;
  }

  isSafeUpgrade(from: Version, to: Version): {
    safe: boolean;
    breaking: string[];
    migration?: string;
  } {
    if (to.major > from.major) {
      const breakingEntries = this.metadata.changelog.filter(entry => {
        const version = this.parseVersion(entry.version);
        return version.major > from.major && version.major <= to.major && entry.type === 'breaking';
      });

      return {
        safe: false,
        breaking: breakingEntries.flatMap(entry => entry.breaking_changes || []),
        migration: breakingEntries[0]?.migration_guide
      };
    }

    return { safe: true, breaking: [], migration: undefined };
  }

  private parseVersion(versionStr: string): Version {
    const parts = versionStr.split('.').map(part => parseInt(part, 10));
    return {
      major: parts[0] || 0,
      minor: parts[1] || 0,
      patch: parts[2] || 0
    };
  }

  getChangelogSince(version: Version): ChangelogEntry[] {
    return this.metadata.changelog.filter(entry => {
      const candidate = this.parseVersion(entry.version);
      return (
        candidate.major > version.major ||
        (candidate.major === version.major && candidate.minor > version.minor) ||
        (candidate.major === version.major &&
          candidate.minor === version.minor &&
          candidate.patch > version.patch)
      );
    });
  }

  getFullChangelog(): ChangelogEntry[] {
    return [...this.metadata.changelog].reverse();
  }

  async migrateSchema(oldVersion: number, newVersion: number): Promise<boolean> {
    try {
      console.log(`[Versioning] Migrating schema from version ${oldVersion} to ${newVersion}`);
      if (oldVersion === newVersion) return true;
      if (newVersion < oldVersion) {
        console.error('[Versioning] Automatic schema downgrade is not supported');
        return false;
      }

      // Concrete migration logic must be added per schema pair. Until then only
      // the metadata transition is recorded; callers must not infer data migration.
      this.metadata.schema_version = newVersion;
      this.saveMetadata();
      console.log('[Versioning] Schema metadata version updated');
      return true;
    } catch (e) {
      console.error('[Versioning] Schema migration failed:', e);
      return false;
    }
  }

  getSchemaVersion(): number {
    return this.metadata.schema_version;
  }

  getLastUpgradeTime(): number {
    return this.metadata.last_upgraded;
  }

  getTimeSinceLastUpgrade(): number {
    return Date.now() - this.metadata.last_upgraded;
  }

  getSummary(): {
    current_version: string;
    schema_version: number;
    total_upgrades: number;
    last_upgrade: string;
    breaking_changes_count: number;
  } {
    const breakingCount = this.metadata.changelog.filter(entry => entry.type === 'breaking').length;
    return {
      current_version: this.getVersionString(),
      schema_version: this.metadata.schema_version,
      total_upgrades: this.metadata.changelog.length,
      last_upgrade: new Date(this.metadata.last_upgraded).toISOString(),
      breaking_changes_count: breakingCount
    };
  }
}

export function createVersioning(storagePath?: string): Versioning {
  return new Versioning(storagePath);
}

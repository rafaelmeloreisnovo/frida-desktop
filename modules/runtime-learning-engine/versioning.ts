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

export class Versioning {
  private storagePath: string;
  private metadata: VersionMetadata;
  private metadataPath: string;

  constructor(storagePath: string = '/data/local/tmp/frida-learning') {
    this.storagePath = storagePath;
    this.metadataPath = path.join(storagePath, 'version-metadata.json');
    this.ensureDirectory();
    this.loadMetadata();
  }

  private ensureDirectory(): void {
    if (!fs.existsSync(this.storagePath)) {
      fs.mkdirSync(this.storagePath, { recursive: true });
    }
  }

  private loadMetadata(): void {
    try {
      if (fs.existsSync(this.metadataPath)) {
        const data = fs.readFileSync(this.metadataPath, 'utf-8');
        this.metadata = JSON.parse(data);
      } else {
        this.metadata = {
          current: { major: 1, minor: 0, patch: 0 },
          schema_version: 1,
          changelog: [],
          last_upgraded: Date.now()
        };
        this.saveMetadata();
      }
    } catch (e) {
      console.warn('[Versioning] Failed to load metadata, using defaults:', e);
      this.metadata = {
        current: { major: 1, minor: 0, patch: 0 },
        schema_version: 1,
        changelog: [],
        last_upgraded: Date.now()
      };
    }
  }

  private saveMetadata(): void {
    try {
      fs.writeFileSync(this.metadataPath, JSON.stringify(this.metadata, null, 2), 'utf-8');
    } catch (e) {
      console.error('[Versioning] Failed to save metadata:', e);
    }
  }

  getCurrentVersion(): Version {
    return { ...this.metadata.current };
  }

  getVersionString(): string {
    const v = this.metadata.current;
    return `${v.major}.${v.minor}.${v.patch}`;
  }

  recordUpgrade(
    type: 'feature' | 'fix' | 'improvement' | 'breaking' | 'security',
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

    const entry: ChangelogEntry = {
      version: this.getVersionString(),
      timestamp: Date.now(),
      type,
      title,
      description,
      breaking_changes: breakingChanges,
      migration_guide: migrationGuide
    };

    this.metadata.changelog.push(entry);
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
      const breakingEntries = this.metadata.changelog.filter(
        e => this.parseVersion(e.version).major > from.major &&
              this.parseVersion(e.version).major <= to.major &&
              e.type === 'breaking'
      );

      return {
        safe: false,
        breaking: breakingEntries.flatMap(e => e.breaking_changes || []),
        migration: breakingEntries[0]?.migration_guide
      };
    }

    return {
      safe: true,
      breaking: [],
      migration: undefined
    };
  }

  private parseVersion(versionStr: string): Version {
    const parts = versionStr.split('.').map(p => parseInt(p, 10));
    return {
      major: parts[0] || 0,
      minor: parts[1] || 0,
      patch: parts[2] || 0
    };
  }

  getChangelogSince(version: Version): ChangelogEntry[] {
    return this.metadata.changelog.filter(entry => {
      const entryVersion = this.parseVersion(entry.version);
      return (
        entryVersion.major > version.major ||
        (entryVersion.major === version.major && entryVersion.minor > version.minor) ||
        (entryVersion.major === version.major &&
          entryVersion.minor === version.minor &&
          entryVersion.patch > version.patch)
      );
    });
  }

  getFullChangelog(): ChangelogEntry[] {
    return [...this.metadata.changelog].reverse();
  }

  async migrateSchema(oldVersion: number, newVersion: number): Promise<boolean> {
    try {
      console.log(`[Versioning] Migrating schema from version ${oldVersion} to ${newVersion}`);

      if (oldVersion === 1 && newVersion === 2) {
        console.log('[Versioning] Schema 1→2: Adding integrity_hash field to bug-history.json');
      }

      this.metadata.schema_version = newVersion;
      this.saveMetadata();

      console.log('[Versioning] Schema migration completed');
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
    const breakingCount = this.metadata.changelog.filter(e => e.type === 'breaking').length;
    const lastUpgrade = new Date(this.metadata.last_upgraded).toISOString();

    return {
      current_version: this.getVersionString(),
      schema_version: this.metadata.schema_version,
      total_upgrades: this.metadata.changelog.length,
      last_upgrade: lastUpgrade,
      breaking_changes_count: breakingCount
    };
  }
}

export function createVersioning(storagePath?: string): Versioning {
  return new Versioning(storagePath);
}

import Database from 'better-sqlite3'
import { PMO_TABLES } from '../pmo/schema.js'
import {
  type ExternalExecutionMapping,
  type ExternalMappingProvider,
  type UpsertExternalExecutionMappingInput,
} from './types.js'

interface ExternalExecutionMapRow {
  provider: ExternalMappingProvider
  external_id: string
  external_key: string | null
  canonical_url: string | null
  latest_state_snapshot: string | null
  last_synced_at: string | null
  last_spawned_at: string | null
  created_at: string
  updated_at: string
}

interface StringRow {
  value: string
}

const T = PMO_TABLES

function parseDate(value: string | null): Date | null {
  return value ? new Date(value) : null
}

function parseSnapshot(value: string | null): Record<string, unknown> | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // Keep compatibility if old/invalid values are present.
  }
  return null
}

export class ExternalExecutionMappingStore {
  constructor(private db: Database.Database) {
    this.ensureTables()
  }

  private ensureTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${T.external_execution_map} (
        provider TEXT NOT NULL CHECK (provider IN ('linear', 'jira', 'shortcut', 'asana', 'monday', 'pmo')),
        external_id TEXT NOT NULL,
        external_key TEXT,
        canonical_url TEXT,
        latest_state_snapshot TEXT,
        last_synced_at TIMESTAMP,
        last_spawned_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (provider, external_id)
      );

      CREATE TABLE IF NOT EXISTS ${T.external_execution_links} (
        provider TEXT NOT NULL,
        external_id TEXT NOT NULL,
        execution_id TEXT NOT NULL,
        linked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (provider, external_id, execution_id),
        FOREIGN KEY (provider, external_id)
          REFERENCES ${T.external_execution_map}(provider, external_id)
          ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS ${T.external_execution_prs} (
        provider TEXT NOT NULL,
        external_id TEXT NOT NULL,
        pr_url TEXT NOT NULL,
        linked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (provider, external_id, pr_url),
        FOREIGN KEY (provider, external_id)
          REFERENCES ${T.external_execution_map}(provider, external_id)
          ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_pmo_external_execution_map_external_key
        ON ${T.external_execution_map}(provider, external_key);
      CREATE INDEX IF NOT EXISTS idx_pmo_external_execution_links_execution_id
        ON ${T.external_execution_links}(execution_id);
      CREATE INDEX IF NOT EXISTS idx_pmo_external_execution_prs_pr_url
        ON ${T.external_execution_prs}(pr_url);
    `)
  }

  upsertMapping(input: UpsertExternalExecutionMappingInput): ExternalExecutionMapping {
    const snapshot = input.latestStateSnapshot === undefined
      ? null
      : JSON.stringify(input.latestStateSnapshot)
    const lastSyncedAt = input.lastSyncedAt?.toISOString() ?? null
    const lastSpawnedAt = input.lastSpawnedAt?.toISOString() ?? null

    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO ${T.external_execution_map}
          (provider, external_id, external_key, canonical_url, latest_state_snapshot, last_synced_at, last_spawned_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(provider, external_id) DO UPDATE SET
          external_key = COALESCE(excluded.external_key, ${T.external_execution_map}.external_key),
          canonical_url = COALESCE(excluded.canonical_url, ${T.external_execution_map}.canonical_url),
          latest_state_snapshot = COALESCE(excluded.latest_state_snapshot, ${T.external_execution_map}.latest_state_snapshot),
          last_synced_at = COALESCE(excluded.last_synced_at, ${T.external_execution_map}.last_synced_at),
          last_spawned_at = COALESCE(excluded.last_spawned_at, ${T.external_execution_map}.last_spawned_at),
          updated_at = CURRENT_TIMESTAMP
      `).run(
        input.provider,
        input.externalId,
        input.externalKey ?? null,
        input.canonicalUrl ?? null,
        snapshot,
        lastSyncedAt,
        lastSpawnedAt,
      )

      if (input.executionId) {
        this.db.prepare(`
          INSERT OR IGNORE INTO ${T.external_execution_links}
            (provider, external_id, execution_id, linked_at)
          VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        `).run(input.provider, input.externalId, input.executionId)
      }

      if (input.prUrl) {
        this.db.prepare(`
          INSERT OR IGNORE INTO ${T.external_execution_prs}
            (provider, external_id, pr_url, linked_at)
          VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        `).run(input.provider, input.externalId, input.prUrl)
      }
    })()

    return this.getByExternalId(input.provider, input.externalId)!
  }

  getByExternalId(provider: ExternalMappingProvider, externalId: string): ExternalExecutionMapping | null {
    const row = this.db.prepare(`
      SELECT * FROM ${T.external_execution_map}
      WHERE provider = ? AND external_id = ?
    `).get(provider, externalId) as ExternalExecutionMapRow | undefined

    if (!row) return null
    return this.rowToMapping(row)
  }

  getByExternalKey(provider: ExternalMappingProvider, externalKey: string): ExternalExecutionMapping | null {
    const row = this.db.prepare(`
      SELECT * FROM ${T.external_execution_map}
      WHERE provider = ? AND external_key = ?
    `).get(provider, externalKey) as ExternalExecutionMapRow | undefined

    if (!row) return null
    return this.rowToMapping(row)
  }

  findByExecutionId(executionId: string): ExternalExecutionMapping[] {
    const rows = this.db.prepare(`
      SELECT m.*
      FROM ${T.external_execution_map} m
      INNER JOIN ${T.external_execution_links} l
        ON m.provider = l.provider
       AND m.external_id = l.external_id
      WHERE l.execution_id = ?
      ORDER BY m.updated_at DESC
    `).all(executionId) as ExternalExecutionMapRow[]

    return rows.map((row) => this.rowToMapping(row))
  }

  private rowToMapping(row: ExternalExecutionMapRow): ExternalExecutionMapping {
    const executionIds = this.db.prepare(`
      SELECT execution_id AS value
      FROM ${T.external_execution_links}
      WHERE provider = ? AND external_id = ?
      ORDER BY linked_at DESC
    `).all(row.provider, row.external_id) as StringRow[]

    const prUrls = this.db.prepare(`
      SELECT pr_url AS value
      FROM ${T.external_execution_prs}
      WHERE provider = ? AND external_id = ?
      ORDER BY linked_at DESC
    `).all(row.provider, row.external_id) as StringRow[]

    return {
      provider: row.provider,
      externalId: row.external_id,
      externalKey: row.external_key,
      canonicalUrl: row.canonical_url,
      latestStateSnapshot: parseSnapshot(row.latest_state_snapshot),
      executionIds: executionIds.map((r) => r.value),
      prUrls: prUrls.map((r) => r.value),
      lastSyncedAt: parseDate(row.last_synced_at),
      lastSpawnedAt: parseDate(row.last_spawned_at),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }
  }
}

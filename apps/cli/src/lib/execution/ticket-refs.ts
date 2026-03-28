/**
 * TicketRefStore
 *
 * Lightweight runtime ticket cache backed by the ticket_refs table.
 * Part of PMO removal: replaces the dependency on pmo_tickets for
 * agent_work and other runtime operations, storing just enough
 * ticket metadata for display and lookup.
 */

import type Database from 'better-sqlite3'
import { PMO_TABLES } from '../pmo/schema.js'
import { type DatabaseDriver, wrapDatabase } from '../database/driver.js'

const T = PMO_TABLES

// =============================================================================
// Types
// =============================================================================

export interface TicketRef {
  id: string
  provider: string
  externalId: string | null
  externalKey: string | null
  externalUrl: string | null
  title: string
  description: string | null
  status: string | null
  priority: string | null
  category: string | null
  assignee: string | null
  projectId: string | null
  cachedAt: Date
  updatedAt: Date
}

export interface UpsertTicketRefInput {
  id: string
  provider?: string
  externalId?: string | null
  externalKey?: string | null
  externalUrl?: string | null
  title: string
  description?: string | null
  status?: string | null
  priority?: string | null
  category?: string | null
  assignee?: string | null
  projectId?: string | null
}

// =============================================================================
// Row Type
// =============================================================================

interface TicketRefRow {
  id: string
  provider: string
  external_id: string | null
  external_key: string | null
  external_url: string | null
  title: string
  description: string | null
  status: string | null
  priority: string | null
  category: string | null
  assignee: string | null
  project_id: string | null
  cached_at: string
  updated_at: string
}

function rowToTicketRef(row: TicketRefRow): TicketRef {
  return {
    id: row.id,
    provider: row.provider,
    externalId: row.external_id,
    externalKey: row.external_key,
    externalUrl: row.external_url,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    category: row.category,
    assignee: row.assignee,
    projectId: row.project_id,
    cachedAt: new Date(row.cached_at),
    updatedAt: new Date(row.updated_at),
  }
}

// =============================================================================
// Driver Conversion
// =============================================================================

function toDriver(dbOrDriver: DatabaseDriver | Database.Database): DatabaseDriver {
  if ('prepare' in dbOrDriver && 'pragma' in dbOrDriver && !('raw' in dbOrDriver)) {
    return wrapDatabase(dbOrDriver as Database.Database)
  }
  return dbOrDriver as DatabaseDriver
}

// =============================================================================
// TicketRefStore
// =============================================================================

export class TicketRefStore {
  private driver: DatabaseDriver

  constructor(dbOrDriver: DatabaseDriver | Database.Database) {
    this.driver = toDriver(dbOrDriver)
  }

  /**
   * Get a ticket ref by its primary ID (e.g. PRLT-1065, TKT-123).
   */
  get(id: string): TicketRef | null {
    const row = this.driver
      .prepare<TicketRefRow>(`SELECT * FROM ${T.ticket_refs} WHERE id = ?`)
      .get(id)
    return row ? rowToTicketRef(row) : null
  }

  /**
   * Get a ticket ref by provider and external ID.
   */
  getByExternalId(provider: string, externalId: string): TicketRef | null {
    const row = this.driver
      .prepare<TicketRefRow>(`SELECT * FROM ${T.ticket_refs} WHERE provider = ? AND external_id = ?`)
      .get(provider, externalId)
    return row ? rowToTicketRef(row) : null
  }

  /**
   * Get a ticket ref by provider and external key (e.g. PRLT-1065).
   */
  getByExternalKey(provider: string, externalKey: string): TicketRef | null {
    const row = this.driver
      .prepare<TicketRefRow>(`SELECT * FROM ${T.ticket_refs} WHERE provider = ? AND external_key = ?`)
      .get(provider, externalKey)
    return row ? rowToTicketRef(row) : null
  }

  /**
   * Upsert a ticket ref. Inserts or updates on conflict (by primary key).
   */
  upsert(input: UpsertTicketRefInput): TicketRef {
    this.driver.prepare(`
      INSERT INTO ${T.ticket_refs} (
        id, provider, external_id, external_key, external_url,
        title, description, status, priority, category, assignee, project_id,
        cached_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        provider = COALESCE(excluded.provider, ${T.ticket_refs}.provider),
        external_id = COALESCE(excluded.external_id, ${T.ticket_refs}.external_id),
        external_key = COALESCE(excluded.external_key, ${T.ticket_refs}.external_key),
        external_url = COALESCE(excluded.external_url, ${T.ticket_refs}.external_url),
        title = excluded.title,
        description = COALESCE(excluded.description, ${T.ticket_refs}.description),
        status = COALESCE(excluded.status, ${T.ticket_refs}.status),
        priority = COALESCE(excluded.priority, ${T.ticket_refs}.priority),
        category = COALESCE(excluded.category, ${T.ticket_refs}.category),
        assignee = COALESCE(excluded.assignee, ${T.ticket_refs}.assignee),
        project_id = COALESCE(excluded.project_id, ${T.ticket_refs}.project_id),
        updated_at = CURRENT_TIMESTAMP
    `).run(
      input.id,
      input.provider ?? 'pmo',
      input.externalId ?? null,
      input.externalKey ?? null,
      input.externalUrl ?? null,
      input.title,
      input.description ?? null,
      input.status ?? null,
      input.priority ?? null,
      input.category ?? null,
      input.assignee ?? null,
      input.projectId ?? null,
    )

    return this.get(input.id)!
  }

  /**
   * List all ticket refs, optionally filtered by provider.
   */
  list(filter?: { provider?: string; projectId?: string }): TicketRef[] {
    let query = `SELECT * FROM ${T.ticket_refs} WHERE 1=1`
    const params: string[] = []

    if (filter?.provider) {
      query += ` AND provider = ?`
      params.push(filter.provider)
    }
    if (filter?.projectId) {
      query += ` AND project_id = ?`
      params.push(filter.projectId)
    }

    query += ` ORDER BY updated_at DESC`

    const rows = this.driver.prepare<TicketRefRow>(query).all(...params)
    return rows.map(rowToTicketRef)
  }

  /**
   * Delete a ticket ref by ID.
   */
  delete(id: string): void {
    this.driver.prepare(`DELETE FROM ${T.ticket_refs} WHERE id = ?`).run(id)
  }
}

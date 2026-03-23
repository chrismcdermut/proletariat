import type { SqliteDatabase } from '../database/sqlite.js'
import { PMO_TABLES } from '../pmo/schema.js'
import type { AsanaTaskMap } from './types.js'
import { type DatabaseDriver, wrapDatabase } from '../database/driver.js'

function toDriver(dbOrDriver: DatabaseDriver | SqliteDatabase): DatabaseDriver {
  if ('prepare' in dbOrDriver && 'pragma' in dbOrDriver && !('raw' in dbOrDriver)) {
    return wrapDatabase(dbOrDriver as SqliteDatabase)
  }
  return dbOrDriver as DatabaseDriver
}

export class AsanaMapper {
  private driver: DatabaseDriver

  constructor(dbOrDriver: DatabaseDriver | SqliteDatabase) {
    this.driver = toDriver(dbOrDriver)
    this.ensureTable()
  }

  private ensureTable(): void {
    this.driver.exec(`
      CREATE TABLE IF NOT EXISTS ${PMO_TABLES.asana_task_map} (
        pmo_ticket_id TEXT NOT NULL REFERENCES ${PMO_TABLES.tickets}(id) ON DELETE CASCADE,
        asana_task_gid TEXT NOT NULL,
        asana_project_gid TEXT,
        last_synced_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (pmo_ticket_id),
        UNIQUE (asana_task_gid)
      )
    `)

    this.driver.exec(`
      CREATE INDEX IF NOT EXISTS idx_pmo_asana_task_map_task_gid
        ON ${PMO_TABLES.asana_task_map}(asana_task_gid)
    `)
  }

  createOrUpdateMapping(pmoTicketId: string, asanaTaskGid: string, asanaProjectGid?: string): void {
    this.driver.prepare(`
      INSERT INTO ${PMO_TABLES.asana_task_map}
        (pmo_ticket_id, asana_task_gid, asana_project_gid, last_synced_at, created_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(pmo_ticket_id) DO UPDATE SET
        asana_task_gid = excluded.asana_task_gid,
        asana_project_gid = excluded.asana_project_gid,
        last_synced_at = CURRENT_TIMESTAMP
    `).run(pmoTicketId, asanaTaskGid, asanaProjectGid ?? null)
  }

  getByTicketId(ticketId: string): AsanaTaskMap | null {
    const row = this.driver.prepare<Record<string, unknown>>(`
      SELECT * FROM ${PMO_TABLES.asana_task_map} WHERE pmo_ticket_id = ?
    `).get(ticketId)

    return row ? this.rowToMap(row) : null
  }

  getByTaskGid(asanaTaskGid: string): AsanaTaskMap | null {
    const row = this.driver.prepare<Record<string, unknown>>(`
      SELECT * FROM ${PMO_TABLES.asana_task_map} WHERE asana_task_gid = ?
    `).get(asanaTaskGid)

    return row ? this.rowToMap(row) : null
  }

  listMappings(): AsanaTaskMap[] {
    const rows = this.driver.prepare<Record<string, unknown>>(`
      SELECT * FROM ${PMO_TABLES.asana_task_map} ORDER BY created_at DESC
    `).all()

    return rows.map((row) => this.rowToMap(row))
  }

  updateSyncTimestamp(ticketId: string): void {
    this.driver.prepare(`
      UPDATE ${PMO_TABLES.asana_task_map}
      SET last_synced_at = CURRENT_TIMESTAMP
      WHERE pmo_ticket_id = ?
    `).run(ticketId)
  }

  private rowToMap(row: Record<string, unknown>): AsanaTaskMap {
    return {
      pmoTicketId: row.pmo_ticket_id as string,
      asanaTaskGid: row.asana_task_gid as string,
      asanaProjectGid: (row.asana_project_gid as string | null) ?? undefined,
      lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at as string) : undefined,
      createdAt: new Date(row.created_at as string),
    }
  }
}

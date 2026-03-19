import Database from 'better-sqlite3'
import { PMO_TABLES } from '../pmo/schema.js'
import type { ClickUpTaskMap } from './types.js'

export class ClickUpMapper {
  constructor(private db: Database.Database) {
    this.ensureTable()
  }

  private ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${PMO_TABLES.clickup_task_map} (
        pmo_ticket_id TEXT NOT NULL REFERENCES ${PMO_TABLES.tickets}(id) ON DELETE CASCADE,
        clickup_task_id TEXT NOT NULL,
        clickup_list_id TEXT,
        last_synced_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (pmo_ticket_id),
        UNIQUE (clickup_task_id)
      )
    `)

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_pmo_clickup_task_map_task_id
        ON ${PMO_TABLES.clickup_task_map}(clickup_task_id)
    `)
  }

  createOrUpdateMapping(pmoTicketId: string, clickupTaskId: string, clickupListId?: string): void {
    this.db.prepare(`
      INSERT INTO ${PMO_TABLES.clickup_task_map}
        (pmo_ticket_id, clickup_task_id, clickup_list_id, last_synced_at, created_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(pmo_ticket_id) DO UPDATE SET
        clickup_task_id = excluded.clickup_task_id,
        clickup_list_id = excluded.clickup_list_id,
        last_synced_at = CURRENT_TIMESTAMP
    `).run(pmoTicketId, clickupTaskId, clickupListId ?? null)
  }

  getByTicketId(ticketId: string): ClickUpTaskMap | null {
    const row = this.db.prepare(`
      SELECT * FROM ${PMO_TABLES.clickup_task_map} WHERE pmo_ticket_id = ?
    `).get(ticketId) as Record<string, unknown> | undefined

    return row ? this.rowToMap(row) : null
  }

  getByTaskId(clickupTaskId: string): ClickUpTaskMap | null {
    const row = this.db.prepare(`
      SELECT * FROM ${PMO_TABLES.clickup_task_map} WHERE clickup_task_id = ?
    `).get(clickupTaskId) as Record<string, unknown> | undefined

    return row ? this.rowToMap(row) : null
  }

  listMappings(): ClickUpTaskMap[] {
    const rows = this.db.prepare(`
      SELECT * FROM ${PMO_TABLES.clickup_task_map} ORDER BY created_at DESC
    `).all() as Record<string, unknown>[]

    return rows.map((row) => this.rowToMap(row))
  }

  updateSyncTimestamp(ticketId: string): void {
    this.db.prepare(`
      UPDATE ${PMO_TABLES.clickup_task_map}
      SET last_synced_at = CURRENT_TIMESTAMP
      WHERE pmo_ticket_id = ?
    `).run(ticketId)
  }

  private rowToMap(row: Record<string, unknown>): ClickUpTaskMap {
    return {
      pmoTicketId: row.pmo_ticket_id as string,
      clickupTaskId: row.clickup_task_id as string,
      clickupListId: (row.clickup_list_id as string | null) ?? undefined,
      lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at as string) : undefined,
      createdAt: new Date(row.created_at as string),
    }
  }
}

/**
 * Notion Page ↔ PMO Ticket Mapper
 *
 * Stores bidirectional mapping between PMO ticket IDs and Notion page IDs.
 */

import type Database from 'better-sqlite3'
import { PMO_TABLES } from '../pmo/schema.js'
import type { NotionPageMap } from './types.js'
import { type DatabaseDriver, wrapDatabase } from '../database/driver.js'

function toDriver(dbOrDriver: DatabaseDriver | Database.Database): DatabaseDriver {
  if ('prepare' in dbOrDriver && 'pragma' in dbOrDriver && !('raw' in dbOrDriver)) {
    return wrapDatabase(dbOrDriver as Database.Database)
  }
  return dbOrDriver as DatabaseDriver
}

export class NotionMapper {
  private driver: DatabaseDriver

  constructor(dbOrDriver: DatabaseDriver | Database.Database) {
    this.driver = toDriver(dbOrDriver)
    this.ensureTable()
  }

  private ensureTable(): void {
    this.driver.exec(`
      CREATE TABLE IF NOT EXISTS ${PMO_TABLES.notion_page_map} (
        pmo_ticket_id TEXT NOT NULL REFERENCES ${PMO_TABLES.tickets}(id) ON DELETE CASCADE,
        notion_page_id TEXT NOT NULL,
        notion_database_id TEXT,
        last_synced_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (pmo_ticket_id),
        UNIQUE (notion_page_id)
      )
    `)

    this.driver.exec(`
      CREATE INDEX IF NOT EXISTS idx_pmo_notion_page_map_page_id
        ON ${PMO_TABLES.notion_page_map}(notion_page_id)
    `)
  }

  createOrUpdateMapping(pmoTicketId: string, notionPageId: string, notionDatabaseId?: string): void {
    this.driver.prepare(`
      INSERT INTO ${PMO_TABLES.notion_page_map}
        (pmo_ticket_id, notion_page_id, notion_database_id, last_synced_at, created_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(pmo_ticket_id) DO UPDATE SET
        notion_page_id = excluded.notion_page_id,
        notion_database_id = excluded.notion_database_id,
        last_synced_at = CURRENT_TIMESTAMP
    `).run(pmoTicketId, notionPageId, notionDatabaseId ?? null)
  }

  getByTicketId(ticketId: string): NotionPageMap | null {
    const row = this.driver.prepare<Record<string, unknown>>(`
      SELECT * FROM ${PMO_TABLES.notion_page_map} WHERE pmo_ticket_id = ?
    `).get(ticketId)

    return row ? this.rowToMap(row) : null
  }

  getByPageId(notionPageId: string): NotionPageMap | null {
    const row = this.driver.prepare<Record<string, unknown>>(`
      SELECT * FROM ${PMO_TABLES.notion_page_map} WHERE notion_page_id = ?
    `).get(notionPageId)

    return row ? this.rowToMap(row) : null
  }

  listMappings(): NotionPageMap[] {
    const rows = this.driver.prepare<Record<string, unknown>>(`
      SELECT * FROM ${PMO_TABLES.notion_page_map} ORDER BY created_at DESC
    `).all()

    return rows.map((row) => this.rowToMap(row))
  }

  updateSyncTimestamp(ticketId: string): void {
    this.driver.prepare(`
      UPDATE ${PMO_TABLES.notion_page_map}
      SET last_synced_at = CURRENT_TIMESTAMP
      WHERE pmo_ticket_id = ?
    `).run(ticketId)
  }

  private rowToMap(row: Record<string, unknown>): NotionPageMap {
    return {
      pmoTicketId: row.pmo_ticket_id as string,
      notionPageId: row.notion_page_id as string,
      notionDatabaseId: (row.notion_database_id as string | null) ?? undefined,
      lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at as string) : undefined,
      createdAt: new Date(row.created_at as string),
    }
  }
}

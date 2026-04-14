/**
 * Monday.com Item ↔ Ticket Mapper
 *
 * PRLT-1299: Simplified — FK to pmo_tickets removed since the local ticket
 * store is dead. The mapper still maintains its own mapping table for
 * outbound sync operations.
 */

import type Database from 'better-sqlite3'
import type { MondayItemMap } from './types.js'
import { type DatabaseDriver, wrapDatabase } from '../database/driver.js'

function toDriver(dbOrDriver: DatabaseDriver | Database.Database): DatabaseDriver {
  if ('prepare' in dbOrDriver && 'pragma' in dbOrDriver && !('raw' in dbOrDriver)) {
    return wrapDatabase(dbOrDriver as Database.Database)
  }
  return dbOrDriver as DatabaseDriver
}

export class MondayMapper {
  private driver: DatabaseDriver

  constructor(dbOrDriver: DatabaseDriver | Database.Database) {
    this.driver = toDriver(dbOrDriver)
    this.ensureTable()
  }

  private ensureTable(): void {
    // PRLT-1299: FK to pmo_tickets removed — tickets table no longer exists locally.
    this.driver.exec(`
      CREATE TABLE IF NOT EXISTS pmo_monday_item_map (
        pmo_ticket_id TEXT NOT NULL,
        monday_board_id TEXT NOT NULL,
        monday_item_id TEXT NOT NULL,
        monday_item_name TEXT,
        monday_item_url TEXT,
        sync_direction TEXT NOT NULL DEFAULT 'outbound',
        last_synced_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (pmo_ticket_id),
        UNIQUE (monday_item_id)
      )
    `)

    this.driver.exec(`
      CREATE INDEX IF NOT EXISTS idx_pmo_monday_item_map_item_id
        ON pmo_monday_item_map(monday_item_id)
    `)
  }

  createOrUpdateMapping(mapping: {
    pmoTicketId: string
    mondayBoardId: string
    mondayItemId: string
    mondayItemName: string
    mondayItemUrl?: string
    syncDirection: string
  }): void {
    this.driver.prepare(`
      INSERT INTO pmo_monday_item_map
        (pmo_ticket_id, monday_board_id, monday_item_id, monday_item_name, monday_item_url, sync_direction, last_synced_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(pmo_ticket_id) DO UPDATE SET
        monday_board_id = excluded.monday_board_id,
        monday_item_id = excluded.monday_item_id,
        monday_item_name = excluded.monday_item_name,
        monday_item_url = excluded.monday_item_url,
        sync_direction = excluded.sync_direction,
        last_synced_at = CURRENT_TIMESTAMP
    `).run(
      mapping.pmoTicketId,
      mapping.mondayBoardId,
      mapping.mondayItemId,
      mapping.mondayItemName,
      mapping.mondayItemUrl ?? null,
      mapping.syncDirection,
    )
  }

  getByTicketId(ticketId: string): MondayItemMap | null {
    const row = this.driver.prepare<Record<string, unknown>>(`
      SELECT * FROM pmo_monday_item_map WHERE pmo_ticket_id = ?
    `).get(ticketId)

    return row ? this.rowToMap(row) : null
  }

  getByItemId(mondayItemId: string): MondayItemMap | null {
    const row = this.driver.prepare<Record<string, unknown>>(`
      SELECT * FROM pmo_monday_item_map WHERE monday_item_id = ?
    `).get(mondayItemId)

    return row ? this.rowToMap(row) : null
  }

  listMappings(): MondayItemMap[] {
    const rows = this.driver.prepare<Record<string, unknown>>(`
      SELECT * FROM pmo_monday_item_map ORDER BY created_at DESC
    `).all()

    return rows.map((row) => this.rowToMap(row))
  }

  private rowToMap(row: Record<string, unknown>): MondayItemMap {
    return {
      pmoTicketId: row.pmo_ticket_id as string,
      mondayBoardId: row.monday_board_id as string,
      mondayItemId: row.monday_item_id as string,
      mondayItemName: (row.monday_item_name as string | null) ?? '',
      mondayItemUrl: (row.monday_item_url as string | null) ?? undefined,
      syncDirection: row.sync_direction as MondayItemMap['syncDirection'],
      lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at as string) : undefined,
      createdAt: new Date(row.created_at as string),
    }
  }
}

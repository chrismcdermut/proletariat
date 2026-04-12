import type Database from 'better-sqlite3'
import type { MondayItemMap } from './types.js'
import { type DatabaseDriver, wrapDatabase } from '../database/driver.js'

// Table name constant — this mapper manages its own table independently of the PMO schema.
const TABLE = 'pmo_monday_item_map'

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
    this.driver.exec(`
      CREATE TABLE IF NOT EXISTS ${TABLE} (
        pmo_ticket_id TEXT NOT NULL,
        monday_board_id TEXT NOT NULL,
        monday_item_id TEXT NOT NULL,
        monday_item_name TEXT NOT NULL,
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
      ON ${TABLE}(monday_item_id)
    `)

    this.driver.exec(`
      CREATE INDEX IF NOT EXISTS idx_pmo_monday_item_map_board_id
      ON ${TABLE}(monday_board_id)
    `)
  }

  createOrUpdateMapping(map: Omit<MondayItemMap, 'lastSyncedAt' | 'createdAt'>): void {
    this.driver.prepare(`
      INSERT INTO ${TABLE}
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
      map.pmoTicketId,
      map.mondayBoardId,
      map.mondayItemId,
      map.mondayItemName,
      map.mondayItemUrl ?? null,
      map.syncDirection,
    )
  }

  getByTicketId(ticketId: string): MondayItemMap | null {
    const row = this.driver.prepare<Record<string, unknown>>(`
      SELECT * FROM ${TABLE} WHERE pmo_ticket_id = ?
    `).get(ticketId)

    return row ? this.rowToMap(row) : null
  }

  getByMondayItemId(itemId: string): MondayItemMap | null {
    const row = this.driver.prepare<Record<string, unknown>>(`
      SELECT * FROM ${TABLE} WHERE monday_item_id = ?
    `).get(itemId)

    return row ? this.rowToMap(row) : null
  }

  listMappings(): MondayItemMap[] {
    const rows = this.driver.prepare<Record<string, unknown>>(`
      SELECT * FROM ${TABLE} ORDER BY created_at DESC
    `).all()

    return rows.map((row) => this.rowToMap(row))
  }

  updateSyncTimestamp(ticketId: string): void {
    this.driver.prepare(`
      UPDATE ${TABLE}
      SET last_synced_at = CURRENT_TIMESTAMP
      WHERE pmo_ticket_id = ?
    `).run(ticketId)
  }

  deleteMapping(ticketId: string): void {
    this.driver.prepare(`
      DELETE FROM ${TABLE}
      WHERE pmo_ticket_id = ?
    `).run(ticketId)
  }

  private rowToMap(row: Record<string, unknown>): MondayItemMap {
    return {
      pmoTicketId: row.pmo_ticket_id as string,
      mondayBoardId: row.monday_board_id as string,
      mondayItemId: row.monday_item_id as string,
      mondayItemName: row.monday_item_name as string,
      mondayItemUrl: (row.monday_item_url as string | null) ?? undefined,
      syncDirection: row.sync_direction as MondayItemMap['syncDirection'],
      lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at as string) : undefined,
      createdAt: new Date(row.created_at as string),
    }
  }
}

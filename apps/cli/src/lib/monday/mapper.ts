import type { SqliteDatabase } from '../database/sqlite.js'
import { PMO_TABLES } from '../pmo/schema.js'
import type { MondayItemMap } from './types.js'
import { type DatabaseDriver, wrapDatabase } from '../database/driver.js'

function toDriver(dbOrDriver: DatabaseDriver | SqliteDatabase): DatabaseDriver {
  if ('prepare' in dbOrDriver && 'pragma' in dbOrDriver && !('raw' in dbOrDriver)) {
    return wrapDatabase(dbOrDriver as SqliteDatabase)
  }
  return dbOrDriver as DatabaseDriver
}

export class MondayMapper {
  private driver: DatabaseDriver

  constructor(dbOrDriver: DatabaseDriver | SqliteDatabase) {
    this.driver = toDriver(dbOrDriver)
    this.ensureTable()
  }

  private ensureTable(): void {
    this.driver.exec(`
      CREATE TABLE IF NOT EXISTS ${PMO_TABLES.monday_item_map} (
        pmo_ticket_id TEXT NOT NULL REFERENCES ${PMO_TABLES.tickets}(id) ON DELETE CASCADE,
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
      ON ${PMO_TABLES.monday_item_map}(monday_item_id)
    `)

    this.driver.exec(`
      CREATE INDEX IF NOT EXISTS idx_pmo_monday_item_map_board_id
      ON ${PMO_TABLES.monday_item_map}(monday_board_id)
    `)
  }

  createOrUpdateMapping(map: Omit<MondayItemMap, 'lastSyncedAt' | 'createdAt'>): void {
    this.driver.prepare(`
      INSERT INTO ${PMO_TABLES.monday_item_map}
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
      SELECT * FROM ${PMO_TABLES.monday_item_map} WHERE pmo_ticket_id = ?
    `).get(ticketId)

    return row ? this.rowToMap(row) : null
  }

  getByMondayItemId(itemId: string): MondayItemMap | null {
    const row = this.driver.prepare<Record<string, unknown>>(`
      SELECT * FROM ${PMO_TABLES.monday_item_map} WHERE monday_item_id = ?
    `).get(itemId)

    return row ? this.rowToMap(row) : null
  }

  listMappings(): MondayItemMap[] {
    const rows = this.driver.prepare<Record<string, unknown>>(`
      SELECT * FROM ${PMO_TABLES.monday_item_map} ORDER BY created_at DESC
    `).all()

    return rows.map((row) => this.rowToMap(row))
  }

  updateSyncTimestamp(ticketId: string): void {
    this.driver.prepare(`
      UPDATE ${PMO_TABLES.monday_item_map}
      SET last_synced_at = CURRENT_TIMESTAMP
      WHERE pmo_ticket_id = ?
    `).run(ticketId)
  }

  deleteMapping(ticketId: string): void {
    this.driver.prepare(`
      DELETE FROM ${PMO_TABLES.monday_item_map}
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

import type Database from 'better-sqlite3'
import type { TrelloCardMap } from './types.js'
import { type DatabaseDriver, wrapDatabase } from '../database/driver.js'

const TABLE = 'pmo_trello_card_map'

function toDriver(dbOrDriver: DatabaseDriver | Database.Database): DatabaseDriver {
  if ('prepare' in dbOrDriver && 'pragma' in dbOrDriver && !('raw' in dbOrDriver)) {
    return wrapDatabase(dbOrDriver as Database.Database)
  }
  return dbOrDriver as DatabaseDriver
}

export class TrelloMapper {
  private driver: DatabaseDriver

  constructor(dbOrDriver: DatabaseDriver | Database.Database) {
    this.driver = toDriver(dbOrDriver)
    this.ensureTable()
  }

  private ensureTable(): void {
    this.driver.exec(`
      CREATE TABLE IF NOT EXISTS ${TABLE} (
        pmo_ticket_id TEXT NOT NULL,
        trello_card_id TEXT NOT NULL,
        trello_board_id TEXT,
        last_synced_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (pmo_ticket_id),
        UNIQUE (trello_card_id)
      )
    `)

    this.driver.exec(`
      CREATE INDEX IF NOT EXISTS idx_pmo_trello_card_map_card_id
        ON ${TABLE}(trello_card_id)
    `)
  }

  createOrUpdateMapping(pmoTicketId: string, trelloCardId: string, trelloBoardId?: string): void {
    this.driver.prepare(`
      INSERT INTO ${TABLE}
        (pmo_ticket_id, trello_card_id, trello_board_id, last_synced_at, created_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(pmo_ticket_id) DO UPDATE SET
        trello_card_id = excluded.trello_card_id,
        trello_board_id = excluded.trello_board_id,
        last_synced_at = CURRENT_TIMESTAMP
    `).run(pmoTicketId, trelloCardId, trelloBoardId ?? null)
  }

  getByTicketId(ticketId: string): TrelloCardMap | null {
    const row = this.driver.prepare<Record<string, unknown>>(`
      SELECT * FROM ${TABLE} WHERE pmo_ticket_id = ?
    `).get(ticketId)

    return row ? this.rowToMap(row) : null
  }

  getByCardId(trelloCardId: string): TrelloCardMap | null {
    const row = this.driver.prepare<Record<string, unknown>>(`
      SELECT * FROM ${TABLE} WHERE trello_card_id = ?
    `).get(trelloCardId)

    return row ? this.rowToMap(row) : null
  }

  listMappings(): TrelloCardMap[] {
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

  private rowToMap(row: Record<string, unknown>): TrelloCardMap {
    return {
      pmoTicketId: row.pmo_ticket_id as string,
      trelloCardId: row.trello_card_id as string,
      trelloBoardId: (row.trello_board_id as string | null) ?? undefined,
      lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at as string) : undefined,
      createdAt: new Date(row.created_at as string),
    }
  }
}

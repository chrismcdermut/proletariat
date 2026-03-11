import Database from 'better-sqlite3'
import { PMO_TABLES } from '../pmo/schema.js'
import type { TrelloCardMap } from './types.js'

export class TrelloMapper {
  constructor(private db: Database.Database) {
    this.ensureTable()
  }

  private ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${PMO_TABLES.trello_card_map} (
        pmo_ticket_id TEXT NOT NULL REFERENCES ${PMO_TABLES.tickets}(id) ON DELETE CASCADE,
        trello_card_id TEXT NOT NULL,
        trello_board_id TEXT,
        last_synced_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (pmo_ticket_id),
        UNIQUE (trello_card_id)
      )
    `)

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_pmo_trello_card_map_card_id
        ON ${PMO_TABLES.trello_card_map}(trello_card_id)
    `)
  }

  createOrUpdateMapping(pmoTicketId: string, trelloCardId: string, trelloBoardId?: string): void {
    this.db.prepare(`
      INSERT INTO ${PMO_TABLES.trello_card_map}
        (pmo_ticket_id, trello_card_id, trello_board_id, last_synced_at, created_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(pmo_ticket_id) DO UPDATE SET
        trello_card_id = excluded.trello_card_id,
        trello_board_id = excluded.trello_board_id,
        last_synced_at = CURRENT_TIMESTAMP
    `).run(pmoTicketId, trelloCardId, trelloBoardId ?? null)
  }

  getByTicketId(ticketId: string): TrelloCardMap | null {
    const row = this.db.prepare(`
      SELECT * FROM ${PMO_TABLES.trello_card_map} WHERE pmo_ticket_id = ?
    `).get(ticketId) as Record<string, unknown> | undefined

    return row ? this.rowToMap(row) : null
  }

  getByCardId(trelloCardId: string): TrelloCardMap | null {
    const row = this.db.prepare(`
      SELECT * FROM ${PMO_TABLES.trello_card_map} WHERE trello_card_id = ?
    `).get(trelloCardId) as Record<string, unknown> | undefined

    return row ? this.rowToMap(row) : null
  }

  listMappings(): TrelloCardMap[] {
    const rows = this.db.prepare(`
      SELECT * FROM ${PMO_TABLES.trello_card_map} ORDER BY created_at DESC
    `).all() as Record<string, unknown>[]

    return rows.map((row) => this.rowToMap(row))
  }

  updateSyncTimestamp(ticketId: string): void {
    this.db.prepare(`
      UPDATE ${PMO_TABLES.trello_card_map}
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

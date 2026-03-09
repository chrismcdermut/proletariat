import Database from 'better-sqlite3'
import { PMO_TABLES } from '../pmo/schema.js'

export interface ShortcutStoryMap {
  pmoTicketId: string
  shortcutStoryId: string
  shortcutWorkspaceSlug?: string
  lastSyncedAt?: Date
  createdAt: Date
}

export class ShortcutMapper {
  constructor(private db: Database.Database) {
    this.ensureTable()
  }

  private ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${PMO_TABLES.shortcut_story_map} (
        pmo_ticket_id TEXT NOT NULL REFERENCES ${PMO_TABLES.tickets}(id) ON DELETE CASCADE,
        shortcut_story_id TEXT NOT NULL,
        shortcut_workspace_slug TEXT,
        last_synced_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (pmo_ticket_id),
        UNIQUE (shortcut_story_id)
      )
    `)

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_pmo_shortcut_story_map_story_id
        ON ${PMO_TABLES.shortcut_story_map}(shortcut_story_id)
    `)
  }

  createOrUpdateMapping(pmoTicketId: string, shortcutStoryId: string, workspaceSlug?: string): void {
    this.db.prepare(`
      INSERT INTO ${PMO_TABLES.shortcut_story_map}
        (pmo_ticket_id, shortcut_story_id, shortcut_workspace_slug, last_synced_at, created_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(pmo_ticket_id) DO UPDATE SET
        shortcut_story_id = excluded.shortcut_story_id,
        shortcut_workspace_slug = excluded.shortcut_workspace_slug,
        last_synced_at = CURRENT_TIMESTAMP
    `).run(pmoTicketId, shortcutStoryId, workspaceSlug ?? null)
  }

  getByTicketId(ticketId: string): ShortcutStoryMap | null {
    const row = this.db.prepare(`
      SELECT * FROM ${PMO_TABLES.shortcut_story_map} WHERE pmo_ticket_id = ?
    `).get(ticketId) as Record<string, unknown> | undefined

    return row ? this.rowToMap(row) : null
  }

  getByStoryId(shortcutStoryId: string): ShortcutStoryMap | null {
    const row = this.db.prepare(`
      SELECT * FROM ${PMO_TABLES.shortcut_story_map} WHERE shortcut_story_id = ?
    `).get(shortcutStoryId) as Record<string, unknown> | undefined

    return row ? this.rowToMap(row) : null
  }

  listMappings(): ShortcutStoryMap[] {
    const rows = this.db.prepare(`
      SELECT * FROM ${PMO_TABLES.shortcut_story_map} ORDER BY created_at DESC
    `).all() as Record<string, unknown>[]

    return rows.map((row) => this.rowToMap(row))
  }

  updateSyncTimestamp(ticketId: string): void {
    this.db.prepare(`
      UPDATE ${PMO_TABLES.shortcut_story_map}
      SET last_synced_at = CURRENT_TIMESTAMP
      WHERE pmo_ticket_id = ?
    `).run(ticketId)
  }

  private rowToMap(row: Record<string, unknown>): ShortcutStoryMap {
    return {
      pmoTicketId: row.pmo_ticket_id as string,
      shortcutStoryId: row.shortcut_story_id as string,
      shortcutWorkspaceSlug: (row.shortcut_workspace_slug as string | null) ?? undefined,
      lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at as string) : undefined,
      createdAt: new Date(row.created_at as string),
    }
  }
}

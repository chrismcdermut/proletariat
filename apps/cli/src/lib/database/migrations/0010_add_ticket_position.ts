/**
 * Migration 0010 — Add position column to pmo_tickets
 *
 * Enables manual ticket ordering within status columns.
 * Backfills existing tickets with gapped positions (1000, 2000, ...)
 * ordered by priority then created_at.
 */

import type { SqliteDatabase } from '../sqlite.js'
import type { Migration } from '../migrator.js'

export const addTicketPosition: Migration = {
  id: '0010',
  name: 'add_ticket_position',
  up: (db: SqliteDatabase) => {
    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pmo_tickets'"
    ).get()
    if (!tableExists) return

    const tableInfo = db.prepare("PRAGMA table_info(pmo_tickets)").all() as { name: string }[]
    if (tableInfo.some(col => col.name === 'position')) {
      return // Column already exists
    }

    db.exec("ALTER TABLE pmo_tickets ADD COLUMN position INTEGER NOT NULL DEFAULT 0")
    db.exec("CREATE INDEX IF NOT EXISTS idx_pmo_tickets_status_position ON pmo_tickets(status_id, position)")

    // Backfill existing tickets with gapped positions per status
    const statuses = db.prepare(
      "SELECT DISTINCT status_id FROM pmo_tickets WHERE status_id IS NOT NULL"
    ).all() as { status_id: string }[]

    const getTicketsForStatus = db.prepare(`
      SELECT id FROM pmo_tickets WHERE status_id = ?
      ORDER BY
        CASE priority
          WHEN 'P0' THEN 0
          WHEN 'P1' THEN 1
          WHEN 'P2' THEN 2
          WHEN 'P3' THEN 3
          ELSE 4
        END,
        created_at ASC
    `)
    const updatePosition = db.prepare("UPDATE pmo_tickets SET position = ? WHERE id = ?")

    for (const { status_id } of statuses) {
      const tickets = getTicketsForStatus.all(status_id) as { id: string }[]
      tickets.forEach((ticket, idx) => {
        updatePosition.run((idx + 1) * 1000, ticket.id)
      })
    }
  },
}

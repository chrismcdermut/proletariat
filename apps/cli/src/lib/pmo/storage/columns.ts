/**
 * Column operations for board management.
 */

import { PMO_TABLES } from '../schema.js'
import { Column, PMOError, Ticket } from '../types.js'
import { slugify } from '../utils.js'
import { StorageContext, ColumnRow, TicketRow } from './types.js'
import { rowToTicket } from './helpers.js'
import { getMaxColumnPosition } from './base.js'

const T = PMO_TABLES

export class ColumnStorage {
  constructor(private ctx: StorageContext) {}

  /**
   * Get column names for a project.
   */
  getColumnNames(projectId: string): string[] {
    const rows = this.ctx.db.prepare(`
      SELECT name FROM ${T.columns}
      WHERE project_id = ?
      ORDER BY position
    `).all(projectId) as Array<{ name: string }>
    return rows.map((r) => r.name)
  }

  /**
   * Create a new column.
   */
  async createColumn(projectId: string, name: string, position?: number): Promise<Column> {
    const id = slugify(name)
    const pos = position ?? getMaxColumnPosition(this.ctx.db, projectId) + 1
    const now = Date.now()

    // Check for duplicate
    const existing = this.ctx.db.prepare(`
      SELECT id FROM ${T.columns}
      WHERE project_id = ? AND (id = ? OR name = ?)
    `).get(projectId, id, name) as { id: string } | undefined

    if (existing) {
      throw new PMOError('CONFLICT', `Column already exists: ${name}`)
    }

    // Shift columns if inserting at specific position
    if (position !== undefined) {
      this.ctx.db.prepare(`
        UPDATE ${T.columns}
        SET position = position + 1
        WHERE project_id = ? AND position >= ?
      `).run(projectId, position)
    }

    this.ctx.db.prepare(`
      INSERT INTO ${T.columns} (id, project_id, name, position, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, projectId, name, pos, now)

    this.ctx.updateBoardTimestamp(projectId)

    return {
      id,
      name,
      position: pos,
      tickets: [],
    }
  }

  /**
   * Rename a column.
   */
  async renameColumn(projectId: string, id: string, name: string): Promise<Column> {
    const existing = this.ctx.db.prepare(`
      SELECT * FROM ${T.columns}
      WHERE project_id = ? AND id = ?
    `).get(projectId, id) as ColumnRow | undefined

    if (!existing) {
      throw new PMOError('NOT_FOUND', `Column not found: ${id}`)
    }

    this.ctx.db.prepare(`
      UPDATE ${T.columns}
      SET name = ?
      WHERE project_id = ? AND id = ?
    `).run(name, projectId, id)

    this.ctx.updateBoardTimestamp(projectId)

    return {
      id,
      name,
      position: existing.position,
      tickets: await this.getTicketsForColumn(projectId, id),
    }
  }

  /**
   * Move a column to a new position.
   */
  async moveColumn(projectId: string, id: string, position: number): Promise<Column> {
    const existing = this.ctx.db.prepare(`
      SELECT * FROM ${T.columns}
      WHERE project_id = ? AND id = ?
    `).get(projectId, id) as ColumnRow | undefined

    if (!existing) {
      throw new PMOError('NOT_FOUND', `Column not found: ${id}`)
    }

    const oldPosition = existing.position

    if (position < oldPosition) {
      // Moving left
      this.ctx.db.prepare(`
        UPDATE ${T.columns}
        SET position = position + 1
        WHERE project_id = ? AND position >= ? AND position < ?
      `).run(projectId, position, oldPosition)
    } else if (position > oldPosition) {
      // Moving right
      this.ctx.db.prepare(`
        UPDATE ${T.columns}
        SET position = position - 1
        WHERE project_id = ? AND position > ? AND position <= ?
      `).run(projectId, oldPosition, position)
    }

    this.ctx.db.prepare(`
      UPDATE ${T.columns}
      SET position = ?
      WHERE project_id = ? AND id = ?
    `).run(position, projectId, id)

    this.ctx.updateBoardTimestamp(projectId)

    return {
      id,
      name: existing.name,
      position,
      tickets: await this.getTicketsForColumn(projectId, id),
    }
  }

  /**
   * Delete a column.
   */
  async deleteColumn(projectId: string, id: string, cascade?: boolean): Promise<void> {
    const existing = this.ctx.db.prepare(`
      SELECT * FROM ${T.columns}
      WHERE project_id = ? AND id = ?
    `).get(projectId, id) as ColumnRow | undefined

    if (!existing) {
      throw new PMOError('NOT_FOUND', `Column not found: ${id}`)
    }

    // Check for tickets
    const ticketCount = this.ctx.db.prepare(`
      SELECT COUNT(*) as count FROM ${T.board_tickets}
      WHERE project_id = ? AND column_id = ?
    `).get(projectId, id) as { count: number }

    if (ticketCount.count > 0 && !cascade) {
      throw new PMOError(
        'CONFLICT',
        `Column has ${ticketCount.count} ticket(s). Use cascade=true to delete.`
      )
    }

    // Delete board_tickets entries for this column
    if (cascade) {
      this.ctx.db.prepare(`
        DELETE FROM ${T.board_tickets}
        WHERE project_id = ? AND column_id = ?
      `).run(projectId, id)
    }

    // Delete column
    this.ctx.db.prepare(`
      DELETE FROM ${T.columns}
      WHERE project_id = ? AND id = ?
    `).run(projectId, id)

    // Shift remaining columns
    this.ctx.db.prepare(`
      UPDATE ${T.columns}
      SET position = position - 1
      WHERE project_id = ? AND position > ?
    `).run(projectId, existing.position)

    this.ctx.updateBoardTimestamp(projectId)
  }

  /**
   * Get tickets for a specific column.
   */
  async getTicketsForColumn(projectId: string, columnId: string): Promise<Ticket[]> {
    const rows = this.ctx.db.prepare(`
      SELECT t.*, bt.column_id, bt.position, c.name as column_name
      FROM ${T.tickets} t
      JOIN ${T.board_tickets} bt ON t.id = bt.ticket_id AND t.project_id = bt.project_id
      JOIN ${T.columns} c ON bt.project_id = c.project_id AND bt.column_id = c.id
      WHERE t.project_id = ? AND bt.column_id = ?
      ORDER BY bt.position
    `).all(projectId, columnId) as TicketRow[]

    return Promise.all(rows.map((row) => rowToTicket(this.ctx.db, row)))
  }
}

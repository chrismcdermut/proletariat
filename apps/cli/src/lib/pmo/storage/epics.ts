/**
 * Epic operations for PMO.
 */

import { PMO_TABLES } from '../schema.js'
import { Epic, EpicFilter, PMOError, Ticket } from '../types.js'
import { generateEntityId } from '../utils.js'
import { StorageContext, EpicRow, TicketRow } from './types.js'
import { rowToTicket } from './helpers.js'

const T = PMO_TABLES

export class EpicStorage {
  constructor(private ctx: StorageContext) {}

  /**
   * Create a new epic.
   */
  async createEpic(projectId: string, epic: Partial<Epic>): Promise<Epic> {
    const id = epic.id || generateEntityId(this.ctx.db, 'epic')
    const title = epic.title || 'Untitled Epic'
    const status = epic.status || 'active'
    const now = Date.now()

    // Get next position if not provided
    let position = epic.position
    if (position === undefined) {
      const maxPos = this.ctx.db.prepare(`
        SELECT COALESCE(MAX(position), -1) as max_pos FROM ${T.epics} WHERE project_id = ?
      `).get(projectId) as { max_pos: number }
      position = maxPos.max_pos + 1
    }

    this.ctx.db.prepare(`
      INSERT INTO ${T.epics} (id, project_id, title, description, status, position, file_path, spec_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      projectId,
      title,
      epic.description || null,
      status,
      position,
      epic.filePath || null,
      epic.specId || null,
      now,
      now
    )

    this.ctx.updateBoardTimestamp(projectId)

    return {
      id,
      projectId,
      title,
      description: epic.description,
      status,
      position,
      filePath: epic.filePath,
      specId: epic.specId,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    }
  }

  /**
   * Get an epic by ID.
   */
  async getEpic(id: string): Promise<Epic | null> {
    const row = this.ctx.db.prepare(`
      SELECT * FROM ${T.epics} WHERE id = ?
    `).get(id) as EpicRow | undefined

    if (!row) return null

    return this.rowToEpic(row)
  }

  /**
   * List epics with optional filters.
   */
  async listEpics(projectId: string, filter?: EpicFilter): Promise<Epic[]> {
    let query = `SELECT * FROM ${T.epics} WHERE project_id = ?`
    const params: unknown[] = [projectId]

    if (filter?.status) {
      query += ' AND status = ?'
      params.push(filter.status)
    }
    if (filter?.search) {
      query += ' AND (title LIKE ? OR description LIKE ?)'
      params.push(`%${filter.search}%`, `%${filter.search}%`)
    }

    query += ' ORDER BY position ASC, created_at ASC'

    const rows = this.ctx.db.prepare(query).all(...params) as EpicRow[]

    return rows.map((row) => this.rowToEpic(row))
  }

  /**
   * Reorder an epic to a new position.
   */
  async reorderEpic(projectId: string, epicId: string, newPosition: number): Promise<Epic> {
    const epic = await this.getEpic(epicId)
    if (!epic) {
      throw new Error(`Epic not found: ${epicId}`)
    }

    const oldPosition = epic.position
    if (oldPosition === newPosition) {
      return epic
    }

    if (newPosition < oldPosition) {
      this.ctx.db.prepare(`
        UPDATE ${T.epics}
        SET position = position + 1, updated_at = ?
        WHERE project_id = ? AND position >= ? AND position < ?
      `).run(Date.now(), projectId, newPosition, oldPosition)
    } else {
      this.ctx.db.prepare(`
        UPDATE ${T.epics}
        SET position = position - 1, updated_at = ?
        WHERE project_id = ? AND position > ? AND position <= ?
      `).run(Date.now(), projectId, oldPosition, newPosition)
    }

    this.ctx.db.prepare(`
      UPDATE ${T.epics}
      SET position = ?, updated_at = ?
      WHERE id = ?
    `).run(newPosition, Date.now(), epicId)

    this.ctx.updateBoardTimestamp(projectId)

    return (await this.getEpic(epicId))!
  }

  /**
   * Update an epic.
   */
  async updateEpic(id: string, changes: Partial<Epic>): Promise<Epic> {
    const epic = await this.getEpic(id)
    if (!epic) {
      throw new PMOError('NOT_FOUND', `Epic not found: ${id}`)
    }

    const updates: string[] = []
    const params: unknown[] = []

    if (changes.title !== undefined) {
      updates.push('title = ?')
      params.push(changes.title)
    }
    if (changes.description !== undefined) {
      updates.push('description = ?')
      params.push(changes.description)
    }
    if (changes.status !== undefined) {
      updates.push('status = ?')
      params.push(changes.status)
    }
    if (changes.filePath !== undefined) {
      updates.push('file_path = ?')
      params.push(changes.filePath)
    }
    if (changes.specId !== undefined) {
      updates.push('spec_id = ?')
      params.push(changes.specId || null)
    }

    if (updates.length > 0) {
      updates.push('updated_at = ?')
      params.push(Date.now())
      params.push(id)

      this.ctx.db.prepare(`UPDATE ${T.epics} SET ${updates.join(', ')} WHERE id = ?`).run(
        ...params
      )
    }

    this.ctx.updateBoardTimestamp(epic.projectId)
    return (await this.getEpic(id)) as Epic
  }

  /**
   * Delete an epic.
   */
  async deleteEpic(id: string): Promise<void> {
    const epic = await this.getEpic(id)
    if (!epic) {
      throw new PMOError('NOT_FOUND', `Epic not found: ${id}`)
    }

    // Unlink tickets from this epic
    this.ctx.db.prepare(`
      UPDATE ${T.tickets} SET epic_id = NULL WHERE epic_id = ?
    `).run(id)

    this.ctx.db.prepare(`DELETE FROM ${T.epics} WHERE id = ?`).run(id)
    this.ctx.updateBoardTimestamp(epic.projectId)
  }

  /**
   * Get tickets for an epic.
   */
  async getTicketsForEpic(projectId: string, epicId: string): Promise<Ticket[]> {
    const rows = this.ctx.db.prepare(`
      SELECT t.*,
             ws.id as column_id,
             ws.position as position,
             ws.name as column_name
      FROM ${T.tickets} t
      LEFT JOIN ${T.workflow_statuses} ws ON t.status_id = ws.id
      WHERE t.project_id = ? AND t.epic_id = ?
      ORDER BY ws.position,
        CASE t.priority
          WHEN 'P0' THEN 0
          WHEN 'P1' THEN 1
          WHEN 'P2' THEN 2
          WHEN 'P3' THEN 3
          ELSE 4
        END,
        t.created_at ASC
    `).all(projectId, epicId) as TicketRow[]

    return Promise.all(rows.map((row) => rowToTicket(this.ctx.db, row)))
  }

  /**
   * Link a ticket to an epic.
   */
  async linkTicketToEpic(ticketId: string, epicId: string): Promise<void> {
    // Verify ticket exists and get its project
    const ticket = this.ctx.db.prepare(`
      SELECT id, project_id FROM ${T.tickets} WHERE id = ?
    `).get(ticketId) as { id: string; project_id: string } | undefined
    if (!ticket) {
      throw new PMOError('NOT_FOUND', `Ticket not found: ${ticketId}`, ticketId)
    }

    // Verify epic exists
    const epic = await this.getEpic(epicId)
    if (!epic) {
      throw new PMOError('NOT_FOUND', `Epic not found: ${epicId}`)
    }

    this.ctx.db.prepare(`
      UPDATE ${T.tickets}
      SET epic_id = ?, updated_at = ?
      WHERE id = ?
    `).run(epicId, Date.now(), ticketId)

    this.ctx.updateBoardTimestamp(ticket.project_id)
  }

  /**
   * Unlink a ticket from its epic.
   */
  async unlinkTicketFromEpic(ticketId: string): Promise<void> {
    // Get ticket's project for board timestamp update
    const ticket = this.ctx.db.prepare(`
      SELECT project_id FROM ${T.tickets} WHERE id = ?
    `).get(ticketId) as { project_id: string } | undefined

    this.ctx.db.prepare(`
      UPDATE ${T.tickets}
      SET epic_id = NULL, updated_at = ?
      WHERE id = ?
    `).run(Date.now(), ticketId)

    if (ticket) {
      this.ctx.updateBoardTimestamp(ticket.project_id)
    }
  }

  private rowToEpic(row: EpicRow): Epic {
    return {
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      description: row.description || undefined,
      status: row.status as Epic['status'],
      position: row.position,
      filePath: row.file_path || undefined,
      specId: row.spec_id || undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }
  }
}

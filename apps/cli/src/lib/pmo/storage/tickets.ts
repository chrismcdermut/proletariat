/**
 * Ticket operations for PMO.
 */

import Database from 'better-sqlite3'
import { PMO_TABLES } from '../schema.js'
import { CreateTicketInput, PMOError, Ticket, TicketFilter } from '../types.js'
import { slugify, generateEntityId } from '../utils.js'
import { StorageContext, TicketRow } from './types.js'
import { rowToTicket } from './helpers.js'
import { getMaxTicketPosition } from './base.js'

const T = PMO_TABLES

export class TicketStorage {
  constructor(private ctx: StorageContext) {}

  /**
   * Create a new ticket.
   */
  async createTicket(ticket: CreateTicketInput): Promise<Ticket> {
    const id = ticket.id || generateEntityId(this.ctx.db, 'ticket')
    const title = ticket.title || 'Untitled'
    const projectId = this.ctx.getCurrentProjectId()

    // Get first column as default
    const firstColumn = this.ctx.db.prepare(`
      SELECT id FROM ${T.columns}
      WHERE project_id = ?
      ORDER BY position LIMIT 1
    `).get(projectId) as { id: string } | undefined

    if (!firstColumn) {
      throw new PMOError('NOT_FOUND', 'No columns exist. Initialize board first.')
    }

    const columnId = firstColumn.id
    const position = getMaxTicketPosition(this.ctx.db, projectId, columnId) + 1
    const now = Date.now()
    const specId = ticket.specId || null

    // Get status_id
    let statusId = ticket.statusId
    if (!statusId) {
      const defaultStatus = this.ctx.db.prepare(`
        SELECT id FROM ${T.statuses}
        WHERE project_id = ? AND is_default = 1
      `).get(projectId) as { id: string } | undefined

      if (defaultStatus) {
        statusId = defaultStatus.id
      } else {
        const firstStatus = this.ctx.db.prepare(`
          SELECT id FROM ${T.statuses}
          WHERE project_id = ?
          ORDER BY
            CASE category
              WHEN 'backlog' THEN 1
              WHEN 'unstarted' THEN 2
              WHEN 'started' THEN 3
              WHEN 'completed' THEN 4
              WHEN 'canceled' THEN 5
            END,
            position ASC
          LIMIT 1
        `).get(projectId) as { id: string } | undefined

        if (firstStatus) {
          statusId = firstStatus.id
        } else {
          throw new PMOError(
            'NOT_FOUND',
            'No statuses found. Apply a workflow template first.'
          )
        }
      }
    }

    // Insert ticket
    const labels = ticket.labels || []
    this.ctx.db.prepare(`
      INSERT INTO ${T.tickets} (
        id, project_id, title, description, priority, category,
        status_id, owner, assignee, spec_id, epic_id, labels,
        created_at, updated_at, last_synced_from_spec, last_synced_from_board
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      projectId,
      title,
      ticket.description || null,
      ticket.priority || null,
      ticket.category || null,
      statusId,
      ticket.owner || null,
      ticket.assignee || null,
      specId,
      ticket.epicId || null,
      JSON.stringify(labels),
      now,
      now,
      ticket.lastSyncedFromSpec || null,
      ticket.lastSyncedFromBoard || null
    )

    // Insert into board_tickets
    this.ctx.db.prepare(`
      INSERT INTO ${T.board_tickets} (project_id, ticket_id, column_id, position)
      VALUES (?, ?, ?, ?)
    `).run(projectId, id, columnId, position)

    // Insert subtasks
    if (ticket.subtasks && ticket.subtasks.length > 0) {
      const insertSubtask = this.ctx.db.prepare(`
        INSERT INTO ${T.subtasks} (id, ticket_id, title, done, position)
        VALUES (?, ?, ?, ?, ?)
      `)
      ticket.subtasks.forEach((st, idx) => {
        insertSubtask.run(st.id || slugify(st.title), id, st.title, st.done ? 1 : 0, idx)
      })
    }

    // Insert metadata
    if (ticket.metadata) {
      const insertMeta = this.ctx.db.prepare(`
        INSERT INTO ${T.ticket_metadata} (ticket_id, key, value)
        VALUES (?, ?, ?)
      `)
      for (const [key, value] of Object.entries(ticket.metadata)) {
        insertMeta.run(id, key, value)
      }
    }

    this.ctx.updateBoardTimestamp()

    return (await this.getTicketById(id)) as Ticket
  }

  /**
   * Get a ticket by ID.
   */
  async getTicket(id: string): Promise<Ticket | null> {
    return this.getTicketById(id)
  }

  /**
   * Get a ticket by ID (internal).
   */
  async getTicketById(id: string): Promise<Ticket | null> {
    const projectId = this.ctx.getCurrentProjectId()
    const row = this.ctx.db.prepare(`
      SELECT t.*, bt.column_id, bt.position, c.name as column_name
      FROM ${T.tickets} t
      LEFT JOIN ${T.board_tickets} bt ON t.id = bt.ticket_id AND t.project_id = bt.project_id
      LEFT JOIN ${T.columns} c ON bt.project_id = c.project_id AND bt.column_id = c.id
      WHERE t.project_id = ? AND LOWER(t.id) = LOWER(?)
    `).get(projectId, id) as TicketRow | undefined

    if (!row) return null

    return rowToTicket(this.ctx.db, row)
  }

  /**
   * Update a ticket.
   */
  async updateTicket(id: string, changes: Partial<Ticket>): Promise<Ticket> {
    const existing = await this.getTicketById(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Ticket not found: ${id}`, id)
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
    if (changes.priority !== undefined) {
      updates.push('priority = ?')
      params.push(changes.priority)
    }
    if (changes.category !== undefined) {
      updates.push('category = ?')
      params.push(changes.category)
    }
    if (changes.statusId !== undefined) {
      updates.push('status_id = ?')
      params.push(changes.statusId)
    }
    if (changes.owner !== undefined) {
      updates.push('owner = ?')
      params.push(changes.owner)
    }
    if (changes.assignee !== undefined) {
      updates.push('assignee = ?')
      params.push(changes.assignee)
    }
    if (changes.branch !== undefined) {
      updates.push('branch = ?')
      params.push(changes.branch)
    }
    if (changes.specId !== undefined) {
      updates.push('spec_id = ?')
      params.push(changes.specId)
    }
    if (changes.lastSyncedFromSpec !== undefined) {
      updates.push('last_synced_from_spec = ?')
      params.push(changes.lastSyncedFromSpec)
    }
    if (changes.lastSyncedFromBoard !== undefined) {
      updates.push('last_synced_from_board = ?')
      params.push(changes.lastSyncedFromBoard)
    }
    if (changes.labels !== undefined) {
      updates.push('labels = ?')
      params.push(JSON.stringify(changes.labels))
    }

    if (updates.length > 0) {
      updates.push('updated_at = ?')
      params.push(Date.now())
      params.push(id)

      this.ctx.db.prepare(`UPDATE ${T.tickets} SET ${updates.join(', ')} WHERE id = ?`).run(
        ...params
      )
    }

    // Update subtasks if provided
    if (changes.subtasks !== undefined) {
      this.ctx.db.prepare(`DELETE FROM ${T.subtasks} WHERE ticket_id = ?`).run(id)
      const insertSubtask = this.ctx.db.prepare(`
        INSERT INTO ${T.subtasks} (id, ticket_id, title, done, position)
        VALUES (?, ?, ?, ?, ?)
      `)
      changes.subtasks.forEach((st, idx) => {
        insertSubtask.run(st.id || slugify(st.title), id, st.title, st.done ? 1 : 0, idx)
      })
    }

    // Update metadata if provided
    if (changes.metadata !== undefined) {
      this.ctx.db.prepare(`DELETE FROM ${T.ticket_metadata} WHERE ticket_id = ?`).run(id)
      const insertMeta = this.ctx.db.prepare(`
        INSERT INTO ${T.ticket_metadata} (ticket_id, key, value)
        VALUES (?, ?, ?)
      `)
      for (const [key, value] of Object.entries(changes.metadata)) {
        insertMeta.run(id, key, value)
      }
    }

    this.ctx.updateBoardTimestamp()

    return (await this.getTicketById(id)) as Ticket
  }

  /**
   * Move a ticket to a different column/position.
   */
  async moveTicket(id: string, column: string, position?: number): Promise<Ticket> {
    const projectId = this.ctx.getCurrentProjectId()
    const existing = await this.getTicketById(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Ticket not found: ${id}`, id)
    }

    // Find target column
    const targetColumn = this.ctx.db.prepare(`
      SELECT id FROM ${T.columns}
      WHERE project_id = ? AND (id = ? OR name = ?)
    `).get(projectId, column, column) as { id: string } | undefined

    if (!targetColumn) {
      throw new PMOError('NOT_FOUND', `Column not found: ${column}`)
    }

    const targetColumnId = targetColumn.id
    const pos = position ?? getMaxTicketPosition(this.ctx.db, projectId, targetColumnId) + 1

    // Get current position
    const currentBoardPos = this.ctx.db.prepare(`
      SELECT column_id, position FROM ${T.board_tickets}
      WHERE project_id = ? AND ticket_id = ?
    `).get(projectId, id) as { column_id: string; position: number } | undefined

    if (!currentBoardPos) {
      throw new PMOError('NOT_FOUND', `Board position not found for ticket: ${id}`)
    }

    // Adjust positions
    if (currentBoardPos.column_id === targetColumnId) {
      if (pos < currentBoardPos.position) {
        this.ctx.db.prepare(`
          UPDATE ${T.board_tickets}
          SET position = position + 1
          WHERE project_id = ? AND column_id = ? AND position >= ? AND position < ?
        `).run(projectId, targetColumnId, pos, currentBoardPos.position)
      } else if (pos > currentBoardPos.position) {
        this.ctx.db.prepare(`
          UPDATE ${T.board_tickets}
          SET position = position - 1
          WHERE project_id = ? AND column_id = ? AND position > ? AND position <= ?
        `).run(projectId, targetColumnId, currentBoardPos.position, pos)
      }
    } else {
      // Moving to different column
      this.ctx.db.prepare(`
        UPDATE ${T.board_tickets}
        SET position = position - 1
        WHERE project_id = ? AND column_id = ? AND position > ?
      `).run(projectId, currentBoardPos.column_id, currentBoardPos.position)

      this.ctx.db.prepare(`
        UPDATE ${T.board_tickets}
        SET position = position + 1
        WHERE project_id = ? AND column_id = ? AND position >= ?
      `).run(projectId, targetColumnId, pos)
    }

    // Update board position
    this.ctx.db.prepare(`
      UPDATE ${T.board_tickets}
      SET column_id = ?, position = ?
      WHERE project_id = ? AND ticket_id = ?
    `).run(targetColumnId, pos, projectId, id)

    // Update status if matching
    const matchingStatus = this.ctx.db.prepare(`
      SELECT id FROM ${T.statuses}
      WHERE project_id = ? AND LOWER(name) = LOWER(?)
    `).get(projectId, column) as { id: string } | undefined

    if (matchingStatus) {
      this.ctx.db.prepare(`
        UPDATE ${T.tickets}
        SET updated_at = ?, status_id = ?
        WHERE id = ?
      `).run(Date.now(), matchingStatus.id, id)
    } else {
      this.ctx.db.prepare(`
        UPDATE ${T.tickets}
        SET updated_at = ?
        WHERE id = ?
      `).run(Date.now(), id)
    }

    this.ctx.updateBoardTimestamp()

    return (await this.getTicketById(id)) as Ticket
  }

  /**
   * Delete a ticket.
   */
  async deleteTicket(id: string): Promise<void> {
    const projectId = this.ctx.getCurrentProjectId()
    const existing = await this.getTicketById(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Ticket not found: ${id}`, id)
    }

    // Get board position before deleting
    const boardPos = this.ctx.db.prepare(`
      SELECT column_id, position FROM ${T.board_tickets}
      WHERE project_id = ? AND ticket_id = ?
    `).get(projectId, id) as { column_id: string; position: number } | undefined

    // Delete ticket
    const result = this.ctx.db.prepare(`
      DELETE FROM ${T.tickets}
      WHERE project_id = ? AND id = ?
    `).run(projectId, id)

    if (result.changes === 0) {
      throw new PMOError('NOT_FOUND', `Ticket not found: ${id}`, id)
    }

    // Shift positions
    if (boardPos) {
      this.ctx.db.prepare(`
        UPDATE ${T.board_tickets}
        SET position = position - 1
        WHERE project_id = ? AND column_id = ? AND position > ?
      `).run(projectId, boardPos.column_id, boardPos.position)
    }

    this.ctx.updateBoardTimestamp()
  }

  /**
   * List tickets with optional filters.
   */
  async listTickets(filter?: TicketFilter): Promise<Ticket[]> {
    const params: unknown[] = []

    // Build the base query - determine project scope
    let query = `
      SELECT t.*, bt.column_id, bt.position, c.name as column_name, p.name as project_name
      FROM ${T.tickets} t
      LEFT JOIN ${T.board_tickets} bt ON t.id = bt.ticket_id AND t.project_id = bt.project_id
      LEFT JOIN ${T.columns} c ON bt.project_id = c.project_id AND bt.column_id = c.id
      LEFT JOIN ${T.statuses} s ON t.status_id = s.id
      LEFT JOIN ${T.projects} p ON t.project_id = p.id
      WHERE 1=1
    `

    // Apply project scoping
    if (filter?.allProjects) {
      // No project filter - list all tickets across all projects
    } else if (filter?.projectId) {
      // Filter to a specific project
      query += ' AND t.project_id = ?'
      params.push(filter.projectId)
    } else {
      // Default: filter to current project
      query += ' AND t.project_id = ?'
      params.push(this.ctx.getCurrentProjectId())
    }

    if (filter?.statusId) {
      query += ' AND t.status_id = ?'
      params.push(filter.statusId)
    }
    if (filter?.statusCategory) {
      query += ' AND s.category = ?'
      params.push(filter.statusCategory)
    }
    if (filter?.priority) {
      query += ' AND t.priority = ?'
      params.push(filter.priority)
    }
    if (filter?.category) {
      query += ' AND t.category = ?'
      params.push(filter.category)
    }
    if (filter?.owner) {
      query += ' AND t.owner = ?'
      params.push(filter.owner)
    }
    if (filter?.assignee) {
      query += ' AND t.assignee = ?'
      params.push(filter.assignee)
    }
    if (filter?.search) {
      query += ' AND (t.title LIKE ? OR t.description LIKE ?)'
      params.push(`%${filter.search}%`, `%${filter.search}%`)
    }
    if (filter?.spec) {
      query += ' AND t.spec_id = ?'
      params.push(filter.spec)
    }
    if (filter?.epic) {
      query += ' AND t.epic_id = ?'
      params.push(filter.epic)
    }
    if (filter?.column) {
      query += ' AND c.name = ?'
      params.push(filter.column)
    }

    // Order by project first when listing all projects, then by column and position
    if (filter?.allProjects) {
      query += ' ORDER BY p.name, c.position, bt.position'
    } else {
      query += ' ORDER BY c.position, bt.position'
    }

    const rows = this.ctx.db.prepare(query).all(...params) as TicketRow[]

    return Promise.all(rows.map((row) => rowToTicket(this.ctx.db, row)))
  }
}

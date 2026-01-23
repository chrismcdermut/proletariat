/**
 * Ticket operations for PMO.
 * Tickets reference workflow statuses directly via status_id.
 * Board position is derived from priority and created_at (no separate board_tickets table).
 */

import { PMO_TABLES } from '../schema.js'
import { CreateTicketInput, PMOError, Ticket, TicketFilter } from '../types.js'
import { slugify, generateEntityId } from '../utils.js'
import { StorageContext, TicketRow } from './types.js'
import { rowToTicket } from './helpers.js'

const T = PMO_TABLES

export class TicketStorage {
  constructor(private ctx: StorageContext) {}

  /**
   * Create a new ticket.
   * Gets default status from the project's workflow.
   */
  async createTicket(projectId: string, ticket: CreateTicketInput): Promise<Ticket> {
    const id = ticket.id || generateEntityId(this.ctx.db, 'ticket')
    const title = ticket.title || 'Untitled'
    const now = Date.now()
    const specId = ticket.specId || null

    // Get status_id from project's workflow
    let statusId = ticket.statusId

    // Get the project's workflow
    const project = this.ctx.db.prepare(`
      SELECT workflow_id FROM ${T.projects} WHERE id = ?
    `).get(projectId) as { workflow_id: string | null } | undefined

    if (!project) {
      throw new PMOError('NOT_FOUND', `Project not found: ${projectId}`)
    }

    const workflowId = project.workflow_id || 'default'

    // If statusName is provided, look up status by name
    if (!statusId && ticket.statusName) {
      const namedStatus = this.ctx.db.prepare(`
        SELECT id FROM ${T.workflow_statuses}
        WHERE workflow_id = ? AND LOWER(name) = LOWER(?)
      `).get(workflowId, ticket.statusName) as { id: string } | undefined

      if (namedStatus) {
        statusId = namedStatus.id
      }
    }

    if (!statusId) {
      // Get default status from workflow
      const defaultStatus = this.ctx.db.prepare(`
        SELECT id FROM ${T.workflow_statuses}
        WHERE workflow_id = ? AND is_default = 1
      `).get(workflowId) as { id: string } | undefined

      if (defaultStatus) {
        statusId = defaultStatus.id
      } else {
        // Fall back to first status in workflow (by category then position)
        const firstStatus = this.ctx.db.prepare(`
          SELECT id FROM ${T.workflow_statuses}
          WHERE workflow_id = ?
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
        `).get(workflowId) as { id: string } | undefined

        if (firstStatus) {
          statusId = firstStatus.id
        } else {
          throw new PMOError(
            'NOT_FOUND',
            'No statuses found in workflow. Apply a workflow template first.'
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

    this.ctx.updateBoardTimestamp(projectId)

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
   * Looks up by ticket ID only - no project scoping required since ticket IDs are globally unique.
   * Joins workflow_statuses to get column name (status name is the column).
   */
  async getTicketById(id: string): Promise<Ticket | null> {
    const row = this.ctx.db.prepare(`
      SELECT t.*,
             ws.id as column_id,
             ws.position as position,
             ws.name as column_name
      FROM ${T.tickets} t
      LEFT JOIN ${T.workflow_statuses} ws ON t.status_id = ws.id
      WHERE LOWER(t.id) = LOWER(?)
    `).get(id) as TicketRow | undefined

    if (!row) return null

    return rowToTicket(this.ctx.db, row)
  }

  /**
   * Update a ticket.
   * Works with ticket ID only - no project context required since ticket IDs are globally unique.
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

    // Update board timestamp for the ticket's actual project
    if (existing.projectId) {
      this.updateProjectTimestamp(existing.projectId)
    }

    return (await this.getTicketById(id)) as Ticket
  }

  /**
   * Update the timestamp for a specific project.
   */
  private updateProjectTimestamp(projectId: string): void {
    this.ctx.db.prepare(`
      UPDATE ${T.projects}
      SET updated_at = ?
      WHERE id = ?
    `).run(Date.now(), projectId)
  }

  /**
   * Move a ticket to a different status (column).
   * In the workflow-based system, columns ARE statuses.
   * The position parameter is ignored - tickets are sorted by priority then created_at.
   */
  async moveTicket(projectId: string, id: string, column: string, _position?: number): Promise<Ticket> {
    const existing = await this.getTicketById(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Ticket not found: ${id}`, id)
    }

    // Get project's workflow
    const project = this.ctx.db.prepare(`
      SELECT workflow_id FROM ${T.projects} WHERE id = ?
    `).get(projectId) as { workflow_id: string | null } | undefined

    if (!project) {
      throw new PMOError('NOT_FOUND', `Project not found: ${projectId}`)
    }

    const workflowId = project.workflow_id || 'default'

    // Find target status by ID or name
    const targetStatus = this.ctx.db.prepare(`
      SELECT id FROM ${T.workflow_statuses}
      WHERE workflow_id = ? AND (id = ? OR LOWER(name) = LOWER(?))
    `).get(workflowId, column, column) as { id: string } | undefined

    if (!targetStatus) {
      throw new PMOError('NOT_FOUND', `Status not found: ${column}`)
    }

    // Update ticket's status_id
    this.ctx.db.prepare(`
      UPDATE ${T.tickets}
      SET status_id = ?, updated_at = ?
      WHERE id = ?
    `).run(targetStatus.id, Date.now(), id)

    this.ctx.updateBoardTimestamp(projectId)

    return (await this.getTicketById(id)) as Ticket
  }

  /**
   * Delete a ticket.
   * Works with ticket ID only - no project context required since ticket IDs are globally unique.
   */
  async deleteTicket(id: string): Promise<void> {
    const existing = await this.getTicketById(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Ticket not found: ${id}`, id)
    }

    const ticketProjectId = existing.projectId
    if (!ticketProjectId) {
      throw new PMOError('INVALID', `Ticket ${id} has no associated project`, id)
    }

    // Delete ticket (by ID only, since IDs are globally unique)
    // Related data (subtasks, metadata) are deleted via CASCADE
    const result = this.ctx.db.prepare(`
      DELETE FROM ${T.tickets}
      WHERE id = ?
    `).run(id)

    if (result.changes === 0) {
      throw new PMOError('NOT_FOUND', `Ticket not found: ${id}`, id)
    }

    // Update board timestamp for the ticket's project
    this.updateProjectTimestamp(ticketProjectId)
  }

  /**
   * List tickets with optional filters.
   * @param projectId - The project to filter by. Pass undefined to list all tickets across all projects.
   * @param filter - Additional filters to apply.
   */
  async listTickets(projectId: string | undefined, filter?: TicketFilter): Promise<Ticket[]> {
    const params: unknown[] = []

    // Build the base query using workflow_statuses
    let query = `
      SELECT t.*,
             ws.id as column_id,
             ws.position as position,
             ws.name as column_name,
             p.name as project_name
      FROM ${T.tickets} t
      LEFT JOIN ${T.workflow_statuses} ws ON t.status_id = ws.id
      LEFT JOIN ${T.projects} p ON t.project_id = p.id
      WHERE 1=1
    `

    // Apply project scoping
    if (projectId !== undefined) {
      query += ' AND t.project_id = ?'
      params.push(projectId)
    }
    // If projectId is undefined, list all tickets across all projects

    if (filter?.statusId) {
      query += ' AND t.status_id = ?'
      params.push(filter.statusId)
    }
    if (filter?.statusCategory) {
      query += ' AND ws.category = ?'
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
      // Column filter now uses status name
      query += ' AND ws.name = ?'
      params.push(filter.column)
    }

    // Order by project, then status position, then priority, then created_at
    if (projectId === undefined) {
      query += ` ORDER BY p.name, ws.position,
        CASE t.priority
          WHEN 'P0' THEN 0
          WHEN 'P1' THEN 1
          WHEN 'P2' THEN 2
          WHEN 'P3' THEN 3
          ELSE 4
        END,
        t.created_at ASC`
    } else {
      query += ` ORDER BY ws.position,
        CASE t.priority
          WHEN 'P0' THEN 0
          WHEN 'P1' THEN 1
          WHEN 'P2' THEN 2
          WHEN 'P3' THEN 3
          ELSE 4
        END,
        t.created_at ASC`
    }

    const rows = this.ctx.db.prepare(query).all(...params) as TicketRow[]

    return Promise.all(rows.map((row) => rowToTicket(this.ctx.db, row)))
  }

  /**
   * Move a ticket to a different project.
   * The ticket will get the default status from the target project's workflow.
   */
  async moveTicketToProject(ticketId: string, newProjectId: string): Promise<Ticket> {
    const existing = await this.getTicketById(ticketId)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Ticket not found: ${ticketId}`, ticketId)
    }

    const oldProjectId = existing.projectId
    if (!oldProjectId) {
      throw new PMOError('INVALID', `Ticket ${ticketId} has no associated project`, ticketId)
    }

    // Check if target project exists and get its workflow
    const targetProject = this.ctx.db.prepare(`
      SELECT id, workflow_id FROM ${T.projects} WHERE id = ?
    `).get(newProjectId) as { id: string; workflow_id: string | null } | undefined

    if (!targetProject) {
      throw new PMOError('NOT_FOUND', `Project not found: ${newProjectId}`, newProjectId)
    }

    const workflowId = targetProject.workflow_id || 'default'

    // Get default status for target project's workflow
    let newStatusId: string | undefined
    const defaultStatus = this.ctx.db.prepare(`
      SELECT id FROM ${T.workflow_statuses}
      WHERE workflow_id = ? AND is_default = 1
    `).get(workflowId) as { id: string } | undefined

    if (defaultStatus) {
      newStatusId = defaultStatus.id
    } else {
      // Get first status in workflow
      const firstStatus = this.ctx.db.prepare(`
        SELECT id FROM ${T.workflow_statuses}
        WHERE workflow_id = ?
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
      `).get(workflowId) as { id: string } | undefined

      if (firstStatus) {
        newStatusId = firstStatus.id
      }
    }

    // Update ticket's project_id and status_id
    const now = Date.now()
    this.ctx.db.prepare(`
      UPDATE ${T.tickets}
      SET project_id = ?, status_id = ?, updated_at = ?
      WHERE id = ?
    `).run(newProjectId, newStatusId || existing.statusId, now, ticketId)

    // Update timestamps for both projects
    this.updateProjectTimestamp(oldProjectId)
    this.updateProjectTimestamp(newProjectId)

    return (await this.getTicketById(ticketId)) as Ticket
  }
}

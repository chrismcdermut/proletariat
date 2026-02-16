/**
 * Ticket operations for PMO.
 * Tickets reference workflow statuses directly via status_id.
 * Tickets have a position column for force-ranked ordering within a status.
 * Positions use gapped integers (1000, 2000, 3000...) for stable reordering.
 */

import { PMO_TABLES } from '../schema.js'
import { CreateTicketInput, PMOError, Ticket, TicketFilter } from '../types.js'
import { slugify, generateEntityId } from '../utils.js'
import { StorageContext, TicketRow } from './types.js'
import { rowToTicket, wrapSqliteError } from './helpers.js'

const T = PMO_TABLES

export class TicketStorage {
  constructor(private ctx: StorageContext) {}

  /**
   * Validate a category against the DB.
   * Returns the valid category name if found, throws error if invalid.
   */
  private async validateCategory(category: string | null | undefined): Promise<string | null> {
    if (!category) return null

    // Check if category exists in DB for ticket type
    const row = this.ctx.db.prepare(`
      SELECT name FROM ${T.categories} WHERE LOWER(name) = LOWER(?) AND type = 'ticket'
    `).get(category) as { name: string } | undefined

    if (!row) {
      // Get valid categories for error message
      const validCategories = this.ctx.db.prepare(`
        SELECT name FROM ${T.categories} WHERE type = 'ticket' ORDER BY position
      `).all() as Array<{ name: string }>

      const validNames = validCategories.map(c => c.name).join(', ')
      throw new PMOError(
        'INVALID',
        `Invalid category "${category}". Valid categories: ${validNames}`
      )
    }

    return row.name
  }

  /**
   * Resolve a project identifier to its actual ID.
   * Tries multiple strategies:
   * 1. Exact ID match
   * 2. Case-insensitive ID match
   * 3. Exact name match
   * 4. Case-insensitive name match
   * 5. Slugified name match
   */
  private resolveProjectId(identifier: string): string | null {
    if (!identifier) return null

    // 1. Exact ID match
    const exactMatch = this.ctx.db.prepare(`
      SELECT id FROM ${T.projects} WHERE id = ?
    `).get(identifier) as { id: string } | undefined
    if (exactMatch) return exactMatch.id

    // 2. Case-insensitive ID match
    const caseInsensitiveId = this.ctx.db.prepare(`
      SELECT id FROM ${T.projects} WHERE LOWER(id) = LOWER(?)
    `).get(identifier) as { id: string } | undefined
    if (caseInsensitiveId) return caseInsensitiveId.id

    // 3. Exact name match
    const nameMatch = this.ctx.db.prepare(`
      SELECT id FROM ${T.projects} WHERE name = ?
    `).get(identifier) as { id: string } | undefined
    if (nameMatch) return nameMatch.id

    // 4. Case-insensitive name match
    const caseInsensitiveName = this.ctx.db.prepare(`
      SELECT id FROM ${T.projects} WHERE LOWER(name) = LOWER(?)
    `).get(identifier) as { id: string } | undefined
    if (caseInsensitiveName) return caseInsensitiveName.id

    // 5. Slugified name match
    const allProjects = this.ctx.db.prepare(`
      SELECT id, name FROM ${T.projects}
    `).all() as Array<{ id: string; name: string }>

    const identifierLower = identifier.toLowerCase()
    for (const project of allProjects) {
      const projectSlug = slugify(project.name)
      if (projectSlug === identifierLower || projectSlug === identifier) {
        return project.id
      }
    }

    return null
  }

  /**
   * Create a new ticket.
   * Gets default status from the project's workflow.
   */
  async createTicket(projectId: string, ticket: CreateTicketInput): Promise<Ticket> {
    const id = ticket.id || generateEntityId(this.ctx.db, 'ticket')
    const title = ticket.title || 'Untitled'
    const now = Date.now()
    const specId = ticket.specId || null

    // Validate category against DB
    const validatedCategory = await this.validateCategory(ticket.category)

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

    // Get next position for the target status (append to end with gapped integer)
    const maxPos = this.ctx.db.prepare(`
      SELECT COALESCE(MAX(position), 0) as max_pos FROM ${T.tickets} WHERE status_id = ?
    `).get(statusId) as { max_pos: number }
    const position = maxPos.max_pos + 1000

    // Insert ticket
    const labels = ticket.labels || []
    try {
      this.ctx.db.prepare(`
        INSERT INTO ${T.tickets} (
          id, project_id, title, description, priority, category,
          status_id, owner, assignee, spec_id, epic_id, labels,
          position, created_at, updated_at, last_synced_from_spec, last_synced_from_board
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        projectId,
        title,
        ticket.description || null,
        ticket.priority || null,
        validatedCategory,
        statusId,
        ticket.owner || null,
        ticket.assignee || null,
        specId,
        ticket.epicId || null,
        JSON.stringify(labels),
        position,
        now,
        now,
        ticket.lastSyncedFromSpec || null,
        ticket.lastSyncedFromBoard || null
      )
    } catch (err) {
      wrapSqliteError('Ticket', 'create', err)
    }

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
             t.position as position,
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

    // Validate category if being updated
    let validatedCategory: string | null | undefined
    if (changes.category !== undefined) {
      validatedCategory = await this.validateCategory(changes.category)
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
    if (validatedCategory !== undefined) {
      updates.push('category = ?')
      params.push(validatedCategory)
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
   * If position is provided, the ticket is placed at that position.
   * Otherwise, the ticket is appended to the end of the target status.
   */
  async moveTicket(projectId: string, id: string, column: string, position?: number): Promise<Ticket> {
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

    // Determine position: use provided or append to end
    let newPosition: number
    if (position !== undefined) {
      newPosition = position
    } else {
      const maxPos = this.ctx.db.prepare(`
        SELECT COALESCE(MAX(position), 0) as max_pos FROM ${T.tickets} WHERE status_id = ?
      `).get(targetStatus.id) as { max_pos: number }
      newPosition = maxPos.max_pos + 1000
    }

    // Update ticket's status_id and position
    this.ctx.db.prepare(`
      UPDATE ${T.tickets}
      SET status_id = ?, position = ?, updated_at = ?
      WHERE id = ?
    `).run(targetStatus.id, newPosition, Date.now(), id)

    this.ctx.updateBoardTimestamp(projectId)

    return (await this.getTicketById(id)) as Ticket
  }

  /**
   * Reorder a ticket within its current status.
   * Supports two modes:
   * 1. Direct position: set ticket to a specific position value
   * 2. After ticket: place ticket immediately after another ticket
   */
  async reorderTicket(id: string, opts: { position?: number; afterTicketId?: string }): Promise<Ticket> {
    const existing = await this.getTicketById(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Ticket not found: ${id}`, id)
    }

    let newPosition: number

    if (opts.afterTicketId) {
      // Place after the specified ticket
      const afterTicket = await this.getTicketById(opts.afterTicketId)
      if (!afterTicket) {
        throw new PMOError('NOT_FOUND', `Ticket not found: ${opts.afterTicketId}`, opts.afterTicketId)
      }

      // The after ticket must be in the same status
      if (afterTicket.statusId !== existing.statusId) {
        throw new PMOError('INVALID', `Cannot reorder: ${opts.afterTicketId} is in a different status`)
      }

      const afterPosition = afterTicket.position ?? 0

      // Find the next ticket after the target
      const nextTicket = this.ctx.db.prepare(`
        SELECT position FROM ${T.tickets}
        WHERE status_id = ? AND position > ? AND id != ?
        ORDER BY position ASC
        LIMIT 1
      `).get(existing.statusId, afterPosition, id) as { position: number } | undefined

      if (nextTicket) {
        // Place between afterTicket and nextTicket
        const gap = nextTicket.position - afterPosition
        if (gap > 1) {
          newPosition = afterPosition + Math.floor(gap / 2)
        } else {
          // No gap - need to re-gap all tickets in this status
          this.regapPositions(existing.statusId, id)
          // Re-read the after ticket position after regapping
          const refreshedAfter = await this.getTicketById(opts.afterTicketId)
          const refreshedAfterPos = refreshedAfter?.position ?? 0
          const refreshedNext = this.ctx.db.prepare(`
            SELECT position FROM ${T.tickets}
            WHERE status_id = ? AND position > ? AND id != ?
            ORDER BY position ASC
            LIMIT 1
          `).get(existing.statusId, refreshedAfterPos, id) as { position: number } | undefined
          newPosition = refreshedNext
            ? refreshedAfterPos + Math.floor((refreshedNext.position - refreshedAfterPos) / 2)
            : refreshedAfterPos + 1000
        }
      } else {
        // Append after the target (no tickets after it)
        newPosition = afterPosition + 1000
      }
    } else if (opts.position !== undefined) {
      newPosition = opts.position
    } else {
      throw new PMOError('INVALID', 'Must provide either position or after_ticket_id')
    }

    this.ctx.db.prepare(`
      UPDATE ${T.tickets}
      SET position = ?, updated_at = ?
      WHERE id = ?
    `).run(newPosition, Date.now(), id)

    if (existing.projectId) {
      this.ctx.updateBoardTimestamp(existing.projectId)
    }

    return (await this.getTicketById(id)) as Ticket
  }

  /**
   * Re-gap positions for all tickets in a status using 1000-gaps.
   * Optionally excludes a ticket (e.g., the one being moved).
   */
  private regapPositions(statusId: string, excludeTicketId?: string): void {
    let query = `
      SELECT id FROM ${T.tickets}
      WHERE status_id = ?
    `
    const params: unknown[] = [statusId]

    if (excludeTicketId) {
      query += ' AND id != ?'
      params.push(excludeTicketId)
    }

    query += ' ORDER BY position ASC, created_at ASC'

    const tickets = this.ctx.db.prepare(query).all(...params) as { id: string }[]
    const update = this.ctx.db.prepare(`UPDATE ${T.tickets} SET position = ? WHERE id = ?`)

    const regap = this.ctx.db.transaction(() => {
      tickets.forEach((ticket, idx) => {
        update.run((idx + 1) * 1000, ticket.id)
      })
    })
    regap()
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
    try {
      const result = this.ctx.db.prepare(`
        DELETE FROM ${T.tickets}
        WHERE id = ?
      `).run(id)

      if (result.changes === 0) {
        throw new PMOError('NOT_FOUND', `Ticket not found: ${id}`, id)
      }
    } catch (err) {
      if (err instanceof PMOError) throw err
      wrapSqliteError('Ticket', 'delete', err)
    }

    // Update board timestamp for the ticket's project
    this.updateProjectTimestamp(ticketProjectId)
  }

  /**
   * List tickets with optional filters.
   * @param projectIdOrName - The project ID, name, or slug to filter by. Pass undefined to list all tickets across all projects.
   * @param filter - Additional filters to apply.
   */
  async listTickets(projectIdOrName: string | undefined, filter?: TicketFilter): Promise<Ticket[]> {
    const params: unknown[] = []

    // Resolve project identifier to actual ID if provided
    let resolvedProjectId: string | undefined
    if (projectIdOrName !== undefined) {
      resolvedProjectId = this.resolveProjectId(projectIdOrName) || undefined
      // If resolution fails, use original value to allow normal "not found" behavior
      if (!resolvedProjectId) {
        resolvedProjectId = projectIdOrName
      }
    }

    // Build the base query using workflow_statuses
    let query = `
      SELECT t.*,
             ws.id as column_id,
             t.position as position,
             ws.name as column_name,
             p.name as project_name
      FROM ${T.tickets} t
      LEFT JOIN ${T.workflow_statuses} ws ON t.status_id = ws.id
      LEFT JOIN ${T.projects} p ON t.project_id = p.id
      WHERE 1=1
    `

    // Apply project scoping
    if (resolvedProjectId !== undefined) {
      query += ' AND t.project_id = ?'
      params.push(resolvedProjectId)
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
    if (filter?.label) {
      query += ` AND t.id IN (
        SELECT tl.ticket_id FROM ${T.ticket_labels} tl
        JOIN ${T.labels} l ON tl.label_id = l.id
        WHERE LOWER(l.name) = LOWER(?)
      )`
      params.push(filter.label)
    }
    if (filter?.labelGroup) {
      query += ` AND t.id IN (
        SELECT tl.ticket_id FROM ${T.ticket_labels} tl
        JOIN ${T.labels} l ON tl.label_id = l.id
        JOIN ${T.label_groups} lg ON l.group_id = lg.id
        WHERE LOWER(lg.name) = LOWER(?)
      )`
      params.push(filter.labelGroup)
    }

    // Order by status column position, then ticket position within status
    if (projectIdOrName === undefined) {
      query += ` ORDER BY p.name, ws.position, t.position ASC, t.created_at ASC`
    } else {
      query += ` ORDER BY ws.position, t.position ASC, t.created_at ASC`
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

    // Get next position for the target status
    const targetStatusId = newStatusId || existing.statusId
    const maxPos = this.ctx.db.prepare(`
      SELECT COALESCE(MAX(position), 0) as max_pos FROM ${T.tickets} WHERE status_id = ?
    `).get(targetStatusId) as { max_pos: number }
    const newTicketPosition = maxPos.max_pos + 1000

    // Update ticket's project_id, status_id, and position
    const now = Date.now()
    this.ctx.db.prepare(`
      UPDATE ${T.tickets}
      SET project_id = ?, status_id = ?, position = ?, updated_at = ?
      WHERE id = ?
    `).run(newProjectId, targetStatusId, newTicketPosition, now, ticketId)

    // Update timestamps for both projects
    this.updateProjectTimestamp(oldProjectId)
    this.updateProjectTimestamp(newProjectId)

    return (await this.getTicketById(ticketId)) as Ticket
  }
}

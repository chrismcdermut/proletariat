/**
 * Ticket operations for PMO.
 * Tickets reference workflow statuses directly via status_id.
 * Tickets have a position column for force-ranked ordering within a status.
 * Positions use gapped integers (1000, 2000, 3000...) for stable reordering.
 *
 * This module uses Drizzle ORM for type-safe database queries.
 */

import { eq, and, like, or, asc, sql, gt } from 'drizzle-orm'
import {
  pmoTickets,
  pmoProjects,
  pmoWorkflowStatuses,
  pmoSubtasks,
  pmoTicketMetadata,
  pmoCategories,
  pmoTicketLabels,
  pmoLabels,
  pmoLabelGroups,
} from '../../database/drizzle-schema.js'
import { CreateTicketInput, PMOError, Ticket, TicketFilter } from '../types.js'
import { slugify, generateEntityId } from '../utils.js'
import { StorageContext, TicketRow } from './types.js'
import { rowToTicket, wrapSqliteError } from './helpers.js'

export class TicketStorage {
  constructor(private ctx: StorageContext) {}

  /**
   * Validate a category against the DB.
   * Returns the valid category name if found, throws error if invalid.
   */
  private async validateCategory(category: string | null | undefined): Promise<string | null> {
    if (!category) return null

    const row = this.ctx.drizzle
      .select({ name: pmoCategories.name })
      .from(pmoCategories)
      .where(and(
        sql`LOWER(${pmoCategories.name}) = LOWER(${category})`,
        eq(pmoCategories.type, 'ticket')
      ))
      .get()

    if (!row) {
      const validCategories = this.ctx.drizzle
        .select({ name: pmoCategories.name })
        .from(pmoCategories)
        .where(eq(pmoCategories.type, 'ticket'))
        .orderBy(asc(pmoCategories.position))
        .all()

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
    const exactMatch = this.ctx.drizzle
      .select({ id: pmoProjects.id })
      .from(pmoProjects)
      .where(eq(pmoProjects.id, identifier))
      .get()
    if (exactMatch) return exactMatch.id

    // 2. Case-insensitive ID match
    const caseInsensitiveId = this.ctx.drizzle
      .select({ id: pmoProjects.id })
      .from(pmoProjects)
      .where(sql`LOWER(${pmoProjects.id}) = LOWER(${identifier})`)
      .get()
    if (caseInsensitiveId) return caseInsensitiveId.id

    // 3. Exact name match
    const nameMatch = this.ctx.drizzle
      .select({ id: pmoProjects.id })
      .from(pmoProjects)
      .where(eq(pmoProjects.name, identifier))
      .get()
    if (nameMatch) return nameMatch.id

    // 4. Case-insensitive name match
    const caseInsensitiveName = this.ctx.drizzle
      .select({ id: pmoProjects.id })
      .from(pmoProjects)
      .where(sql`LOWER(${pmoProjects.name}) = LOWER(${identifier})`)
      .get()
    if (caseInsensitiveName) return caseInsensitiveName.id

    // 5. Slugified name match
    const allProjects = this.ctx.drizzle
      .select({ id: pmoProjects.id, name: pmoProjects.name })
      .from(pmoProjects)
      .all()

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
    const project = this.ctx.drizzle
      .select({ workflowId: pmoProjects.workflowId })
      .from(pmoProjects)
      .where(eq(pmoProjects.id, projectId))
      .get()

    if (!project) {
      throw new PMOError('NOT_FOUND', `Project not found: ${projectId}`)
    }

    const workflowId = project.workflowId || 'default'

    // If statusName is provided, look up status by name
    if (!statusId && ticket.statusName) {
      const namedStatus = this.ctx.drizzle
        .select({ id: pmoWorkflowStatuses.id })
        .from(pmoWorkflowStatuses)
        .where(and(
          eq(pmoWorkflowStatuses.workflowId, workflowId),
          sql`LOWER(${pmoWorkflowStatuses.name}) = LOWER(${ticket.statusName})`
        ))
        .get()

      if (namedStatus) {
        statusId = namedStatus.id
      }
    }

    if (!statusId) {
      // Get default status from workflow
      const defaultStatus = this.ctx.drizzle
        .select({ id: pmoWorkflowStatuses.id })
        .from(pmoWorkflowStatuses)
        .where(and(
          eq(pmoWorkflowStatuses.workflowId, workflowId),
          eq(pmoWorkflowStatuses.isDefault, true)
        ))
        .get()

      if (defaultStatus) {
        statusId = defaultStatus.id
      } else {
        // Fall back to first status in workflow (by category then position)
        const firstStatus = this.ctx.drizzle
          .select({ id: pmoWorkflowStatuses.id })
          .from(pmoWorkflowStatuses)
          .where(eq(pmoWorkflowStatuses.workflowId, workflowId))
          .orderBy(
            sql`CASE ${pmoWorkflowStatuses.category}
              WHEN 'backlog' THEN 1
              WHEN 'unstarted' THEN 2
              WHEN 'started' THEN 3
              WHEN 'completed' THEN 4
              WHEN 'canceled' THEN 5
            END`,
            asc(pmoWorkflowStatuses.position)
          )
          .limit(1)
          .get()

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
    const maxPos = this.ctx.drizzle
      .select({ maxPos: sql<number>`COALESCE(MAX(${pmoTickets.position}), 0)` })
      .from(pmoTickets)
      .where(eq(pmoTickets.statusId, statusId!))
      .get()
    const position = (maxPos?.maxPos ?? 0) + 1000

    // Insert ticket
    const labels = ticket.labels || []
    try {
      const ticketValues: typeof pmoTickets.$inferInsert = {
        id,
        projectId,
        title,
        description: ticket.description || null,
        priority: ticket.priority || null,
        category: validatedCategory,
        status: 'backlog',
        statusId: statusId,
        owner: ticket.owner || null,
        assignee: ticket.assignee || null,
        specId,
        epicId: ticket.epicId || null,
        labels: JSON.stringify(labels),
        position,
        createdAt: String(now),
        updatedAt: String(now),
        lastSyncedFromSpec: ticket.lastSyncedFromSpec ? String(ticket.lastSyncedFromSpec) : null,
        lastSyncedFromBoard: ticket.lastSyncedFromBoard ? String(ticket.lastSyncedFromBoard) : null,
      }
      this.ctx.drizzle.insert(pmoTickets).values(ticketValues).run()
    } catch (err) {
      wrapSqliteError('Ticket', 'create', err)
    }

    // Insert subtasks
    if (ticket.subtasks && ticket.subtasks.length > 0) {
      for (const [idx, st] of ticket.subtasks.entries()) {
        this.ctx.drizzle.insert(pmoSubtasks).values({
          id: st.id || slugify(st.title),
          ticketId: id,
          title: st.title,
          done: st.done || false,
          position: idx,
        }).run()
      }
    }

    // Insert metadata
    if (ticket.metadata) {
      for (const [key, value] of Object.entries(ticket.metadata)) {
        this.ctx.drizzle.insert(pmoTicketMetadata).values({
          ticketId: id,
          key,
          value,
        }).run()
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
    const rows = this.ctx.drizzle
      .select({
        id: pmoTickets.id,
        project_id: pmoTickets.projectId,
        title: pmoTickets.title,
        description: pmoTickets.description,
        priority: pmoTickets.priority,
        category: pmoTickets.category,
        status_id: pmoTickets.statusId,
        owner: pmoTickets.owner,
        assignee: pmoTickets.assignee,
        branch: pmoTickets.branch,
        spec_id: pmoTickets.specId,
        epic_id: pmoTickets.epicId,
        labels: pmoTickets.labels,
        position: pmoTickets.position,
        created_at: pmoTickets.createdAt,
        updated_at: pmoTickets.updatedAt,
        last_synced_from_spec: pmoTickets.lastSyncedFromSpec,
        last_synced_from_board: pmoTickets.lastSyncedFromBoard,
        column_id: pmoWorkflowStatuses.id,
        column_name: pmoWorkflowStatuses.name,
        project_name: sql<string | null>`NULL`,
      })
      .from(pmoTickets)
      .leftJoin(pmoWorkflowStatuses, eq(pmoTickets.statusId, pmoWorkflowStatuses.id))
      .where(sql`LOWER(${pmoTickets.id}) = LOWER(${id})`)
      .all()

    if (rows.length === 0) return null
    const row = rows[0] as unknown as TicketRow

    return rowToTicket(this.ctx.drizzle, row)
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

    const updates: Partial<typeof pmoTickets.$inferInsert> = {}

    if (changes.title !== undefined) updates.title = changes.title
    if (changes.description !== undefined) updates.description = changes.description
    if (changes.priority !== undefined) updates.priority = changes.priority
    if (validatedCategory !== undefined) updates.category = validatedCategory
    if (changes.statusId !== undefined) updates.statusId = changes.statusId
    if (changes.owner !== undefined) updates.owner = changes.owner
    if (changes.assignee !== undefined) updates.assignee = changes.assignee
    if (changes.branch !== undefined) updates.branch = changes.branch
    if ('specId' in changes) updates.specId = changes.specId ?? null
    if (changes.lastSyncedFromSpec !== undefined) {
      updates.lastSyncedFromSpec = changes.lastSyncedFromSpec as unknown as string
    }
    if (changes.lastSyncedFromBoard !== undefined) {
      updates.lastSyncedFromBoard = changes.lastSyncedFromBoard as unknown as string
    }
    if (changes.labels !== undefined) updates.labels = JSON.stringify(changes.labels)

    if (Object.keys(updates).length > 0) {
      updates.updatedAt = String(Date.now())
      this.ctx.drizzle
        .update(pmoTickets)
        .set(updates)
        .where(eq(pmoTickets.id, id))
        .run()
    }

    // Update subtasks if provided
    if (changes.subtasks !== undefined) {
      this.ctx.drizzle.delete(pmoSubtasks).where(eq(pmoSubtasks.ticketId, id)).run()
      for (const [idx, st] of changes.subtasks.entries()) {
        this.ctx.drizzle.insert(pmoSubtasks).values({
          id: st.id || slugify(st.title),
          ticketId: id,
          title: st.title,
          done: st.done || false,
          position: idx,
        }).run()
      }
    }

    // Update metadata if provided
    if (changes.metadata !== undefined) {
      this.ctx.drizzle.delete(pmoTicketMetadata).where(eq(pmoTicketMetadata.ticketId, id)).run()
      for (const [key, value] of Object.entries(changes.metadata)) {
        this.ctx.drizzle.insert(pmoTicketMetadata).values({
          ticketId: id,
          key,
          value,
        }).run()
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
    this.ctx.drizzle
      .update(pmoProjects)
      .set({ updatedAt: String(Date.now()) })
      .where(eq(pmoProjects.id, projectId))
      .run()
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
    const project = this.ctx.drizzle
      .select({ workflowId: pmoProjects.workflowId })
      .from(pmoProjects)
      .where(eq(pmoProjects.id, projectId))
      .get()

    if (!project) {
      throw new PMOError('NOT_FOUND', `Project not found: ${projectId}`)
    }

    const workflowId = project.workflowId || 'default'

    // Find target status by ID or name
    const targetStatus = this.ctx.drizzle
      .select({ id: pmoWorkflowStatuses.id })
      .from(pmoWorkflowStatuses)
      .where(and(
        eq(pmoWorkflowStatuses.workflowId, workflowId),
        or(
          eq(pmoWorkflowStatuses.id, column),
          sql`LOWER(${pmoWorkflowStatuses.name}) = LOWER(${column})`
        )
      ))
      .get()

    if (!targetStatus) {
      throw new PMOError('NOT_FOUND', `Status not found: ${column}`)
    }

    // Determine position: use provided or append to end
    let newPosition: number
    if (position !== undefined) {
      newPosition = position
    } else {
      const maxPos = this.ctx.drizzle
        .select({ maxPos: sql<number>`COALESCE(MAX(${pmoTickets.position}), 0)` })
        .from(pmoTickets)
        .where(eq(pmoTickets.statusId, targetStatus.id))
        .get()
      newPosition = (maxPos?.maxPos ?? 0) + 1000
    }

    // Update ticket's status_id and position
    this.ctx.drizzle
      .update(pmoTickets)
      .set({
        statusId: targetStatus.id,
        position: newPosition,
        updatedAt: String(Date.now()),
      })
      .where(eq(pmoTickets.id, id))
      .run()

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
      const nextTicket = this.ctx.drizzle
        .select({ position: pmoTickets.position })
        .from(pmoTickets)
        .where(and(
          eq(pmoTickets.statusId, existing.statusId!),
          gt(pmoTickets.position, afterPosition),
          sql`${pmoTickets.id} != ${id}`
        ))
        .orderBy(asc(pmoTickets.position))
        .limit(1)
        .get()

      if (nextTicket) {
        // Place between afterTicket and nextTicket
        const gap = nextTicket.position - afterPosition
        if (gap > 1) {
          newPosition = afterPosition + Math.floor(gap / 2)
        } else {
          // No gap - need to re-gap all tickets in this status
          this.regapPositions(existing.statusId!, id)
          // Re-read the after ticket position after regapping
          const refreshedAfter = await this.getTicketById(opts.afterTicketId)
          const refreshedAfterPos = refreshedAfter?.position ?? 0
          const refreshedNext = this.ctx.drizzle
            .select({ position: pmoTickets.position })
            .from(pmoTickets)
            .where(and(
              eq(pmoTickets.statusId, existing.statusId!),
              gt(pmoTickets.position, refreshedAfterPos),
              sql`${pmoTickets.id} != ${id}`
            ))
            .orderBy(asc(pmoTickets.position))
            .limit(1)
            .get()
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

    this.ctx.drizzle
      .update(pmoTickets)
      .set({
        position: newPosition,
        updatedAt: String(Date.now()),
      })
      .where(eq(pmoTickets.id, id))
      .run()

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
    const conditions = [eq(pmoTickets.statusId, statusId)]
    if (excludeTicketId) {
      conditions.push(sql`${pmoTickets.id} != ${excludeTicketId}`)
    }

    const tickets = this.ctx.drizzle
      .select({ id: pmoTickets.id })
      .from(pmoTickets)
      .where(and(...conditions))
      .orderBy(asc(pmoTickets.position), asc(pmoTickets.createdAt))
      .all()

    this.ctx.drizzle.transaction((tx) => {
      tickets.forEach((ticket, idx) => {
        tx.update(pmoTickets)
          .set({ position: (idx + 1) * 1000 })
          .where(eq(pmoTickets.id, ticket.id))
          .run()
      })
    })
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
      const result = this.ctx.drizzle
        .delete(pmoTickets)
        .where(eq(pmoTickets.id, id))
        .run()

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
    // Resolve project identifier to actual ID if provided
    let resolvedProjectId: string | undefined
    if (projectIdOrName !== undefined) {
      resolvedProjectId = this.resolveProjectId(projectIdOrName) || undefined
      // If resolution fails, use original value to allow normal "not found" behavior
      if (!resolvedProjectId) {
        resolvedProjectId = projectIdOrName
      }
    }

    // Build conditions array for dynamic WHERE clause
    const conditions: ReturnType<typeof eq>[] = []

    // Apply project scoping
    if (resolvedProjectId !== undefined) {
      conditions.push(eq(pmoTickets.projectId, resolvedProjectId))
    }

    if (filter?.statusId) {
      conditions.push(eq(pmoTickets.statusId, filter.statusId))
    }
    if (filter?.statusCategory) {
      conditions.push(eq(pmoWorkflowStatuses.category, filter.statusCategory))
    }
    if (filter?.priority) {
      conditions.push(eq(pmoTickets.priority, filter.priority))
    }
    if (filter?.category) {
      conditions.push(eq(pmoTickets.category, filter.category))
    }
    if (filter?.owner) {
      conditions.push(eq(pmoTickets.owner, filter.owner))
    }
    if (filter?.assignee) {
      conditions.push(eq(pmoTickets.assignee, filter.assignee))
    }
    if (filter?.search) {
      conditions.push(
        or(
          like(pmoTickets.title, `%${filter.search}%`),
          like(pmoTickets.description, `%${filter.search}%`)
        )!
      )
    }
    if (filter?.spec) {
      conditions.push(eq(pmoTickets.specId, filter.spec))
    }
    if (filter?.epic) {
      conditions.push(eq(pmoTickets.epicId, filter.epic))
    }
    if (filter?.column) {
      conditions.push(eq(pmoWorkflowStatuses.name, filter.column))
    }
    if (filter?.label) {
      conditions.push(
        sql`${pmoTickets.id} IN (
          SELECT ${pmoTicketLabels.ticketId} FROM ${pmoTicketLabels}
          JOIN ${pmoLabels} ON ${pmoTicketLabels.labelId} = ${pmoLabels.id}
          WHERE LOWER(${pmoLabels.name}) = LOWER(${filter.label})
        )`
      )
    }
    if (filter?.labelGroup) {
      conditions.push(
        sql`${pmoTickets.id} IN (
          SELECT ${pmoTicketLabels.ticketId} FROM ${pmoTicketLabels}
          JOIN ${pmoLabels} ON ${pmoTicketLabels.labelId} = ${pmoLabels.id}
          JOIN ${pmoLabelGroups} ON ${pmoLabels.groupId} = ${pmoLabelGroups.id}
          WHERE LOWER(${pmoLabelGroups.name}) = LOWER(${filter.labelGroup})
        )`
      )
    }

    // Build order clause
    const orderClauses = projectIdOrName === undefined
      ? [asc(pmoProjects.name), asc(pmoWorkflowStatuses.position), asc(pmoTickets.position), asc(pmoTickets.createdAt)]
      : [asc(pmoWorkflowStatuses.position), asc(pmoTickets.position), asc(pmoTickets.createdAt)]

    let query = this.ctx.drizzle
      .select({
        id: pmoTickets.id,
        project_id: pmoTickets.projectId,
        title: pmoTickets.title,
        description: pmoTickets.description,
        priority: pmoTickets.priority,
        category: pmoTickets.category,
        status_id: pmoTickets.statusId,
        owner: pmoTickets.owner,
        assignee: pmoTickets.assignee,
        branch: pmoTickets.branch,
        spec_id: pmoTickets.specId,
        epic_id: pmoTickets.epicId,
        labels: pmoTickets.labels,
        position: pmoTickets.position,
        created_at: pmoTickets.createdAt,
        updated_at: pmoTickets.updatedAt,
        last_synced_from_spec: pmoTickets.lastSyncedFromSpec,
        last_synced_from_board: pmoTickets.lastSyncedFromBoard,
        column_id: pmoWorkflowStatuses.id,
        column_name: pmoWorkflowStatuses.name,
        project_name: pmoProjects.name,
      })
      .from(pmoTickets)
      .leftJoin(pmoWorkflowStatuses, eq(pmoTickets.statusId, pmoWorkflowStatuses.id))
      .leftJoin(pmoProjects, eq(pmoTickets.projectId, pmoProjects.id))
      .$dynamic()

    if (conditions.length > 0) {
      query = query.where(and(...conditions))
    }

    const rows = query.orderBy(...orderClauses).all() as unknown as TicketRow[]

    return Promise.all(rows.map((row) => rowToTicket(this.ctx.drizzle, row)))
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
    const targetProject = this.ctx.drizzle
      .select({ id: pmoProjects.id, workflowId: pmoProjects.workflowId })
      .from(pmoProjects)
      .where(eq(pmoProjects.id, newProjectId))
      .get()

    if (!targetProject) {
      throw new PMOError('NOT_FOUND', `Project not found: ${newProjectId}`, newProjectId)
    }

    const workflowId = targetProject.workflowId || 'default'

    // Get default status for target project's workflow
    let newStatusId: string | undefined
    const defaultStatus = this.ctx.drizzle
      .select({ id: pmoWorkflowStatuses.id })
      .from(pmoWorkflowStatuses)
      .where(and(
        eq(pmoWorkflowStatuses.workflowId, workflowId),
        eq(pmoWorkflowStatuses.isDefault, true)
      ))
      .get()

    if (defaultStatus) {
      newStatusId = defaultStatus.id
    } else {
      // Get first status in workflow
      const firstStatus = this.ctx.drizzle
        .select({ id: pmoWorkflowStatuses.id })
        .from(pmoWorkflowStatuses)
        .where(eq(pmoWorkflowStatuses.workflowId, workflowId))
        .orderBy(
          sql`CASE ${pmoWorkflowStatuses.category}
            WHEN 'backlog' THEN 1
            WHEN 'unstarted' THEN 2
            WHEN 'started' THEN 3
            WHEN 'completed' THEN 4
            WHEN 'canceled' THEN 5
          END`,
          asc(pmoWorkflowStatuses.position)
        )
        .limit(1)
        .get()

      if (firstStatus) {
        newStatusId = firstStatus.id
      }
    }

    // Get next position for the target status
    const targetStatusId = newStatusId || existing.statusId
    const maxPos = this.ctx.drizzle
      .select({ maxPos: sql<number>`COALESCE(MAX(${pmoTickets.position}), 0)` })
      .from(pmoTickets)
      .where(eq(pmoTickets.statusId, targetStatusId!))
      .get()
    const newTicketPosition = (maxPos?.maxPos ?? 0) + 1000

    // Update ticket's project_id, status_id, and position
    const now = Date.now()
    this.ctx.drizzle
      .update(pmoTickets)
      .set({
        projectId: newProjectId,
        statusId: targetStatusId,
        position: newTicketPosition,
        updatedAt: String(now),
      })
      .where(eq(pmoTickets.id, ticketId))
      .run()

    // Update timestamps for both projects
    this.updateProjectTimestamp(oldProjectId)
    this.updateProjectTimestamp(newProjectId)

    return (await this.getTicketById(ticketId)) as Ticket
  }
}

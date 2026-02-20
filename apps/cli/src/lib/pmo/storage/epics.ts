/**
 * Epic operations for PMO.
 *
 * This module uses Drizzle ORM for type-safe database queries.
 */

import { eq, and, like, or, asc, sql, gte, gt, lt, lte } from 'drizzle-orm'
import {
  pmoEpics,
  pmoTickets,
  pmoWorkflowStatuses,
} from '../../database/drizzle-schema.js'
import { Epic, EpicFilter, PMOError, Ticket } from '../types.js'
import { generateEntityId } from '../utils.js'
import { StorageContext, TicketRow } from './types.js'
import { rowToTicket, wrapSqliteError } from './helpers.js'

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
      const maxPos = this.ctx.drizzle
        .select({ maxPos: sql<number>`COALESCE(MAX(${pmoEpics.position}), -1)` })
        .from(pmoEpics)
        .where(eq(pmoEpics.projectId, projectId))
        .get()
      position = (maxPos?.maxPos ?? -1) + 1
    }

    try {
      this.ctx.drizzle.insert(pmoEpics).values({
        id,
        projectId,
        title,
        description: epic.description || null,
        status,
        position: position!,
        filePath: epic.filePath || null,
        specId: epic.specId || null,
        createdAt: String(now),
        updatedAt: String(now),
      }).run()
    } catch (err) {
      wrapSqliteError('Epic', 'create', err)
    }

    this.ctx.updateBoardTimestamp(projectId)

    return {
      id,
      projectId,
      title,
      description: epic.description,
      status,
      position: position!,
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
    const row = this.ctx.drizzle
      .select()
      .from(pmoEpics)
      .where(eq(pmoEpics.id, id))
      .get()

    if (!row) return null

    return this.rowToEpic(row)
  }

  /**
   * List epics with optional filters.
   */
  async listEpics(projectId: string, filter?: EpicFilter): Promise<Epic[]> {
    let query = this.ctx.drizzle
      .select()
      .from(pmoEpics)
      .$dynamic()

    const conditions = [eq(pmoEpics.projectId, projectId)]

    if (filter?.status) {
      conditions.push(eq(pmoEpics.status, filter.status))
    }
    if (filter?.search) {
      conditions.push(
        or(
          like(pmoEpics.title, `%${filter.search}%`),
          like(pmoEpics.description, `%${filter.search}%`)
        )!
      )
    }

    query = query.where(and(...conditions))

    const rows = query
      .orderBy(asc(pmoEpics.position), asc(pmoEpics.createdAt))
      .all()

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

    const now = Date.now()

    if (newPosition < oldPosition) {
      this.ctx.drizzle
        .update(pmoEpics)
        .set({ position: sql`${pmoEpics.position} + 1`, updatedAt: String(now) })
        .where(
          and(
            eq(pmoEpics.projectId, projectId),
            gte(pmoEpics.position, newPosition),
            lt(pmoEpics.position, oldPosition)
          )
        )
        .run()
    } else {
      this.ctx.drizzle
        .update(pmoEpics)
        .set({ position: sql`${pmoEpics.position} - 1`, updatedAt: String(now) })
        .where(
          and(
            eq(pmoEpics.projectId, projectId),
            gt(pmoEpics.position, oldPosition),
            lte(pmoEpics.position, newPosition)
          )
        )
        .run()
    }

    this.ctx.drizzle
      .update(pmoEpics)
      .set({ position: newPosition, updatedAt: String(now) })
      .where(eq(pmoEpics.id, epicId))
      .run()

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

    const updates: Partial<typeof pmoEpics.$inferInsert> = {}

    if (changes.title !== undefined) {
      updates.title = changes.title
    }
    if (changes.description !== undefined) {
      updates.description = changes.description
    }
    if (changes.status !== undefined) {
      updates.status = changes.status
    }
    if (changes.filePath !== undefined) {
      updates.filePath = changes.filePath
    }
    if (changes.specId !== undefined) {
      updates.specId = changes.specId || null
    }

    if (Object.keys(updates).length > 0) {
      updates.updatedAt = String(Date.now())
      this.ctx.drizzle
        .update(pmoEpics)
        .set(updates)
        .where(eq(pmoEpics.id, id))
        .run()
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

    try {
      // Unlink tickets from this epic
      this.ctx.drizzle
        .update(pmoTickets)
        .set({ epicId: null })
        .where(eq(pmoTickets.epicId, id))
        .run()

      this.ctx.drizzle
        .delete(pmoEpics)
        .where(eq(pmoEpics.id, id))
        .run()
    } catch (err) {
      wrapSqliteError('Epic', 'delete', err)
    }

    this.ctx.updateBoardTimestamp(epic.projectId)
  }

  /**
   * Get tickets for an epic.
   */
  async getTicketsForEpic(projectId: string, epicId: string): Promise<Ticket[]> {
    const rows = this.ctx.drizzle
      .select({
        ticket: pmoTickets,
        column_id: pmoWorkflowStatuses.id,
        column_name: pmoWorkflowStatuses.name,
      })
      .from(pmoTickets)
      .leftJoin(pmoWorkflowStatuses, eq(pmoTickets.statusId, pmoWorkflowStatuses.id))
      .where(and(eq(pmoTickets.projectId, projectId), eq(pmoTickets.epicId, epicId)))
      .orderBy(asc(pmoWorkflowStatuses.position), asc(pmoTickets.position), asc(pmoTickets.createdAt))
      .all()

    const ticketRows: TicketRow[] = rows.map((r) => ({
      ...this.drizzleTicketToRow(r.ticket),
      column_id: r.column_id,
      column_name: r.column_name,
    }))

    return Promise.all(ticketRows.map((row) => rowToTicket(this.ctx.db, row)))
  }

  /**
   * Link a ticket to an epic.
   */
  async linkTicketToEpic(ticketId: string, epicId: string): Promise<void> {
    // Verify ticket exists and get its project
    const ticket = this.ctx.drizzle
      .select({ id: pmoTickets.id, projectId: pmoTickets.projectId })
      .from(pmoTickets)
      .where(eq(pmoTickets.id, ticketId))
      .get()
    if (!ticket) {
      throw new PMOError('NOT_FOUND', `Ticket not found: ${ticketId}`, ticketId)
    }

    // Verify epic exists
    const epic = await this.getEpic(epicId)
    if (!epic) {
      throw new PMOError('NOT_FOUND', `Epic not found: ${epicId}`)
    }

    this.ctx.drizzle
      .update(pmoTickets)
      .set({ epicId, updatedAt: String(Date.now()) })
      .where(eq(pmoTickets.id, ticketId))
      .run()

    this.ctx.updateBoardTimestamp(ticket.projectId)
  }

  /**
   * Unlink a ticket from its epic.
   */
  async unlinkTicketFromEpic(ticketId: string): Promise<void> {
    // Get ticket's project for board timestamp update
    const ticket = this.ctx.drizzle
      .select({ projectId: pmoTickets.projectId })
      .from(pmoTickets)
      .where(eq(pmoTickets.id, ticketId))
      .get()

    this.ctx.drizzle
      .update(pmoTickets)
      .set({ epicId: null, updatedAt: String(Date.now()) })
      .where(eq(pmoTickets.id, ticketId))
      .run()

    if (ticket) {
      this.ctx.updateBoardTimestamp(ticket.projectId)
    }
  }

  // =========================================================================
  // Private Helpers
  // =========================================================================

  private rowToEpic(row: typeof pmoEpics.$inferSelect): Epic {
    return {
      id: row.id,
      projectId: row.projectId,
      title: row.title,
      description: row.description || undefined,
      status: row.status as Epic['status'],
      position: row.position,
      filePath: row.filePath || undefined,
      specId: row.specId || undefined,
      createdAt: new Date(row.createdAt || Date.now()),
      updatedAt: new Date(row.updatedAt || Date.now()),
    }
  }

  /**
   * Convert a Drizzle ticket select result to a TicketRow for rowToTicket compatibility.
   */
  private drizzleTicketToRow(ticket: typeof pmoTickets.$inferSelect): Omit<TicketRow, 'column_id' | 'column_name'> {
    return {
      id: ticket.id,
      project_id: ticket.projectId,
      title: ticket.title,
      description: ticket.description,
      priority: ticket.priority,
      category: ticket.category,
      status_id: ticket.statusId || '',
      owner: ticket.owner,
      assignee: ticket.assignee,
      branch: ticket.branch,
      spec_id: ticket.specId,
      epic_id: ticket.epicId,
      labels: ticket.labels,
      project_name: null,
      position: ticket.position,
      created_at: ticket.createdAt || new Date().toISOString(),
      updated_at: ticket.updatedAt || new Date().toISOString(),
      last_synced_from_spec: ticket.lastSyncedFromSpec,
      last_synced_from_board: ticket.lastSyncedFromBoard,
    }
  }
}

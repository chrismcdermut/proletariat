/**
 * Subtask operations for tickets.
 *
 * This module uses Drizzle ORM for type-safe database queries.
 */

import { randomUUID } from 'node:crypto'
import { eq, and, sql } from 'drizzle-orm'
import {
  pmoTickets,
  pmoSubtasks,
  pmoTicketAcceptanceCriteria,
} from '../../database/drizzle-schema.js'
import { PMOError, Subtask, AcceptanceCriterion } from '../types.js'
import { slugify } from '../utils.js'
import { StorageContext } from './types.js'
import { wrapSqliteError } from './helpers.js'

export class SubtaskStorage {
  constructor(private ctx: StorageContext) {}

  /**
   * Add a subtask to a ticket.
   */
  async addSubtask(ticketId: string, title: string): Promise<Subtask> {
    // Verify ticket exists and get project_id
    const ticket = this.ctx.drizzle
      .select({ id: pmoTickets.id, projectId: pmoTickets.projectId })
      .from(pmoTickets)
      .where(eq(pmoTickets.id, ticketId))
      .get()

    if (!ticket) {
      throw new PMOError('NOT_FOUND', `Ticket not found: ${ticketId}`, ticketId)
    }

    // Get current max position
    const maxPos = this.ctx.drizzle
      .select({ maxPos: sql<number>`COALESCE(MAX(${pmoSubtasks.position}), -1)` })
      .from(pmoSubtasks)
      .where(eq(pmoSubtasks.ticketId, ticketId))
      .get()

    // Generate unique ID - start with slugified title, append counter if collision
    const baseId = slugify(title)
    let id = baseId
    let counter = 1

    // Check for existing subtask with same ID and append counter if needed
    while (true) {
      const existing = this.ctx.drizzle
        .select({ id: pmoSubtasks.id })
        .from(pmoSubtasks)
        .where(and(eq(pmoSubtasks.ticketId, ticketId), eq(pmoSubtasks.id, id)))
        .get()

      if (!existing) break

      counter++
      id = `${baseId}-${counter}`
    }

    const position = (maxPos?.maxPos ?? -1) + 1

    try {
      this.ctx.drizzle.insert(pmoSubtasks).values({
        id,
        ticketId,
        title,
        done: false,
        position,
      }).run()
    } catch (err) {
      wrapSqliteError('Subtask', 'create', err)
    }

    // Update ticket timestamp
    this.ctx.drizzle
      .update(pmoTickets)
      .set({ updatedAt: String(Date.now()) })
      .where(eq(pmoTickets.id, ticketId))
      .run()

    this.ctx.updateBoardTimestamp(ticket.projectId)

    return {
      id,
      title,
      done: false,
    }
  }

  /**
   * Toggle a subtask's done status.
   */
  async toggleSubtask(ticketId: string, subtaskId: string): Promise<Subtask> {
    // Get ticket's project_id for board timestamp update
    const ticket = this.ctx.drizzle
      .select({ projectId: pmoTickets.projectId })
      .from(pmoTickets)
      .where(eq(pmoTickets.id, ticketId))
      .get()

    const existing = this.ctx.drizzle
      .select()
      .from(pmoSubtasks)
      .where(and(eq(pmoSubtasks.ticketId, ticketId), eq(pmoSubtasks.id, subtaskId)))
      .get()

    if (!existing) {
      throw new PMOError('NOT_FOUND', `Subtask not found: ${subtaskId}`)
    }

    const newDone = !existing.done
    this.ctx.drizzle
      .update(pmoSubtasks)
      .set({ done: newDone })
      .where(and(eq(pmoSubtasks.ticketId, ticketId), eq(pmoSubtasks.id, subtaskId)))
      .run()

    // Update ticket timestamp
    this.ctx.drizzle
      .update(pmoTickets)
      .set({ updatedAt: String(Date.now()) })
      .where(eq(pmoTickets.id, ticketId))
      .run()

    if (ticket) {
      this.ctx.updateBoardTimestamp(ticket.projectId)
    }

    return {
      id: existing.id,
      title: existing.title,
      done: newDone,
    }
  }

  /**
   * Remove a subtask from a ticket.
   */
  async removeSubtask(ticketId: string, subtaskId: string): Promise<void> {
    // Get ticket's project_id for board timestamp update
    const ticket = this.ctx.drizzle
      .select({ projectId: pmoTickets.projectId })
      .from(pmoTickets)
      .where(eq(pmoTickets.id, ticketId))
      .get()

    const result = this.ctx.drizzle
      .delete(pmoSubtasks)
      .where(and(eq(pmoSubtasks.ticketId, ticketId), eq(pmoSubtasks.id, subtaskId)))
      .run()

    if (result.changes === 0) {
      throw new PMOError('NOT_FOUND', `Subtask not found: ${subtaskId}`)
    }

    // Update ticket timestamp
    this.ctx.drizzle
      .update(pmoTickets)
      .set({ updatedAt: String(Date.now()) })
      .where(eq(pmoTickets.id, ticketId))
      .run()

    if (ticket) {
      this.ctx.updateBoardTimestamp(ticket.projectId)
    }
  }
}

export class AcceptanceCriteriaStorage {
  constructor(private ctx: StorageContext) {}

  /**
   * Add an acceptance criterion to a ticket.
   */
  async addAcceptanceCriterion(
    ticketId: string,
    criterion: string
  ): Promise<AcceptanceCriterion> {
    // Verify ticket exists and get project_id
    const ticket = this.ctx.drizzle
      .select({ id: pmoTickets.id, projectId: pmoTickets.projectId })
      .from(pmoTickets)
      .where(eq(pmoTickets.id, ticketId))
      .get()

    if (!ticket) {
      throw new PMOError('NOT_FOUND', `Ticket not found: ${ticketId}`, ticketId)
    }

    // Get current max position
    const maxPos = this.ctx.drizzle
      .select({ maxPos: sql<number>`COALESCE(MAX(${pmoTicketAcceptanceCriteria.position}), -1)` })
      .from(pmoTicketAcceptanceCriteria)
      .where(eq(pmoTicketAcceptanceCriteria.ticketId, ticketId))
      .get()

    // Use UUID to guarantee uniqueness even when multiple ACs are added in the same millisecond
    const id = `ac-${randomUUID()}`
    const position = (maxPos?.maxPos ?? -1) + 1

    try {
      this.ctx.drizzle.insert(pmoTicketAcceptanceCriteria).values({
        id,
        ticketId,
        criterion,
        verifiable: true,
        verified: false,
        position,
      }).run()
    } catch (err) {
      wrapSqliteError('Acceptance criterion', 'create', err)
    }

    this.ctx.drizzle
      .update(pmoTickets)
      .set({ updatedAt: String(Date.now()) })
      .where(eq(pmoTickets.id, ticketId))
      .run()

    this.ctx.updateBoardTimestamp(ticket.projectId)

    return {
      id,
      ticketId,
      criterion,
      verifiable: true,
      verified: false,
      position,
    }
  }

  /**
   * Remove an acceptance criterion from a ticket.
   */
  async removeAcceptanceCriterion(
    ticketId: string,
    criterionId: string
  ): Promise<void> {
    // Get ticket's project_id for board timestamp update
    const ticket = this.ctx.drizzle
      .select({ projectId: pmoTickets.projectId })
      .from(pmoTickets)
      .where(eq(pmoTickets.id, ticketId))
      .get()

    const result = this.ctx.drizzle
      .delete(pmoTicketAcceptanceCriteria)
      .where(
        and(
          eq(pmoTicketAcceptanceCriteria.ticketId, ticketId),
          eq(pmoTicketAcceptanceCriteria.id, criterionId)
        )
      )
      .run()

    if (result.changes === 0) {
      throw new PMOError(
        'NOT_FOUND',
        `Acceptance criterion not found: ${criterionId}`
      )
    }

    this.ctx.drizzle
      .update(pmoTickets)
      .set({ updatedAt: String(Date.now()) })
      .where(eq(pmoTickets.id, ticketId))
      .run()

    if (ticket) {
      this.ctx.updateBoardTimestamp(ticket.projectId)
    }
  }

  /**
   * Clear all acceptance criteria from a ticket.
   */
  async clearAcceptanceCriteria(ticketId: string): Promise<void> {
    // Get ticket's project_id for board timestamp update
    const ticket = this.ctx.drizzle
      .select({ projectId: pmoTickets.projectId })
      .from(pmoTickets)
      .where(eq(pmoTickets.id, ticketId))
      .get()

    this.ctx.drizzle
      .delete(pmoTicketAcceptanceCriteria)
      .where(eq(pmoTicketAcceptanceCriteria.ticketId, ticketId))
      .run()

    this.ctx.drizzle
      .update(pmoTickets)
      .set({ updatedAt: String(Date.now()) })
      .where(eq(pmoTickets.id, ticketId))
      .run()

    if (ticket) {
      this.ctx.updateBoardTimestamp(ticket.projectId)
    }
  }
}

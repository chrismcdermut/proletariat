/**
 * Subtask operations for tickets.
 */

import Database from 'better-sqlite3'
import { PMO_TABLES } from '../schema.js'
import { PMOError, Subtask, AcceptanceCriterion } from '../types.js'
import { slugify } from '../utils.js'
import { StorageContext } from './types.js'

const T = PMO_TABLES

export class SubtaskStorage {
  constructor(private ctx: StorageContext) {}

  /**
   * Add a subtask to a ticket.
   */
  async addSubtask(ticketId: string, title: string): Promise<Subtask> {
    // Verify ticket exists
    const ticket = this.ctx.db.prepare(`
      SELECT id FROM ${T.tickets} WHERE id = ?
    `).get(ticketId) as { id: string } | undefined

    if (!ticket) {
      throw new PMOError('NOT_FOUND', `Ticket not found: ${ticketId}`, ticketId)
    }

    // Get current max position
    const maxPos = this.ctx.db.prepare(`
      SELECT COALESCE(MAX(position), -1) as max_pos
      FROM ${T.subtasks} WHERE ticket_id = ?
    `).get(ticketId) as { max_pos: number }

    const id = slugify(title)
    const position = maxPos.max_pos + 1

    this.ctx.db.prepare(`
      INSERT INTO ${T.subtasks} (id, ticket_id, title, done, position)
      VALUES (?, ?, ?, 0, ?)
    `).run(id, ticketId, title, position)

    // Update ticket timestamp
    this.ctx.db.prepare(`
      UPDATE ${T.tickets} SET updated_at = ? WHERE id = ?
    `).run(Date.now(), ticketId)

    this.ctx.updateBoardTimestamp()

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
    const existing = this.ctx.db.prepare(`
      SELECT * FROM ${T.subtasks}
      WHERE ticket_id = ? AND id = ?
    `).get(ticketId, subtaskId) as
      | { id: string; title: string; done: number }
      | undefined

    if (!existing) {
      throw new PMOError('NOT_FOUND', `Subtask not found: ${subtaskId}`)
    }

    const newDone = existing.done === 0 ? 1 : 0
    this.ctx.db.prepare(`
      UPDATE ${T.subtasks}
      SET done = ?
      WHERE ticket_id = ? AND id = ?
    `).run(newDone, ticketId, subtaskId)

    // Update ticket timestamp
    this.ctx.db.prepare(`
      UPDATE ${T.tickets} SET updated_at = ? WHERE id = ?
    `).run(Date.now(), ticketId)

    this.ctx.updateBoardTimestamp()

    return {
      id: existing.id,
      title: existing.title,
      done: newDone === 1,
    }
  }

  /**
   * Remove a subtask from a ticket.
   */
  async removeSubtask(ticketId: string, subtaskId: string): Promise<void> {
    const result = this.ctx.db.prepare(`
      DELETE FROM ${T.subtasks}
      WHERE ticket_id = ? AND id = ?
    `).run(ticketId, subtaskId)

    if (result.changes === 0) {
      throw new PMOError('NOT_FOUND', `Subtask not found: ${subtaskId}`)
    }

    // Update ticket timestamp
    this.ctx.db.prepare(`
      UPDATE ${T.tickets} SET updated_at = ? WHERE id = ?
    `).run(Date.now(), ticketId)

    this.ctx.updateBoardTimestamp()
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
    // Verify ticket exists
    const ticket = this.ctx.db.prepare(`
      SELECT id FROM ${T.tickets} WHERE id = ?
    `).get(ticketId) as { id: string } | undefined

    if (!ticket) {
      throw new PMOError('NOT_FOUND', `Ticket not found: ${ticketId}`, ticketId)
    }

    // Get current max position
    const maxPos = this.ctx.db.prepare(`
      SELECT COALESCE(MAX(position), -1) as max_pos
      FROM ${T.ticket_acceptance_criteria} WHERE ticket_id = ?
    `).get(ticketId) as { max_pos: number }

    const id = `ac-${Date.now()}`
    const position = maxPos.max_pos + 1

    this.ctx.db.prepare(`
      INSERT INTO ${T.ticket_acceptance_criteria} (id, ticket_id, criterion, verifiable, verified, position)
      VALUES (?, ?, ?, 1, 0, ?)
    `).run(id, ticketId, criterion, position)

    this.ctx.db.prepare(`
      UPDATE ${T.tickets} SET updated_at = ? WHERE id = ?
    `).run(Date.now(), ticketId)

    this.ctx.updateBoardTimestamp()

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
    const result = this.ctx.db.prepare(`
      DELETE FROM ${T.ticket_acceptance_criteria}
      WHERE ticket_id = ? AND id = ?
    `).run(ticketId, criterionId)

    if (result.changes === 0) {
      throw new PMOError(
        'NOT_FOUND',
        `Acceptance criterion not found: ${criterionId}`
      )
    }

    this.ctx.db.prepare(`
      UPDATE ${T.tickets} SET updated_at = ? WHERE id = ?
    `).run(Date.now(), ticketId)

    this.ctx.updateBoardTimestamp()
  }

  /**
   * Clear all acceptance criteria from a ticket.
   */
  async clearAcceptanceCriteria(ticketId: string): Promise<void> {
    this.ctx.db.prepare(`
      DELETE FROM ${T.ticket_acceptance_criteria} WHERE ticket_id = ?
    `).run(ticketId)

    this.ctx.db.prepare(`
      UPDATE ${T.tickets} SET updated_at = ? WHERE id = ?
    `).run(Date.now(), ticketId)

    this.ctx.updateBoardTimestamp()
  }
}

/**
 * Dependency operations for tickets, specs, and epics.
 *
 * This module uses Drizzle ORM for type-safe database queries.
 */

import { eq, and, desc } from 'drizzle-orm'
import {
  pmoTickets,
  pmoTicketDependencies,
  pmoSpecs,
  pmoSpecDependencies,
  pmoEpics,
  pmoEpicDependencies,
  pmoWorkflowStatuses,
} from '../../database/drizzle-schema.js'
import {
  EpicDependency,
  EpicDependencyType,
  PMOError,
  SpecDependency,
  SpecDependencyType,
  Ticket,
  TicketDependency,
  TicketDependencyType,
} from '../types.js'
import { StorageContext, TicketRow } from './types.js'
import { rowToTicket } from './helpers.js'

export class DependencyStorage {
  constructor(private ctx: StorageContext) {}

  // =========================================================================
  // Ticket Dependencies
  // =========================================================================

  /**
   * Create a dependency between two tickets.
   */
  async createTicketDependency(
    ticketId: string,
    dependsOnTicketId: string,
    dependencyType: TicketDependencyType = 'blocks'
  ): Promise<TicketDependency> {
    // Validate tickets exist
    const ticket = this.ctx.drizzle
      .select({ id: pmoTickets.id })
      .from(pmoTickets)
      .where(eq(pmoTickets.id, ticketId))
      .get()
    if (!ticket) throw new PMOError('NOT_FOUND', `Ticket not found: ${ticketId}`)

    const dependsOn = this.ctx.drizzle
      .select({ id: pmoTickets.id })
      .from(pmoTickets)
      .where(eq(pmoTickets.id, dependsOnTicketId))
      .get()
    if (!dependsOn) throw new PMOError('NOT_FOUND', `Ticket not found: ${dependsOnTicketId}`)

    try {
      this.ctx.drizzle.insert(pmoTicketDependencies).values({
        ticketId,
        dependsOnTicketId,
        dependencyType,
      }).run()

      return {
        ticketId,
        dependsOnTicketId,
        dependencyType,
        createdAt: new Date(),
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint')) {
        throw new PMOError('CONFLICT', 'Dependency already exists')
      }
      if (error instanceof Error && error.message.includes('CHECK constraint')) {
        throw new PMOError('INVALID', 'Cannot create self-dependency')
      }
      throw error
    }
  }

  /**
   * Delete a ticket dependency.
   */
  async deleteTicketDependency(
    ticketId: string,
    dependsOnTicketId: string,
    dependencyType?: TicketDependencyType
  ): Promise<void> {
    const conditions = [
      eq(pmoTicketDependencies.ticketId, ticketId),
      eq(pmoTicketDependencies.dependsOnTicketId, dependsOnTicketId),
    ]

    if (dependencyType) {
      conditions.push(eq(pmoTicketDependencies.dependencyType, dependencyType))
    }

    const result = this.ctx.drizzle
      .delete(pmoTicketDependencies)
      .where(and(...conditions))
      .run()

    if (result.changes === 0) {
      throw new PMOError('NOT_FOUND', 'Dependency not found')
    }
  }

  /**
   * List dependencies for a ticket.
   * For relates_to dependencies, also returns reverse relationships (symmetric).
   */
  async listTicketDependencies(ticketId: string): Promise<TicketDependency[]> {
    // Forward dependencies (all types)
    const forward = this.ctx.drizzle
      .select({
        ticketId: pmoTicketDependencies.ticketId,
        dependsOnTicketId: pmoTicketDependencies.dependsOnTicketId,
        dependencyType: pmoTicketDependencies.dependencyType,
        createdAt: pmoTicketDependencies.createdAt,
      })
      .from(pmoTicketDependencies)
      .where(eq(pmoTicketDependencies.ticketId, ticketId))
      .all()

    // Reverse dependencies (only relates_to, which is symmetric)
    const reverse = this.ctx.drizzle
      .select({
        ticketId: pmoTicketDependencies.dependsOnTicketId,
        dependsOnTicketId: pmoTicketDependencies.ticketId,
        dependencyType: pmoTicketDependencies.dependencyType,
        createdAt: pmoTicketDependencies.createdAt,
      })
      .from(pmoTicketDependencies)
      .where(
        and(
          eq(pmoTicketDependencies.dependsOnTicketId, ticketId),
          eq(pmoTicketDependencies.dependencyType, 'relates_to')
        )
      )
      .all()

    // Combine and sort by createdAt descending
    const combined = [...forward, ...reverse]
    combined.sort((a, b) => {
      const dateA = a.createdAt || ''
      const dateB = b.createdAt || ''
      return dateB.localeCompare(dateA)
    })

    return combined.map((row) => ({
      ticketId: row.ticketId,
      dependsOnTicketId: row.dependsOnTicketId,
      dependencyType: row.dependencyType as TicketDependencyType,
      createdAt: new Date(row.createdAt || Date.now()),
    }))
  }

  /**
   * Get tickets that this ticket depends on (blockers).
   */
  async getTicketBlockers(ticketId: string): Promise<Ticket[]> {
    const rows = this.ctx.drizzle
      .select({
        ticket: pmoTickets,
        column_id: pmoWorkflowStatuses.id,
        column_name: pmoWorkflowStatuses.name,
      })
      .from(pmoTickets)
      .innerJoin(pmoTicketDependencies, eq(pmoTickets.id, pmoTicketDependencies.dependsOnTicketId))
      .leftJoin(pmoWorkflowStatuses, eq(pmoTickets.statusId, pmoWorkflowStatuses.id))
      .where(
        and(
          eq(pmoTicketDependencies.ticketId, ticketId),
          eq(pmoTicketDependencies.dependencyType, 'blocks')
        )
      )
      .all()

    const ticketRows: TicketRow[] = rows.map((r) => ({
      ...this.drizzleTicketToRow(r.ticket),
      column_id: r.column_id,
      column_name: r.column_name,
    }))

    return Promise.all(ticketRows.map((row) => rowToTicket(this.ctx.db, row)))
  }

  /**
   * Get tickets that depend on this ticket (blocking).
   */
  async getTicketsBlockedBy(ticketId: string): Promise<Ticket[]> {
    const rows = this.ctx.drizzle
      .select({
        ticket: pmoTickets,
        column_id: pmoWorkflowStatuses.id,
        column_name: pmoWorkflowStatuses.name,
      })
      .from(pmoTickets)
      .innerJoin(pmoTicketDependencies, eq(pmoTickets.id, pmoTicketDependencies.ticketId))
      .leftJoin(pmoWorkflowStatuses, eq(pmoTickets.statusId, pmoWorkflowStatuses.id))
      .where(
        and(
          eq(pmoTicketDependencies.dependsOnTicketId, ticketId),
          eq(pmoTicketDependencies.dependencyType, 'blocks')
        )
      )
      .all()

    const ticketRows: TicketRow[] = rows.map((r) => ({
      ...this.drizzleTicketToRow(r.ticket),
      column_id: r.column_id,
      column_name: r.column_name,
    }))

    return Promise.all(ticketRows.map((row) => rowToTicket(this.ctx.db, row)))
  }

  /**
   * Check if a ticket is blocked by incomplete dependencies.
   */
  async isTicketBlocked(ticketId: string): Promise<boolean> {
    const blockers = await this.getTicketBlockers(ticketId)
    return blockers.some((t) => t.status !== 'done' && t.status !== 'canceled')
  }

  // =========================================================================
  // Spec Dependencies
  // =========================================================================

  /**
   * Create a dependency between two specs.
   */
  async createSpecDependency(
    specId: string,
    dependsOnSpecId: string,
    dependencyType: SpecDependencyType = 'depends_on'
  ): Promise<SpecDependency> {
    // Validate specs exist
    const spec = this.ctx.drizzle
      .select({ id: pmoSpecs.id })
      .from(pmoSpecs)
      .where(eq(pmoSpecs.id, specId))
      .get()
    if (!spec) throw new PMOError('NOT_FOUND', `Spec not found: ${specId}`)

    const dependsOn = this.ctx.drizzle
      .select({ id: pmoSpecs.id })
      .from(pmoSpecs)
      .where(eq(pmoSpecs.id, dependsOnSpecId))
      .get()
    if (!dependsOn) throw new PMOError('NOT_FOUND', `Spec not found: ${dependsOnSpecId}`)

    try {
      this.ctx.drizzle.insert(pmoSpecDependencies).values({
        specId,
        dependsOnSpecId,
        dependencyType,
      }).run()

      return {
        specId,
        dependsOnSpecId,
        dependencyType,
        createdAt: new Date(),
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint')) {
        throw new PMOError('CONFLICT', 'Dependency already exists')
      }
      if (error instanceof Error && error.message.includes('CHECK constraint')) {
        throw new PMOError('INVALID', 'Cannot create self-dependency')
      }
      throw error
    }
  }

  /**
   * Delete a spec dependency.
   */
  async deleteSpecDependency(
    specId: string,
    dependsOnSpecId: string,
    dependencyType?: SpecDependencyType
  ): Promise<void> {
    const conditions = [
      eq(pmoSpecDependencies.specId, specId),
      eq(pmoSpecDependencies.dependsOnSpecId, dependsOnSpecId),
    ]

    if (dependencyType) {
      conditions.push(eq(pmoSpecDependencies.dependencyType, dependencyType))
    }

    const result = this.ctx.drizzle
      .delete(pmoSpecDependencies)
      .where(and(...conditions))
      .run()

    if (result.changes === 0) {
      throw new PMOError('NOT_FOUND', 'Dependency not found')
    }
  }

  /**
   * List dependencies for a spec.
   */
  async listSpecDependencies(specId: string): Promise<SpecDependency[]> {
    const rows = this.ctx.drizzle
      .select()
      .from(pmoSpecDependencies)
      .where(eq(pmoSpecDependencies.specId, specId))
      .orderBy(desc(pmoSpecDependencies.createdAt))
      .all()

    return rows.map((row) => ({
      specId: row.specId,
      dependsOnSpecId: row.dependsOnSpecId,
      dependencyType: row.dependencyType as SpecDependencyType,
      createdAt: new Date(row.createdAt || Date.now()),
    }))
  }

  // =========================================================================
  // Epic Dependencies
  // =========================================================================

  /**
   * Create a dependency between two epics.
   */
  async createEpicDependency(
    epicId: string,
    dependsOnEpicId: string,
    dependencyType: EpicDependencyType = 'blocks'
  ): Promise<EpicDependency> {
    // Validate epics exist
    const epic = this.ctx.drizzle
      .select({ id: pmoEpics.id })
      .from(pmoEpics)
      .where(eq(pmoEpics.id, epicId))
      .get()
    if (!epic) throw new PMOError('NOT_FOUND', `Epic not found: ${epicId}`)

    const dependsOn = this.ctx.drizzle
      .select({ id: pmoEpics.id })
      .from(pmoEpics)
      .where(eq(pmoEpics.id, dependsOnEpicId))
      .get()
    if (!dependsOn) throw new PMOError('NOT_FOUND', `Epic not found: ${dependsOnEpicId}`)

    try {
      this.ctx.drizzle.insert(pmoEpicDependencies).values({
        epicId,
        dependsOnEpicId,
        dependencyType,
      }).run()

      return {
        epicId,
        dependsOnEpicId,
        dependencyType,
        createdAt: new Date(),
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint')) {
        throw new PMOError('CONFLICT', 'Dependency already exists')
      }
      if (error instanceof Error && error.message.includes('CHECK constraint')) {
        throw new PMOError('INVALID', 'Cannot create self-dependency')
      }
      throw error
    }
  }

  /**
   * Delete an epic dependency.
   */
  async deleteEpicDependency(
    epicId: string,
    dependsOnEpicId: string,
    dependencyType?: EpicDependencyType
  ): Promise<void> {
    const conditions = [
      eq(pmoEpicDependencies.epicId, epicId),
      eq(pmoEpicDependencies.dependsOnEpicId, dependsOnEpicId),
    ]

    if (dependencyType) {
      conditions.push(eq(pmoEpicDependencies.dependencyType, dependencyType))
    }

    const result = this.ctx.drizzle
      .delete(pmoEpicDependencies)
      .where(and(...conditions))
      .run()

    if (result.changes === 0) {
      throw new PMOError('NOT_FOUND', 'Dependency not found')
    }
  }

  /**
   * List dependencies for an epic.
   */
  async listEpicDependencies(epicId: string): Promise<EpicDependency[]> {
    const rows = this.ctx.drizzle
      .select()
      .from(pmoEpicDependencies)
      .where(eq(pmoEpicDependencies.epicId, epicId))
      .orderBy(desc(pmoEpicDependencies.createdAt))
      .all()

    return rows.map((row) => ({
      epicId: row.epicId,
      dependsOnEpicId: row.dependsOnEpicId,
      dependencyType: row.dependencyType as EpicDependencyType,
      createdAt: new Date(row.createdAt || Date.now()),
    }))
  }

  /**
   * Check if an epic is blocked by incomplete dependencies.
   */
  async isEpicBlocked(epicId: string): Promise<boolean> {
    const rows = this.ctx.drizzle
      .select({ status: pmoEpics.status })
      .from(pmoEpics)
      .innerJoin(pmoEpicDependencies, eq(pmoEpics.id, pmoEpicDependencies.dependsOnEpicId))
      .where(
        and(
          eq(pmoEpicDependencies.epicId, epicId),
          eq(pmoEpicDependencies.dependencyType, 'blocks')
        )
      )
      .all()

    return rows.some((r) => r.status !== 'complete' && r.status !== 'dropped')
  }

  // =========================================================================
  // Private Helpers
  // =========================================================================

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

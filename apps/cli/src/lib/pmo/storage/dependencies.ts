/**
 * Dependency operations for tickets, specs, and epics.
 */

import { PMO_TABLES } from '../schema.js'
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

const T = PMO_TABLES

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
    const ticket = this.ctx.db.prepare(`SELECT id FROM ${T.tickets} WHERE id = ?`).get(ticketId)
    if (!ticket) throw new PMOError('NOT_FOUND', `Ticket not found: ${ticketId}`)

    const dependsOn = this.ctx.db.prepare(`SELECT id FROM ${T.tickets} WHERE id = ?`).get(
      dependsOnTicketId
    )
    if (!dependsOn) throw new PMOError('NOT_FOUND', `Ticket not found: ${dependsOnTicketId}`)

    try {
      this.ctx.db.prepare(`
        INSERT INTO ${T.ticket_dependencies} (ticket_id, depends_on_ticket_id, dependency_type)
        VALUES (?, ?, ?)
      `).run(ticketId, dependsOnTicketId, dependencyType)

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
    let query = `DELETE FROM ${T.ticket_dependencies} WHERE ticket_id = ? AND depends_on_ticket_id = ?`
    const params: unknown[] = [ticketId, dependsOnTicketId]

    if (dependencyType) {
      query += ' AND dependency_type = ?'
      params.push(dependencyType)
    }

    const result = this.ctx.db.prepare(query).run(...params)
    if (result.changes === 0) {
      throw new PMOError('NOT_FOUND', 'Dependency not found')
    }
  }

  /**
   * List dependencies for a ticket.
   */
  async listTicketDependencies(ticketId: string): Promise<TicketDependency[]> {
    const rows = this.ctx.db.prepare(`
      SELECT ticket_id, depends_on_ticket_id, dependency_type, created_at
      FROM ${T.ticket_dependencies}
      WHERE ticket_id = ?
      ORDER BY created_at DESC
    `).all(ticketId) as Array<{
      ticket_id: string
      depends_on_ticket_id: string
      dependency_type: string
      created_at: string
    }>

    return rows.map((row) => ({
      ticketId: row.ticket_id,
      dependsOnTicketId: row.depends_on_ticket_id,
      dependencyType: row.dependency_type as TicketDependencyType,
      createdAt: new Date(row.created_at),
    }))
  }

  /**
   * Get tickets that this ticket depends on (blockers).
   */
  async getTicketBlockers(ticketId: string): Promise<Ticket[]> {
    const rows = this.ctx.db.prepare(`
      SELECT t.*,
             ws.id as column_id,
             ws.name as column_name,
             ws.position as position
      FROM ${T.tickets} t
      JOIN ${T.ticket_dependencies} d ON t.id = d.depends_on_ticket_id
      LEFT JOIN ${T.workflow_statuses} ws ON t.status_id = ws.id
      WHERE d.ticket_id = ? AND d.dependency_type = 'blocks'
    `).all(ticketId) as TicketRow[]

    return Promise.all(rows.map((row) => rowToTicket(this.ctx.db, row)))
  }

  /**
   * Get tickets that depend on this ticket (blocking).
   */
  async getTicketsBlockedBy(ticketId: string): Promise<Ticket[]> {
    const rows = this.ctx.db.prepare(`
      SELECT t.*,
             ws.id as column_id,
             ws.name as column_name,
             ws.position as position
      FROM ${T.tickets} t
      JOIN ${T.ticket_dependencies} d ON t.id = d.ticket_id
      LEFT JOIN ${T.workflow_statuses} ws ON t.status_id = ws.id
      WHERE d.depends_on_ticket_id = ? AND d.dependency_type = 'blocks'
    `).all(ticketId) as TicketRow[]

    return Promise.all(rows.map((row) => rowToTicket(this.ctx.db, row)))
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
    const spec = this.ctx.db.prepare(`SELECT id FROM ${T.specs} WHERE id = ?`).get(specId)
    if (!spec) throw new PMOError('NOT_FOUND', `Spec not found: ${specId}`)

    const dependsOn = this.ctx.db.prepare(`SELECT id FROM ${T.specs} WHERE id = ?`).get(
      dependsOnSpecId
    )
    if (!dependsOn) throw new PMOError('NOT_FOUND', `Spec not found: ${dependsOnSpecId}`)

    try {
      this.ctx.db.prepare(`
        INSERT INTO ${T.spec_dependencies} (spec_id, depends_on_spec_id, dependency_type)
        VALUES (?, ?, ?)
      `).run(specId, dependsOnSpecId, dependencyType)

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
    let query = `DELETE FROM ${T.spec_dependencies} WHERE spec_id = ? AND depends_on_spec_id = ?`
    const params: unknown[] = [specId, dependsOnSpecId]

    if (dependencyType) {
      query += ' AND dependency_type = ?'
      params.push(dependencyType)
    }

    const result = this.ctx.db.prepare(query).run(...params)
    if (result.changes === 0) {
      throw new PMOError('NOT_FOUND', 'Dependency not found')
    }
  }

  /**
   * List dependencies for a spec.
   */
  async listSpecDependencies(specId: string): Promise<SpecDependency[]> {
    const rows = this.ctx.db.prepare(`
      SELECT spec_id, depends_on_spec_id, dependency_type, created_at
      FROM ${T.spec_dependencies}
      WHERE spec_id = ?
      ORDER BY created_at DESC
    `).all(specId) as Array<{
      spec_id: string
      depends_on_spec_id: string
      dependency_type: string
      created_at: string
    }>

    return rows.map((row) => ({
      specId: row.spec_id,
      dependsOnSpecId: row.depends_on_spec_id,
      dependencyType: row.dependency_type as SpecDependencyType,
      createdAt: new Date(row.created_at),
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
    const epic = this.ctx.db.prepare(`SELECT id FROM ${T.epics} WHERE id = ?`).get(epicId)
    if (!epic) throw new PMOError('NOT_FOUND', `Epic not found: ${epicId}`)

    const dependsOn = this.ctx.db.prepare(`SELECT id FROM ${T.epics} WHERE id = ?`).get(
      dependsOnEpicId
    )
    if (!dependsOn) throw new PMOError('NOT_FOUND', `Epic not found: ${dependsOnEpicId}`)

    try {
      this.ctx.db.prepare(`
        INSERT INTO ${T.epic_dependencies} (epic_id, depends_on_epic_id, dependency_type)
        VALUES (?, ?, ?)
      `).run(epicId, dependsOnEpicId, dependencyType)

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
    let query = `DELETE FROM ${T.epic_dependencies} WHERE epic_id = ? AND depends_on_epic_id = ?`
    const params: unknown[] = [epicId, dependsOnEpicId]

    if (dependencyType) {
      query += ' AND dependency_type = ?'
      params.push(dependencyType)
    }

    const result = this.ctx.db.prepare(query).run(...params)
    if (result.changes === 0) {
      throw new PMOError('NOT_FOUND', 'Dependency not found')
    }
  }

  /**
   * List dependencies for an epic.
   */
  async listEpicDependencies(epicId: string): Promise<EpicDependency[]> {
    const rows = this.ctx.db.prepare(`
      SELECT epic_id, depends_on_epic_id, dependency_type, created_at
      FROM ${T.epic_dependencies}
      WHERE epic_id = ?
      ORDER BY created_at DESC
    `).all(epicId) as Array<{
      epic_id: string
      depends_on_epic_id: string
      dependency_type: string
      created_at: string
    }>

    return rows.map((row) => ({
      epicId: row.epic_id,
      dependsOnEpicId: row.depends_on_epic_id,
      dependencyType: row.dependency_type as EpicDependencyType,
      createdAt: new Date(row.created_at),
    }))
  }

  /**
   * Check if an epic is blocked by incomplete dependencies.
   */
  async isEpicBlocked(epicId: string): Promise<boolean> {
    const rows = this.ctx.db.prepare(`
      SELECT e.status FROM ${T.epics} e
      JOIN ${T.epic_dependencies} d ON e.id = d.depends_on_epic_id
      WHERE d.epic_id = ? AND d.dependency_type = 'blocks'
    `).all(epicId) as Array<{ status: string }>

    return rows.some((r) => r.status !== 'complete' && r.status !== 'dropped')
  }
}

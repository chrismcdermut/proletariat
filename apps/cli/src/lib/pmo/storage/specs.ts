/**
 * Spec operations for PMO.
 */

import { PMO_TABLES } from '../schema.js'
import { PMOError, Project, Spec, SpecFilter, Ticket } from '../types.js'
import { generateEntityId } from '../utils.js'
import { StorageContext, SpecRow, TicketRow } from './types.js'
import { rowToSpec, rowToTicket } from './helpers.js'

const T = PMO_TABLES

export class SpecStorage {
  constructor(private ctx: StorageContext) {}

  /**
   * Create a new spec.
   */
  async createSpec(spec: Partial<Spec>): Promise<Spec> {
    const id = spec.id || generateEntityId(this.ctx.db, 'spec')
    const now = Date.now()

    this.ctx.db.prepare(`
      INSERT INTO ${T.specs} (
        id, title, status, type, tags, depends_on,
        problem, solution, decisions, not_now, ui_ux,
        acceptance_criteria, open_questions,
        requirements_functional, requirements_technical,
        context, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      spec.title || 'Untitled Spec',
      spec.status || 'draft',
      spec.type || null,
      spec.tags ? JSON.stringify(spec.tags) : null,
      spec.dependsOn ? JSON.stringify(spec.dependsOn) : null,
      spec.problem || null,
      spec.solution || null,
      spec.decisions || null,
      spec.notNow || null,
      spec.uiUx || null,
      spec.acceptanceCriteria || null,
      spec.openQuestions || null,
      spec.requirementsFunctional || null,
      spec.requirementsTechnical || null,
      spec.context || null,
      now,
      now
    )

    return {
      id,
      title: spec.title || 'Untitled Spec',
      status: spec.status || 'draft',
      type: spec.type,
      tags: spec.tags,
      dependsOn: spec.dependsOn,
      problem: spec.problem,
      solution: spec.solution,
      decisions: spec.decisions,
      notNow: spec.notNow,
      uiUx: spec.uiUx,
      acceptanceCriteria: spec.acceptanceCriteria,
      openQuestions: spec.openQuestions,
      requirementsFunctional: spec.requirementsFunctional,
      requirementsTechnical: spec.requirementsTechnical,
      context: spec.context,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    }
  }

  /**
   * Get a spec by ID.
   */
  async getSpec(id: string): Promise<Spec | null> {
    const row = this.ctx.db.prepare(`
      SELECT id, title, status, type, tags, depends_on,
             problem, solution, decisions, not_now, ui_ux,
             acceptance_criteria, open_questions,
             requirements_functional, requirements_technical,
             context, created_at, updated_at
      FROM ${T.specs} WHERE id = ?
    `).get(id) as SpecRow | undefined

    if (!row) return null

    return rowToSpec(row)
  }

  /**
   * List specs with optional filters.
   */
  async listSpecs(filter?: SpecFilter): Promise<Spec[]> {
    let query = `
      SELECT id, title, status, type, tags, depends_on,
             problem, solution, decisions, not_now, ui_ux,
             acceptance_criteria, open_questions,
             requirements_functional, requirements_technical,
             context, created_at, updated_at
      FROM ${T.specs} WHERE 1=1
    `
    const params: unknown[] = []

    if (filter?.status) {
      query += ' AND status = ?'
      params.push(filter.status)
    }
    if (filter?.type) {
      query += ' AND type = ?'
      params.push(filter.type)
    }
    if (filter?.search) {
      query += ' AND (id LIKE ? OR title LIKE ? OR problem LIKE ? OR solution LIKE ?)'
      params.push(
        `%${filter.search}%`,
        `%${filter.search}%`,
        `%${filter.search}%`,
        `%${filter.search}%`
      )
    }

    query += ' ORDER BY title'

    const rows = this.ctx.db.prepare(query).all(...params) as SpecRow[]

    return rows.map(rowToSpec)
  }

  /**
   * Update a spec.
   */
  async updateSpec(id: string, changes: Partial<Spec>): Promise<Spec> {
    const existing = await this.getSpec(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Spec not found: ${id}`)
    }

    const updates: string[] = []
    const params: unknown[] = []

    if (changes.title !== undefined) {
      updates.push('title = ?')
      params.push(changes.title)
    }
    if (changes.status !== undefined) {
      updates.push('status = ?')
      params.push(changes.status)
    }
    if (changes.type !== undefined) {
      updates.push('type = ?')
      params.push(changes.type)
    }
    if (changes.tags !== undefined) {
      updates.push('tags = ?')
      params.push(JSON.stringify(changes.tags))
    }
    if (changes.dependsOn !== undefined) {
      updates.push('depends_on = ?')
      params.push(JSON.stringify(changes.dependsOn))
    }
    if (changes.problem !== undefined) {
      updates.push('problem = ?')
      params.push(changes.problem)
    }
    if (changes.solution !== undefined) {
      updates.push('solution = ?')
      params.push(changes.solution)
    }
    if (changes.decisions !== undefined) {
      updates.push('decisions = ?')
      params.push(changes.decisions)
    }
    if (changes.notNow !== undefined) {
      updates.push('not_now = ?')
      params.push(changes.notNow)
    }
    if (changes.uiUx !== undefined) {
      updates.push('ui_ux = ?')
      params.push(changes.uiUx)
    }
    if (changes.acceptanceCriteria !== undefined) {
      updates.push('acceptance_criteria = ?')
      params.push(changes.acceptanceCriteria)
    }
    if (changes.openQuestions !== undefined) {
      updates.push('open_questions = ?')
      params.push(changes.openQuestions)
    }
    if (changes.requirementsFunctional !== undefined) {
      updates.push('requirements_functional = ?')
      params.push(changes.requirementsFunctional)
    }
    if (changes.requirementsTechnical !== undefined) {
      updates.push('requirements_technical = ?')
      params.push(changes.requirementsTechnical)
    }
    if (changes.context !== undefined) {
      updates.push('context = ?')
      params.push(changes.context)
    }

    if (updates.length > 0) {
      updates.push('updated_at = ?')
      params.push(Date.now())
      params.push(id)

      this.ctx.db.prepare(`UPDATE ${T.specs} SET ${updates.join(', ')} WHERE id = ?`).run(
        ...params
      )
    }

    return (await this.getSpec(id)) as Spec
  }

  /**
   * Delete a spec.
   */
  async deleteSpec(id: string): Promise<void> {
    const existing = await this.getSpec(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Spec not found: ${id}`)
    }

    this.ctx.db.prepare(`DELETE FROM ${T.specs} WHERE id = ?`).run(id)
    this.ctx.db.prepare(`UPDATE ${T.tickets} SET spec_id = NULL WHERE spec_id = ?`).run(id)
  }

  /**
   * Link a ticket to a spec.
   */
  async linkTicketToSpec(ticketId: string, specId: string): Promise<void> {
    // Verify ticket exists and get its project
    const ticket = this.ctx.db.prepare(`
      SELECT id, project_id FROM ${T.tickets} WHERE id = ?
    `).get(ticketId) as { id: string; project_id: string } | undefined
    if (!ticket) {
      throw new PMOError('NOT_FOUND', `Ticket not found: ${ticketId}`, ticketId)
    }

    // Verify spec exists
    const spec = await this.getSpec(specId)
    if (!spec) {
      throw new PMOError('NOT_FOUND', `Spec not found: ${specId}`)
    }

    this.ctx.db.prepare(`
      UPDATE ${T.tickets}
      SET spec_id = ?, updated_at = ?
      WHERE id = ?
    `).run(specId, Date.now(), ticketId)

    this.ctx.updateBoardTimestamp(ticket.project_id)
  }

  /**
   * Unlink a ticket from a spec.
   */
  async unlinkTicketFromSpec(ticketId: string, specId: string): Promise<void> {
    // Get ticket's project for board timestamp update
    const ticket = this.ctx.db.prepare(`
      SELECT project_id FROM ${T.tickets} WHERE id = ?
    `).get(ticketId) as { project_id: string } | undefined

    this.ctx.db.prepare(`
      UPDATE ${T.tickets}
      SET spec_id = NULL, updated_at = ?
      WHERE id = ? AND spec_id = ?
    `).run(Date.now(), ticketId, specId)

    if (ticket) {
      this.ctx.updateBoardTimestamp(ticket.project_id)
    }
  }

  /**
   * Get tickets for a spec.
   */
  async getTicketsForSpec(projectId: string, specId: string): Promise<Ticket[]> {
    const rows = this.ctx.db.prepare(`
      SELECT t.*, bt.column_id, bt.position, c.name as column_name
      FROM ${T.tickets} t
      LEFT JOIN ${T.board_tickets} bt ON t.id = bt.ticket_id AND t.project_id = bt.project_id
      LEFT JOIN ${T.columns} c ON bt.project_id = c.project_id AND bt.column_id = c.id
      WHERE t.project_id = ? AND t.spec_id = ?
      ORDER BY c.position, bt.position
    `).all(projectId, specId) as TicketRow[]

    return Promise.all(rows.map((row) => rowToTicket(this.ctx.db, row)))
  }

  /**
   * Get specs for a ticket.
   */
  async getSpecsForTicket(ticketId: string): Promise<Spec[]> {
    const ticket = this.ctx.db.prepare(`
      SELECT spec_id FROM ${T.tickets} WHERE id = ?
    `).get(ticketId) as { spec_id: string | null } | undefined

    if (!ticket || !ticket.spec_id) {
      return []
    }

    const spec = await this.getSpec(ticket.spec_id)
    return spec ? [spec] : []
  }

  /**
   * Add a spec dependency.
   */
  async addSpecDependency(specId: string, dependsOnId: string): Promise<void> {
    const spec = await this.getSpec(specId)
    if (!spec) {
      throw new PMOError('NOT_FOUND', `Spec not found: ${specId}`)
    }

    const dependsOnSpec = await this.getSpec(dependsOnId)
    if (!dependsOnSpec) {
      throw new PMOError('NOT_FOUND', `Spec not found: ${dependsOnId}`)
    }

    this.ctx.db.prepare(`
      INSERT OR IGNORE INTO ${T.spec_dependencies} (spec_id, depends_on, created_at)
      VALUES (?, ?, ?)
    `).run(specId, dependsOnId, Date.now())
  }

  /**
   * Remove a spec dependency.
   */
  async removeSpecDependency(specId: string, dependsOnId: string): Promise<void> {
    this.ctx.db.prepare(`
      DELETE FROM ${T.spec_dependencies}
      WHERE spec_id = ? AND depends_on = ?
    `).run(specId, dependsOnId)
  }

  /**
   * Get dependencies for a spec.
   */
  async getSpecDependencies(specId: string): Promise<Spec[]> {
    const rows = this.ctx.db.prepare(`
      SELECT depends_on FROM ${T.spec_dependencies} WHERE spec_id = ?
    `).all(specId) as Array<{ depends_on: string }>

    const specs: Spec[] = []
    for (const row of rows) {
      const spec = await this.getSpec(row.depends_on)
      if (spec) specs.push(spec)
    }
    return specs
  }

  /**
   * Get specs that depend on a spec.
   */
  async getSpecDependents(specId: string): Promise<Spec[]> {
    const rows = this.ctx.db.prepare(`
      SELECT spec_id FROM ${T.spec_dependencies} WHERE depends_on = ?
    `).all(specId) as Array<{ spec_id: string }>

    const specs: Spec[] = []
    for (const row of rows) {
      const spec = await this.getSpec(row.spec_id)
      if (spec) specs.push(spec)
    }
    return specs
  }

  /**
   * Link a project to a spec.
   */
  async linkProjectToSpec(projectId: string, specId: string): Promise<void> {
    // Verify project exists
    const project = this.ctx.db.prepare(`
      SELECT id FROM ${T.projects} WHERE id = ?
    `).get(projectId)
    if (!project) {
      throw new PMOError('NOT_FOUND', `Project "${projectId}" not found`)
    }

    // Verify spec exists
    const spec = await this.getSpec(specId)
    if (!spec) {
      throw new PMOError('NOT_FOUND', `Spec "${specId}" not found`)
    }

    this.ctx.db.prepare(`
      INSERT OR IGNORE INTO ${T.project_specs} (project_id, spec_id, created_at)
      VALUES (?, ?, ?)
    `).run(projectId, specId, Date.now())
  }

  /**
   * Unlink a project from a spec.
   */
  async unlinkProjectFromSpec(projectId: string, specId: string): Promise<void> {
    this.ctx.db.prepare(`
      DELETE FROM ${T.project_specs}
      WHERE project_id = ? AND spec_id = ?
    `).run(projectId, specId)
  }

  /**
   * Get specs for a project.
   */
  async getSpecsForProject(projectId: string): Promise<Spec[]> {
    const rows = this.ctx.db.prepare(`
      SELECT s.id, s.title, s.status, s.type, s.tags, s.depends_on,
             s.problem, s.solution, s.decisions, s.not_now, s.ui_ux,
             s.acceptance_criteria, s.open_questions,
             s.requirements_functional, s.requirements_technical,
             s.context, s.created_at, s.updated_at
      FROM ${T.specs} s
      JOIN ${T.project_specs} ps ON s.id = ps.spec_id
      WHERE ps.project_id = ?
      ORDER BY s.title
    `).all(projectId) as SpecRow[]

    return rows.map(rowToSpec)
  }

  /**
   * Get projects for a spec.
   */
  async getProjectsForSpec(specId: string): Promise<Project[]> {
    const rows = this.ctx.db.prepare(`
      SELECT p.*
      FROM ${T.projects} p
      JOIN ${T.project_specs} ps ON p.id = ps.project_id
      WHERE ps.spec_id = ?
      ORDER BY p.name
    `).all(specId) as Array<{
      id: string
      name: string
      template: string | null
      description: string | null
      status: string
      phase_id: string | null
      is_archived: number
      target_date: string | null
      created_at: string
      updated_at: string
    }>

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      template: row.template || undefined,
      description: row.description || undefined,
      status: (row.status || 'active') as 'draft' | 'active' | 'completed' | 'archived',
      phaseId: row.phase_id || undefined,
      isArchived: row.is_archived === 1,
      targetDate: row.target_date ? new Date(row.target_date) : undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }))
  }
}

/**
 * Spec operations for PMO.
 *
 * This module uses Drizzle ORM for type-safe database queries.
 */

import { eq, and, like, or, asc, sql } from 'drizzle-orm'
import {
  pmoSpecs,
  pmoProjects,
  pmoTickets,
  pmoWorkflowStatuses,
  pmoProjectSpecs,
  pmoSpecDependencies,
} from '../../database/drizzle-schema.js'
import { PMOError, Project, Spec, SpecFilter, Ticket } from '../types.js'
import { generateEntityId } from '../utils.js'
import { StorageContext, TicketRow } from './types.js'
import { rowToSpec, rowToTicket, wrapSqliteError } from './helpers.js'

export class SpecStorage {
  constructor(private ctx: StorageContext) {}

  /**
   * Create a new spec.
   */
  async createSpec(spec: Partial<Spec>): Promise<Spec> {
    const id = spec.id || generateEntityId(this.ctx.db, 'spec')
    const now = Date.now()

    try {
      this.ctx.drizzle.insert(pmoSpecs).values({
        id,
        title: spec.title || 'Untitled Spec',
        status: spec.status || 'draft',
        type: spec.type || null,
        tags: spec.tags ? JSON.stringify(spec.tags) : null,
        problem: spec.problem || null,
        solution: spec.solution || null,
        decisions: spec.decisions || null,
        notNow: spec.notNow || null,
        uiUx: spec.uiUx || null,
        acceptanceCriteria: spec.acceptanceCriteria || null,
        openQuestions: spec.openQuestions || null,
        requirementsFunctional: spec.requirementsFunctional || null,
        requirementsTechnical: spec.requirementsTechnical || null,
        context: spec.context || null,
        createdAt: String(now),
        updatedAt: String(now),
      }).run()
    } catch (err) {
      wrapSqliteError('Spec', 'create', err)
    }

    return {
      id,
      title: spec.title || 'Untitled Spec',
      status: spec.status || 'draft',
      type: spec.type,
      tags: spec.tags,
      // Note: dependsOn is now handled via spec_dependencies table
      dependsOn: undefined,
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
    const row = this.ctx.drizzle
      .select({
        id: pmoSpecs.id,
        title: pmoSpecs.title,
        status: pmoSpecs.status,
        type: pmoSpecs.type,
        tags: pmoSpecs.tags,
        problem: pmoSpecs.problem,
        solution: pmoSpecs.solution,
        decisions: pmoSpecs.decisions,
        not_now: pmoSpecs.notNow,
        ui_ux: pmoSpecs.uiUx,
        acceptance_criteria: pmoSpecs.acceptanceCriteria,
        open_questions: pmoSpecs.openQuestions,
        requirements_functional: pmoSpecs.requirementsFunctional,
        requirements_technical: pmoSpecs.requirementsTechnical,
        context: pmoSpecs.context,
        created_at: pmoSpecs.createdAt,
        updated_at: pmoSpecs.updatedAt,
      })
      .from(pmoSpecs)
      .where(eq(pmoSpecs.id, id))
      .get()

    if (!row) return null

    return rowToSpec(row as any)
  }

  /**
   * List specs with optional filters.
   */
  async listSpecs(filter?: SpecFilter): Promise<Spec[]> {
    let query = this.ctx.drizzle
      .select({
        id: pmoSpecs.id,
        title: pmoSpecs.title,
        status: pmoSpecs.status,
        type: pmoSpecs.type,
        tags: pmoSpecs.tags,
        problem: pmoSpecs.problem,
        solution: pmoSpecs.solution,
        decisions: pmoSpecs.decisions,
        not_now: pmoSpecs.notNow,
        ui_ux: pmoSpecs.uiUx,
        acceptance_criteria: pmoSpecs.acceptanceCriteria,
        open_questions: pmoSpecs.openQuestions,
        requirements_functional: pmoSpecs.requirementsFunctional,
        requirements_technical: pmoSpecs.requirementsTechnical,
        context: pmoSpecs.context,
        created_at: pmoSpecs.createdAt,
        updated_at: pmoSpecs.updatedAt,
      })
      .from(pmoSpecs)
      .$dynamic()

    const conditions = []

    if (filter?.status) {
      conditions.push(eq(pmoSpecs.status, filter.status))
    }
    if (filter?.type) {
      conditions.push(eq(pmoSpecs.type, filter.type))
    }
    if (filter?.search) {
      conditions.push(
        or(
          like(pmoSpecs.id, `%${filter.search}%`),
          like(pmoSpecs.title, `%${filter.search}%`),
          like(pmoSpecs.problem, `%${filter.search}%`),
          like(pmoSpecs.solution, `%${filter.search}%`)
        )
      )
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions))
    }

    const rows = query
      .orderBy(asc(pmoSpecs.title))
      .all()

    return rows.map((row) => rowToSpec(row as any))
  }

  /**
   * Update a spec.
   */
  async updateSpec(id: string, changes: Partial<Spec>): Promise<Spec> {
    const existing = await this.getSpec(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Spec not found: ${id}`)
    }

    const updates: Partial<typeof pmoSpecs.$inferInsert> = {}

    if (changes.title !== undefined) updates.title = changes.title
    if (changes.status !== undefined) updates.status = changes.status
    if (changes.type !== undefined) updates.type = changes.type
    if (changes.tags !== undefined) updates.tags = JSON.stringify(changes.tags)
    if (changes.problem !== undefined) updates.problem = changes.problem
    if (changes.solution !== undefined) updates.solution = changes.solution
    if (changes.decisions !== undefined) updates.decisions = changes.decisions
    if (changes.notNow !== undefined) updates.notNow = changes.notNow
    if (changes.uiUx !== undefined) updates.uiUx = changes.uiUx
    if (changes.acceptanceCriteria !== undefined) updates.acceptanceCriteria = changes.acceptanceCriteria
    if (changes.openQuestions !== undefined) updates.openQuestions = changes.openQuestions
    if (changes.requirementsFunctional !== undefined) updates.requirementsFunctional = changes.requirementsFunctional
    if (changes.requirementsTechnical !== undefined) updates.requirementsTechnical = changes.requirementsTechnical
    if (changes.context !== undefined) updates.context = changes.context

    if (Object.keys(updates).length > 0) {
      updates.updatedAt = String(Date.now())
      this.ctx.drizzle
        .update(pmoSpecs)
        .set(updates)
        .where(eq(pmoSpecs.id, id))
        .run()
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

    try {
      this.ctx.drizzle.delete(pmoSpecs).where(eq(pmoSpecs.id, id)).run()
      this.ctx.drizzle
        .update(pmoTickets)
        .set({ specId: null })
        .where(eq(pmoTickets.specId, id))
        .run()
    } catch (err) {
      wrapSqliteError('Spec', 'delete', err)
    }
  }

  /**
   * Link a ticket to a spec.
   */
  async linkTicketToSpec(ticketId: string, specId: string): Promise<void> {
    // Verify ticket exists and get its project
    const ticket = this.ctx.drizzle
      .select({ id: pmoTickets.id, projectId: pmoTickets.projectId })
      .from(pmoTickets)
      .where(eq(pmoTickets.id, ticketId))
      .get()

    if (!ticket) {
      throw new PMOError('NOT_FOUND', `Ticket not found: ${ticketId}`, ticketId)
    }

    // Verify spec exists
    const spec = await this.getSpec(specId)
    if (!spec) {
      throw new PMOError('NOT_FOUND', `Spec not found: ${specId}`)
    }

    this.ctx.drizzle
      .update(pmoTickets)
      .set({ specId, updatedAt: String(Date.now()) })
      .where(eq(pmoTickets.id, ticketId))
      .run()

    this.ctx.updateBoardTimestamp(ticket.projectId)
  }

  /**
   * Unlink a ticket from a spec.
   */
  async unlinkTicketFromSpec(ticketId: string, specId: string): Promise<void> {
    // Get ticket's project for board timestamp update
    const ticket = this.ctx.drizzle
      .select({ projectId: pmoTickets.projectId })
      .from(pmoTickets)
      .where(eq(pmoTickets.id, ticketId))
      .get()

    this.ctx.drizzle
      .update(pmoTickets)
      .set({ specId: null, updatedAt: String(Date.now()) })
      .where(and(
        eq(pmoTickets.id, ticketId),
        eq(pmoTickets.specId, specId)
      ))
      .run()

    if (ticket) {
      this.ctx.updateBoardTimestamp(ticket.projectId)
    }
  }

  /**
   * Get tickets for a spec.
   */
  async getTicketsForSpec(projectId: string, specId: string): Promise<Ticket[]> {
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
      .where(and(
        eq(pmoTickets.projectId, projectId),
        eq(pmoTickets.specId, specId)
      ))
      .orderBy(asc(pmoWorkflowStatuses.position), asc(pmoTickets.position), asc(pmoTickets.createdAt))
      .all() as unknown as TicketRow[]

    return Promise.all(rows.map((row) => rowToTicket(this.ctx.drizzle, row)))
  }

  /**
   * Get specs for a ticket.
   */
  async getSpecsForTicket(ticketId: string): Promise<Spec[]> {
    const ticket = this.ctx.drizzle
      .select({ specId: pmoTickets.specId })
      .from(pmoTickets)
      .where(eq(pmoTickets.id, ticketId))
      .get()

    if (!ticket || !ticket.specId) {
      return []
    }

    const spec = await this.getSpec(ticket.specId)
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

    this.ctx.drizzle
      .insert(pmoSpecDependencies)
      .values({
        specId,
        dependsOnSpecId: dependsOnId,
        createdAt: String(Date.now()),
      })
      .onConflictDoNothing()
      .run()
  }

  /**
   * Remove a spec dependency.
   */
  async removeSpecDependency(specId: string, dependsOnId: string): Promise<void> {
    this.ctx.drizzle
      .delete(pmoSpecDependencies)
      .where(and(
        eq(pmoSpecDependencies.specId, specId),
        eq(pmoSpecDependencies.dependsOnSpecId, dependsOnId)
      ))
      .run()
  }

  /**
   * Get dependencies for a spec.
   */
  async getSpecDependencies(specId: string): Promise<Spec[]> {
    const rows = this.ctx.drizzle
      .select({ dependsOnSpecId: pmoSpecDependencies.dependsOnSpecId })
      .from(pmoSpecDependencies)
      .where(eq(pmoSpecDependencies.specId, specId))
      .all()

    const specs: Spec[] = []
    for (const row of rows) {
      // eslint-disable-next-line no-await-in-loop -- Sequential lookup for relationship chain
      const spec = await this.getSpec(row.dependsOnSpecId)
      if (spec) specs.push(spec)
    }
    return specs
  }

  /**
   * Get specs that depend on a spec.
   */
  async getSpecDependents(specId: string): Promise<Spec[]> {
    const rows = this.ctx.drizzle
      .select({ specId: pmoSpecDependencies.specId })
      .from(pmoSpecDependencies)
      .where(eq(pmoSpecDependencies.dependsOnSpecId, specId))
      .all()

    const specs: Spec[] = []
    for (const row of rows) {
      // eslint-disable-next-line no-await-in-loop -- Sequential lookup for relationship chain
      const spec = await this.getSpec(row.specId)
      if (spec) specs.push(spec)
    }
    return specs
  }

  /**
   * Link a project to a spec.
   */
  async linkProjectToSpec(projectId: string, specId: string): Promise<void> {
    // Verify project exists
    const project = this.ctx.drizzle
      .select({ id: pmoProjects.id })
      .from(pmoProjects)
      .where(eq(pmoProjects.id, projectId))
      .get()

    if (!project) {
      throw new PMOError('NOT_FOUND', `Project "${projectId}" not found`)
    }

    // Verify spec exists
    const spec = await this.getSpec(specId)
    if (!spec) {
      throw new PMOError('NOT_FOUND', `Spec "${specId}" not found`)
    }

    this.ctx.drizzle
      .insert(pmoProjectSpecs)
      .values({
        projectId,
        specId,
        createdAt: String(Date.now()),
      })
      .onConflictDoNothing()
      .run()
  }

  /**
   * Unlink a project from a spec.
   */
  async unlinkProjectFromSpec(projectId: string, specId: string): Promise<void> {
    this.ctx.drizzle
      .delete(pmoProjectSpecs)
      .where(and(
        eq(pmoProjectSpecs.projectId, projectId),
        eq(pmoProjectSpecs.specId, specId)
      ))
      .run()
  }

  /**
   * Get specs for a project.
   */
  async getSpecsForProject(projectId: string): Promise<Spec[]> {
    const rows = this.ctx.drizzle
      .select({
        id: pmoSpecs.id,
        title: pmoSpecs.title,
        status: pmoSpecs.status,
        type: pmoSpecs.type,
        tags: pmoSpecs.tags,
        problem: pmoSpecs.problem,
        solution: pmoSpecs.solution,
        decisions: pmoSpecs.decisions,
        not_now: pmoSpecs.notNow,
        ui_ux: pmoSpecs.uiUx,
        acceptance_criteria: pmoSpecs.acceptanceCriteria,
        open_questions: pmoSpecs.openQuestions,
        requirements_functional: pmoSpecs.requirementsFunctional,
        requirements_technical: pmoSpecs.requirementsTechnical,
        context: pmoSpecs.context,
        created_at: pmoSpecs.createdAt,
        updated_at: pmoSpecs.updatedAt,
      })
      .from(pmoSpecs)
      .innerJoin(pmoProjectSpecs, eq(pmoSpecs.id, pmoProjectSpecs.specId))
      .where(eq(pmoProjectSpecs.projectId, projectId))
      .orderBy(asc(pmoSpecs.title))
      .all()

    return rows.map((row) => rowToSpec(row as any))
  }

  /**
   * Get projects for a spec.
   */
  async getProjectsForSpec(specId: string): Promise<Project[]> {
    const rows = this.ctx.drizzle
      .select({
        id: pmoProjects.id,
        name: pmoProjects.name,
        template: pmoProjects.template,
        description: pmoProjects.description,
        status: pmoProjects.status,
        phaseId: pmoProjects.phaseId,
        workflowId: pmoProjects.workflowId,
        isArchived: pmoProjects.isArchived,
        targetDate: pmoProjects.targetDate,
        initiativeId: pmoProjects.initiativeId,
        createdAt: pmoProjects.createdAt,
        updatedAt: pmoProjects.updatedAt,
      })
      .from(pmoProjects)
      .innerJoin(pmoProjectSpecs, eq(pmoProjects.id, pmoProjectSpecs.projectId))
      .where(eq(pmoProjectSpecs.specId, specId))
      .orderBy(asc(pmoProjects.name))
      .all()

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      template: row.template || undefined,
      description: row.description || undefined,
      status: (row.status || 'active') as 'draft' | 'active' | 'completed' | 'archived',
      phaseId: row.phaseId || undefined,
      isArchived: row.isArchived ?? false,
      targetDate: row.targetDate ? new Date(row.targetDate) : undefined,
      createdAt: new Date(row.createdAt || Date.now()),
      updatedAt: new Date(row.updatedAt || Date.now()),
    }))
  }
}

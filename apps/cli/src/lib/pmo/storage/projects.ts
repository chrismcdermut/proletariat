/**
 * Project operations.
 * Board columns are now derived from workflow statuses (single source of truth).
 *
 * This module uses Drizzle ORM for type-safe database queries.
 */

import { eq, and, like, or, asc, desc, sql, count } from 'drizzle-orm'
import {
  pmoProjects,
  pmoTickets,
  pmoWorkflows,
  pmoWorkflowStatuses,
} from '../../database/drizzle-schema.js'
import {
  Board,
  BoardConfig,
  Column,
  PMOError,
  Project,
  ProjectFilter,
} from '../types.js'
import { generateEntityId, slugify } from '../utils.js'
import { generateBoardMarkdown } from '../markdown.js'
import { StorageContext, TicketRow } from './types.js'
import { rowToTicket, wrapSqliteError } from './helpers.js'

export class ProjectStorage {
  constructor(private ctx: StorageContext) {}

  /**
   * Resolve a project identifier to its actual ID.
   * Tries multiple strategies:
   * 1. Exact ID match
   * 2. Case-insensitive ID match
   * 3. Exact name match
   * 4. Case-insensitive name match
   * 5. Slugified name match (matches slug of project name)
   *
   * @param identifier - Project ID, name, or slug to resolve
   * @returns The actual project ID, or null if not found
   */
  resolveProjectId(identifier: string): string | null {
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

    // 5. Slugified name match - check if identifier is a slug of any project name
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
   * Initialize a project with a workflow.
   * @deprecated Use createProject with a template instead.
   */
  async init(projectId: string, config: BoardConfig): Promise<Board> {
    const projectName = config.name || 'Project Board'
    const now = String(Date.now())

    // Create or update project with default workflow
    this.ctx.drizzle
      .insert(pmoProjects)
      .values({
        id: projectId,
        name: projectName,
        template: 'kanban',
        workflowId: 'default',
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: pmoProjects.id,
        set: {
          name: projectName,
          template: 'kanban',
          workflowId: 'default',
          updatedAt: now,
        },
      })
      .run()

    return this.getBoard(projectId)
  }

  /**
   * Get the project board.
   * Columns are derived from the project's workflow statuses.
   * Tickets are sorted by priority (P0 first) then created_at (oldest first).
   *
   * @param projectIdOrName - Project ID, name, or slug. Will be resolved to actual ID.
   */
  async getBoard(projectIdOrName: string): Promise<Board> {
    // Resolve project identifier to actual ID
    const resolvedId = this.resolveProjectId(projectIdOrName)
    if (!resolvedId) {
      throw new PMOError('NOT_FOUND', `Project not found: ${projectIdOrName}. Run init() first.`)
    }

    // Get project metadata with workflow using resolved ID
    const projectRow = this.ctx.drizzle
      .select({
        id: pmoProjects.id,
        name: pmoProjects.name,
        workflowId: pmoProjects.workflowId,
        updatedAt: pmoProjects.updatedAt,
      })
      .from(pmoProjects)
      .where(eq(pmoProjects.id, resolvedId))
      .get()

    if (!projectRow) {
      throw new PMOError('NOT_FOUND', `Project not found: ${projectIdOrName}. Run init() first.`)
    }

    // Get workflow statuses as columns
    const workflowId = projectRow.workflowId || 'default'
    const statusRows = this.ctx.drizzle
      .select()
      .from(pmoWorkflowStatuses)
      .where(eq(pmoWorkflowStatuses.workflowId, workflowId))
      .orderBy(asc(pmoWorkflowStatuses.position))
      .all()

    // Build columns from statuses, with tickets sorted by priority then created_at
    const columns: Column[] = await Promise.all(
      statusRows.map(async (status) => ({
        id: status.id,
        name: status.name,
        position: status.position,
        status: status.category,
        tickets: await this.getTicketsForStatus(status.id, resolvedId),
      }))
    )

    return {
      id: projectRow.id,
      name: projectRow.name,
      columns,
      updatedAt: new Date(projectRow.updatedAt!),
    }
  }

  /**
   * Get the board as markdown.
   */
  async getBoardMarkdown(projectId: string): Promise<string> {
    const board = await this.getBoard(projectId)
    return generateBoardMarkdown(board)
  }

  /**
   * Create a new project.
   * Assigns a workflow based on the workflow ID (defaults to 'default' workflow).
   */
  async createProject(
    project: { id?: string; name: string; template?: string; description?: string }
  ): Promise<Board> {
    const id = project.id || generateEntityId(this.ctx.db, 'project')
    const workflowId = project.template || 'default'
    const now = Date.now()

    // Try to find a workflow with matching ID
    const workflow = this.ctx.drizzle
      .select({ id: pmoWorkflows.id })
      .from(pmoWorkflows)
      .where(eq(pmoWorkflows.id, workflowId))
      .get()

    // Use the requested workflow if it exists, otherwise fall back to default
    const finalWorkflowId = workflow ? workflowId : 'default'

    // Insert project with workflow
    try {
      this.ctx.drizzle
        .insert(pmoProjects)
        .values({
          id,
          name: project.name,
          template: workflowId,
          description: project.description || null,
          workflowId: finalWorkflowId,
          createdAt: String(now),
          updatedAt: String(now),
        })
        .onConflictDoUpdate({
          target: pmoProjects.id,
          set: {
            name: project.name,
            template: workflowId,
            description: project.description || null,
            workflowId: finalWorkflowId,
            createdAt: String(now),
            updatedAt: String(now),
          },
        })
        .run()
    } catch (err) {
      wrapSqliteError('Project', 'create', err)
    }

    return this.getBoard(id)
  }

  /**
   * Get project board by ID, name, or slug.
   */
  async getProjectBoard(projectIdOrName: string): Promise<Board | null> {
    // Resolve project identifier to actual ID
    const resolvedId = this.resolveProjectId(projectIdOrName)
    if (!resolvedId) {
      return null
    }

    const projectRow = this.ctx.drizzle
      .select({
        id: pmoProjects.id,
        name: pmoProjects.name,
        template: pmoProjects.template,
        description: pmoProjects.description,
        workflowId: pmoProjects.workflowId,
        updatedAt: pmoProjects.updatedAt,
      })
      .from(pmoProjects)
      .where(eq(pmoProjects.id, resolvedId))
      .get()

    if (!projectRow) {
      return null
    }

    // Get workflow statuses as columns
    const workflowId = projectRow.workflowId || 'default'
    const statusRows = this.ctx.drizzle
      .select()
      .from(pmoWorkflowStatuses)
      .where(eq(pmoWorkflowStatuses.workflowId, workflowId))
      .orderBy(asc(pmoWorkflowStatuses.position))
      .all()

    const columns: Column[] = await Promise.all(
      statusRows.map(async (status) => ({
        id: status.id,
        name: status.name,
        position: status.position,
        status: status.category,
        tickets: await this.getTicketsForStatus(status.id, resolvedId),
      }))
    )

    return {
      id: projectRow.id,
      name: projectRow.name,
      columns,
      updatedAt: new Date(projectRow.updatedAt!),
    }
  }

  /**
   * Get tickets for a status (column).
   * Tickets are sorted by position (force-ranked) then created_at as tiebreaker.
   */
  private async getTicketsForStatus(statusId: string, projectId: string) {
    const ticketRows = this.ctx.drizzle
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
        column_id: sql<string | null>`NULL`,
        column_name: sql<string | null>`NULL`,
        project_name: sql<string | null>`NULL`,
      })
      .from(pmoTickets)
      .leftJoin(pmoWorkflowStatuses, eq(pmoTickets.statusId, pmoWorkflowStatuses.id))
      .where(and(
        eq(pmoTickets.statusId, statusId),
        eq(pmoTickets.projectId, projectId)
      ))
      .orderBy(asc(pmoTickets.position), asc(pmoTickets.createdAt))
      .all() as unknown as TicketRow[]

    return Promise.all(ticketRows.map((row) => rowToTicket(this.ctx.drizzle, row)))
  }

  /**
   * List project summaries.
   */
  async listProjectSummaries(): Promise<
    Array<{
      id: string
      name: string
      template: string | null
      description: string | null
      ticketCount: number
    }>
  > {
    const projects = this.ctx.drizzle
      .select({
        id: pmoProjects.id,
        name: pmoProjects.name,
        template: pmoProjects.template,
        description: pmoProjects.description,
        ticketCount: count(pmoTickets.id),
      })
      .from(pmoProjects)
      .leftJoin(pmoTickets, eq(pmoProjects.id, pmoTickets.projectId))
      .groupBy(pmoProjects.id)
      .orderBy(asc(pmoProjects.createdAt))
      .all()

    return projects.map((p) => ({
      id: p.id,
      name: p.name,
      template: p.template,
      description: p.description,
      ticketCount: p.ticketCount,
    }))
  }

  /**
   * Delete a project by ID, name, or slug.
   */
  async deleteProject(projectIdOrName: string): Promise<void> {
    // Resolve project identifier to actual ID
    const resolvedId = this.resolveProjectId(projectIdOrName)
    if (!resolvedId) {
      throw new PMOError('NOT_FOUND', `Project not found: ${projectIdOrName}`)
    }

    if (resolvedId === 'default') {
      throw new PMOError('INVALID', 'Cannot delete the default project')
    }

    try {
      this.ctx.drizzle
        .delete(pmoProjects)
        .where(eq(pmoProjects.id, resolvedId))
        .run()

      const { changes } = this.ctx.db.prepare('SELECT changes() as changes').get() as { changes: number }
      if (changes === 0) {
        throw new PMOError('NOT_FOUND', `Project not found: ${projectIdOrName}`)
      }
    } catch (err) {
      if (err instanceof PMOError) throw err
      wrapSqliteError('Project', 'delete', err)
    }

    // Tickets are deleted via CASCADE
  }

  /**
   * Get a project by ID, name, or slug.
   */
  async getProject(idOrName: string): Promise<Project | null> {
    // Resolve project identifier to actual ID
    const resolvedId = this.resolveProjectId(idOrName)
    if (!resolvedId) return null

    const row = this.ctx.drizzle
      .select()
      .from(pmoProjects)
      .where(eq(pmoProjects.id, resolvedId))
      .get()

    if (!row) return null

    return this.rowToProject(row)
  }

  /**
   * Update a project by ID, name, or slug.
   */
  async updateProject(idOrName: string, changes: Partial<Project>): Promise<Project> {
    const existing = await this.getProject(idOrName)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Project not found: ${idOrName}`)
    }

    // Use the resolved ID for the update
    const resolvedId = existing.id

    const updates: Partial<typeof pmoProjects.$inferInsert> = {
      updatedAt: String(Date.now()),
    }

    if (changes.name !== undefined) updates.name = changes.name
    if (changes.description !== undefined) updates.description = changes.description || null
    if (changes.status !== undefined) updates.status = changes.status
    if (changes.phaseId !== undefined) updates.phaseId = changes.phaseId || null
    if (changes.workflowId !== undefined) updates.workflowId = changes.workflowId || null
    if (changes.isArchived !== undefined) updates.isArchived = changes.isArchived
    if (changes.targetDate !== undefined) {
      updates.targetDate = changes.targetDate ? changes.targetDate.toISOString() : null
    }

    this.ctx.drizzle
      .update(pmoProjects)
      .set(updates)
      .where(eq(pmoProjects.id, resolvedId))
      .run()

    return (await this.getProject(resolvedId))!
  }

  /**
   * List projects with optional filter.
   */
  async listProjects(filter?: ProjectFilter): Promise<Project[]> {
    let query = this.ctx.drizzle
      .select()
      .from(pmoProjects)
      .$dynamic()

    const conditions = []

    // Filter by archived status if explicitly specified
    if (filter?.isArchived === true) {
      conditions.push(eq(pmoProjects.isArchived, true))
    } else if (filter?.isArchived === false) {
      conditions.push(eq(pmoProjects.isArchived, false))
    }

    if (filter?.phaseId) {
      conditions.push(eq(pmoProjects.phaseId, filter.phaseId))
    }

    if (filter?.search) {
      conditions.push(
        or(
          like(pmoProjects.name, `%${filter.search}%`),
          like(pmoProjects.description, `%${filter.search}%`)
        )
      )
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions))
    }

    const rows = query
      .orderBy(desc(pmoProjects.updatedAt))
      .all()

    return rows.map((row) => this.rowToProject(row))
  }

  /**
   * Archive a project by ID, name, or slug.
   */
  async archiveProject(idOrName: string): Promise<Project> {
    const existing = await this.getProject(idOrName)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Project not found: ${idOrName}`)
    }

    if (existing.isArchived) {
      return existing
    }

    return this.updateProject(existing.id, { isArchived: true })
  }

  /**
   * Unarchive a project by ID, name, or slug.
   */
  async unarchiveProject(idOrName: string): Promise<Project> {
    const existing = await this.getProject(idOrName)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Project not found: ${idOrName}`)
    }

    if (!existing.isArchived) {
      return existing
    }

    return this.updateProject(existing.id, { isArchived: false })
  }

  private rowToProject(row: {
    id: string
    name: string
    template: string | null
    description: string | null
    status: string
    phaseId: string | null
    workflowId: string | null
    isArchived: boolean | null
    targetDate: string | null
    initiativeId: string | null
    createdAt: string | null
    updatedAt: string | null
  }): Project {
    return {
      id: row.id,
      name: row.name,
      template: row.template || undefined,
      description: row.description || undefined,
      status: (row.status || 'active') as 'draft' | 'active' | 'completed' | 'archived',
      phaseId: row.phaseId || undefined,
      workflowId: row.workflowId || undefined,
      isArchived: row.isArchived ?? false,
      targetDate: row.targetDate ? new Date(row.targetDate) : undefined,
      initiativeId: row.initiativeId || undefined,
      createdAt: new Date(row.createdAt || Date.now()),
      updatedAt: new Date(row.updatedAt || Date.now()),
    }
  }
}

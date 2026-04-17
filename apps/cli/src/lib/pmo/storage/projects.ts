/**
 * Project operations.
 *
 * PRLT-1299: Board/column/ticket operations removed — the provider
 * (Linear, Jira, etc.) is the source of truth for tickets and workflows.
 * Only project CRUD remains.
 */

import { eq, and, like, or, asc, desc, sql } from 'drizzle-orm'
import {
  pmoProjects,
} from '../../database/drizzle-schema.js'
import {
  Board,
  BoardConfig,
  PMOError,
  Project,
  ProjectFilter,
} from '../types.js'
import { slugify } from '../../utils/text.js'
import { generateEntityId } from '../utils.js'
import { StorageContext } from './types.js'

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
   * PRLT-1299: Simplified — just creates/updates the project row.
   * Workflow statuses are managed by the provider.
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

    // Return an empty board — columns/tickets are now provider-managed
    return {
      id: projectId,
      name: projectName,
      columns: [],
      updatedAt: new Date(),
    }
  }

  /**
   * Create a new project.
   * PRLT-1299: No longer looks up workflows in local DB — just records the
   * workflow ID for provider resolution.
   */
  async createProject(
    project: { id?: string; name: string; template?: string; description?: string }
  ): Promise<Board> {
    const id = project.id || generateEntityId(this.ctx.db, 'project')
    const workflowId = project.template || 'default'
    const now = Date.now()

    // Insert project
    try {
      this.ctx.drizzle
        .insert(pmoProjects)
        .values({
          id,
          name: project.name,
          template: workflowId,
          description: project.description || null,
          workflowId,
          createdAt: String(now),
          updatedAt: String(now),
        })
        .onConflictDoUpdate({
          target: pmoProjects.id,
          set: {
            name: project.name,
            template: workflowId,
            description: project.description || null,
            workflowId,
            createdAt: String(now),
            updatedAt: String(now),
          },
        })
        .run()
    } catch (err) {
      if (err instanceof Error && err.message?.includes('UNIQUE constraint')) {
        throw new PMOError('CONFLICT', `Project already exists: ${id}`)
      }
      throw err
    }

    // Return an empty board — columns/tickets are now provider-managed
    return {
      id,
      name: project.name,
      columns: [],
      updatedAt: new Date(now),
    }
  }

  /**
   * List project summaries.
   * PRLT-1299: ticketCount always 0 — tickets are provider-managed.
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
      })
      .from(pmoProjects)
      .orderBy(asc(pmoProjects.createdAt))
      .all()

    return projects.map((p) => ({
      id: p.id,
      name: p.name,
      template: p.template,
      description: p.description,
      ticketCount: 0,
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
      const result = this.ctx.drizzle
        .delete(pmoProjects)
        .where(eq(pmoProjects.id, resolvedId))
        .run()

      if (result.changes === 0) {
        throw new PMOError('NOT_FOUND', `Project not found: ${projectIdOrName}`)
      }
    } catch (err) {
      if (err instanceof PMOError) throw err
      throw err
    }
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

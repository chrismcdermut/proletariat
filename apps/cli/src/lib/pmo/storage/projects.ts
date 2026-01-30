/**
 * Project operations.
 * Board columns are now derived from workflow statuses (single source of truth).
 */

import { PMO_TABLES } from '../schema.js'
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
import { StorageContext, ProjectRow, TicketRow } from './types.js'
import { rowToTicket } from './helpers.js'

const T = PMO_TABLES

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
    const exactMatch = this.ctx.db.prepare(`
      SELECT id FROM ${T.projects} WHERE id = ?
    `).get(identifier) as { id: string } | undefined
    if (exactMatch) return exactMatch.id

    // 2. Case-insensitive ID match
    const caseInsensitiveId = this.ctx.db.prepare(`
      SELECT id FROM ${T.projects} WHERE LOWER(id) = LOWER(?)
    `).get(identifier) as { id: string } | undefined
    if (caseInsensitiveId) return caseInsensitiveId.id

    // 3. Exact name match
    const nameMatch = this.ctx.db.prepare(`
      SELECT id FROM ${T.projects} WHERE name = ?
    `).get(identifier) as { id: string } | undefined
    if (nameMatch) return nameMatch.id

    // 4. Case-insensitive name match
    const caseInsensitiveName = this.ctx.db.prepare(`
      SELECT id FROM ${T.projects} WHERE LOWER(name) = LOWER(?)
    `).get(identifier) as { id: string } | undefined
    if (caseInsensitiveName) return caseInsensitiveName.id

    // 5. Slugified name match - check if identifier is a slug of any project name
    // Get all projects and compare slugified names
    const allProjects = this.ctx.db.prepare(`
      SELECT id, name FROM ${T.projects}
    `).all() as Array<{ id: string; name: string }>

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
    const now = Date.now()

    // Create or update project with default workflow
    this.ctx.db.prepare(`
      INSERT OR REPLACE INTO ${T.projects} (id, name, template, workflow_id, updated_at)
      VALUES (?, ?, ?, 'default', ?)
    `).run(projectId, projectName, 'kanban', now)

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
    const projectRow = this.ctx.db.prepare(`
      SELECT id, name, workflow_id, updated_at FROM ${T.projects} WHERE id = ?
    `).get(resolvedId) as { id: string; name: string; workflow_id: string | null; updated_at: string } | undefined

    if (!projectRow) {
      throw new PMOError('NOT_FOUND', `Project not found: ${projectIdOrName}. Run init() first.`)
    }

    // Get workflow statuses as columns
    const workflowId = projectRow.workflow_id || 'default'
    const statusRows = this.ctx.db.prepare(`
      SELECT * FROM ${T.workflow_statuses}
      WHERE workflow_id = ?
      ORDER BY position
    `).all(workflowId) as Array<{
      id: string
      workflow_id: string
      name: string
      category: string
      position: number
      color: string | null
    }>

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
      updatedAt: new Date(projectRow.updated_at),
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
    const workflow = this.ctx.db.prepare(`
      SELECT id FROM ${T.workflows} WHERE id = ?
    `).get(workflowId) as { id: string } | undefined

    // Use the requested workflow if it exists, otherwise fall back to default
    const finalWorkflowId = workflow ? workflowId : 'default'

    // Insert project with workflow
    this.ctx.db.prepare(`
      INSERT OR REPLACE INTO ${T.projects} (id, name, template, description, workflow_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, project.name, workflowId, project.description || null, finalWorkflowId, now, now)

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

    const projectRow = this.ctx.db.prepare(`
      SELECT id, name, template, description, workflow_id, updated_at FROM ${T.projects} WHERE id = ?
    `).get(resolvedId) as {
      id: string
      name: string
      template: string | null
      description: string | null
      workflow_id: string | null
      updated_at: string
    } | undefined

    if (!projectRow) {
      return null
    }

    // Get workflow statuses as columns
    const workflowId = projectRow.workflow_id || 'default'
    const statusRows = this.ctx.db.prepare(`
      SELECT * FROM ${T.workflow_statuses}
      WHERE workflow_id = ?
      ORDER BY position
    `).all(workflowId) as Array<{
      id: string
      name: string
      category: string
      position: number
    }>

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
      updatedAt: new Date(projectRow.updated_at),
    }
  }

  /**
   * Get tickets for a status (column).
   * Tickets are sorted by priority (P0 first) then created_at (oldest first).
   */
  private async getTicketsForStatus(statusId: string, projectId: string) {
    const ticketRows = this.ctx.db.prepare(`
      SELECT t.*,
             ws.name as status_name,
             ws.category as status_category
      FROM ${T.tickets} t
      LEFT JOIN ${T.workflow_statuses} ws ON t.status_id = ws.id
      WHERE t.status_id = ? AND t.project_id = ?
      ORDER BY
        CASE t.priority
          WHEN 'P0' THEN 0
          WHEN 'P1' THEN 1
          WHEN 'P2' THEN 2
          WHEN 'P3' THEN 3
          ELSE 4
        END,
        t.created_at ASC
    `).all(statusId, projectId) as TicketRow[]

    return Promise.all(ticketRows.map((row) => rowToTicket(this.ctx.db, row)))
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
    const projects = this.ctx.db.prepare(`
      SELECT p.*, COUNT(t.id) as ticket_count
      FROM ${T.projects} p
      LEFT JOIN ${T.tickets} t ON p.id = t.project_id
      GROUP BY p.id
      ORDER BY p.created_at
    `).all() as Array<{
      id: string
      name: string
      template: string | null
      description: string | null
      ticket_count: number
    }>

    return projects.map((p) => ({
      id: p.id,
      name: p.name,
      template: p.template,
      description: p.description,
      ticketCount: p.ticket_count,
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

    const result = this.ctx.db.prepare(`DELETE FROM ${T.projects} WHERE id = ?`).run(resolvedId)

    if (result.changes === 0) {
      throw new PMOError('NOT_FOUND', `Project not found: ${projectIdOrName}`)
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

    const row = this.ctx.db.prepare(`SELECT * FROM ${T.projects} WHERE id = ?`).get(
      resolvedId
    ) as ProjectRow | undefined

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

    const updates: string[] = ['updated_at = ?']
    const params: unknown[] = [Date.now()]

    if (changes.name !== undefined) {
      updates.push('name = ?')
      params.push(changes.name)
    }
    if (changes.description !== undefined) {
      updates.push('description = ?')
      params.push(changes.description || null)
    }
    if (changes.status !== undefined) {
      updates.push('status = ?')
      params.push(changes.status)
    }
    if (changes.phaseId !== undefined) {
      updates.push('phase_id = ?')
      params.push(changes.phaseId || null)
    }
    if (changes.workflowId !== undefined) {
      updates.push('workflow_id = ?')
      params.push(changes.workflowId || null)
    }
    if (changes.isArchived !== undefined) {
      updates.push('is_archived = ?')
      params.push(changes.isArchived ? 1 : 0)
    }
    if (changes.targetDate !== undefined) {
      updates.push('target_date = ?')
      params.push(changes.targetDate ? changes.targetDate.toISOString() : null)
    }

    params.push(resolvedId)
    this.ctx.db.prepare(`UPDATE ${T.projects} SET ${updates.join(', ')} WHERE id = ?`).run(
      ...params
    )

    return (await this.getProject(resolvedId))!
  }

  /**
   * List projects with optional filter.
   */
  async listProjects(filter?: ProjectFilter): Promise<Project[]> {
    let sql = `SELECT * FROM ${T.projects}`
    const conditions: string[] = []
    const params: unknown[] = []

    // Filter by archived status if explicitly specified
    if (filter?.isArchived === true) {
      conditions.push('is_archived = 1')
    } else if (filter?.isArchived === false) {
      conditions.push('is_archived = 0')
    }

    if (filter?.phaseId) {
      conditions.push('phase_id = ?')
      params.push(filter.phaseId)
    }

    if (filter?.search) {
      conditions.push('(name LIKE ? OR description LIKE ?)')
      const searchTerm = `%${filter.search}%`
      params.push(searchTerm, searchTerm)
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ')
    }

    sql += ' ORDER BY updated_at DESC'

    const rows = this.ctx.db.prepare(sql).all(...params) as ProjectRow[]

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

  private rowToProject(row: ProjectRow): Project {
    return {
      id: row.id,
      name: row.name,
      template: row.template || undefined,
      description: row.description || undefined,
      status: (row.status || 'active') as 'draft' | 'active' | 'completed' | 'archived',
      phaseId: row.phase_id || undefined,
      workflowId: row.workflow_id || undefined,
      isArchived: row.is_archived === 1,
      targetDate: row.target_date ? new Date(row.target_date) : undefined,
      initiativeId: row.initiative_id || undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }
  }
}

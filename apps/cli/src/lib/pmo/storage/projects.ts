/**
 * Project operations.
 */

import { PMO_TABLES } from '../schema.js'
import {
  Board,
  BoardConfig,
  Column,
  PMOError,
  Project,
  ProjectFilter,
  WorkflowStatus,
} from '../types.js'
import { slugify } from '../utils.js'
import { generateBoardMarkdown } from '../markdown.js'
import { StorageContext, ProjectRow, TicketRow } from './types.js'
import { rowToTicket } from './helpers.js'

const T = PMO_TABLES

export class ProjectStorage {
  constructor(private ctx: StorageContext) {}

  /**
   * Initialize a project with columns.
   */
  async init(config: BoardConfig): Promise<Board> {
    const projectId = this.ctx.getCurrentProjectId()
    const projectName = config.name || 'Project Board'
    const columns = config.columns || ['Backlog', 'Planned', 'In Progress', 'Done']
    const now = Date.now()

    // Create or update project
    this.ctx.db.prepare(`
      INSERT OR REPLACE INTO ${T.projects} (id, name, template, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(projectId, projectName, 'kanban', now)

    // Delete existing columns for this project
    this.ctx.db.prepare(`DELETE FROM ${T.columns} WHERE project_id = ?`).run(projectId)

    // Create columns
    const insertColumn = this.ctx.db.prepare(`
      INSERT INTO ${T.columns} (id, project_id, name, position, created_at)
      VALUES (?, ?, ?, ?, ?)
    `)

    columns.forEach((name, position) => {
      insertColumn.run(slugify(name), projectId, name, position, now)
    })

    return this.getBoard()
  }

  /**
   * Get the current project board.
   */
  async getBoard(): Promise<Board> {
    const projectId = this.ctx.getCurrentProjectId()

    // Get project metadata
    const projectRow = this.ctx.db.prepare(`SELECT * FROM ${T.projects} WHERE id = ?`).get(
      projectId
    ) as { id: string; name: string; updated_at: string } | undefined

    if (!projectRow) {
      throw new PMOError('NOT_FOUND', `Project not found: ${projectId}. Run init() first.`)
    }

    // Get columns with tickets for current project
    const columnRows = this.ctx.db.prepare(`
      SELECT * FROM ${T.columns}
      WHERE project_id = ?
      ORDER BY position
    `).all(projectId) as Array<{
      id: string
      project_id: string
      name: string
      position: number
    }>

    const columns: Column[] = await Promise.all(
      columnRows.map(async (col) => ({
        id: col.id,
        name: col.name,
        position: col.position,
        tickets: await this.getTicketsForColumn(col.id, projectId),
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
  async getBoardMarkdown(): Promise<string> {
    const board = await this.getBoard()
    return generateBoardMarkdown(board)
  }

  /**
   * Create a new project.
   */
  async createProject(
    project: { id?: string; name: string; template?: string; description?: string },
    applyTemplate: (projectId: string, templateId: string) => Promise<WorkflowStatus[]>,
    listStatuses: (projectId: string) => Promise<WorkflowStatus[]>,
    getTemplate: (id: string) => Promise<{ id: string } | null>
  ): Promise<Board> {
    const id = project.id || slugify(project.name)
    const templateId = project.template || 'kanban'
    const now = Date.now()

    this.ctx.db.prepare(`
      INSERT INTO ${T.projects} (id, name, template, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, project.name, templateId, project.description || null, now, now)

    // Try to apply workflow template if it exists
    const template = await getTemplate(templateId)
    if (template) {
      // Apply workflow template - creates statuses for this project
      await applyTemplate(id, templateId)

      // Create columns from statuses (columns mirror statuses)
      const statuses = await listStatuses(id)
      const insertColumn = this.ctx.db.prepare(`
        INSERT INTO ${T.columns} (id, project_id, name, position, created_at)
        VALUES (?, ?, ?, ?, ?)
      `)

      statuses.forEach((status, position) => {
        insertColumn.run(slugify(status.name), id, status.name, position, now)
      })
    } else {
      // Fallback to default columns if template doesn't exist
      const defaultColumns = ['Backlog', 'Planned', 'In Progress', 'Done']
      const insertColumn = this.ctx.db.prepare(`
        INSERT INTO ${T.columns} (id, project_id, name, position, created_at)
        VALUES (?, ?, ?, ?, ?)
      `)

      defaultColumns.forEach((name, position) => {
        insertColumn.run(slugify(name), id, name, position, now)
      })
    }

    // Get the board for the new project
    return this.getProjectBoard(id) as Promise<Board>
  }

  /**
   * Get project board by ID.
   */
  async getProjectBoard(projectId: string): Promise<Board | null> {
    const projectRow = this.ctx.db.prepare(`SELECT * FROM ${T.projects} WHERE id = ?`).get(
      projectId
    ) as
      | {
          id: string
          name: string
          template: string | null
          description: string | null
          updated_at: string
        }
      | undefined

    if (!projectRow) {
      return null
    }

    // Get columns with tickets for this project
    const columnRows = this.ctx.db.prepare(`
      SELECT * FROM ${T.columns}
      WHERE project_id = ?
      ORDER BY position
    `).all(projectId) as Array<{
      id: string
      project_id: string
      name: string
      position: number
    }>

    const columns: Column[] = await Promise.all(
      columnRows.map(async (col) => ({
        id: col.id,
        name: col.name,
        position: col.position,
        tickets: await this.getTicketsForColumn(col.id, projectId),
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
   * Get tickets for a column.
   */
  private async getTicketsForColumn(columnId: string, projectId: string) {
    const ticketRows = this.ctx.db.prepare(`
      SELECT t.*, bt.position as board_position, c.name as column_name,
             s.name as status_name, s.category as status_category
      FROM ${T.tickets} t
      JOIN ${T.board_tickets} bt ON t.id = bt.ticket_id AND t.project_id = bt.project_id
      JOIN ${T.columns} c ON bt.column_id = c.id AND bt.project_id = c.project_id
      LEFT JOIN ${T.statuses} s ON t.status_id = s.id
      WHERE bt.column_id = ? AND bt.project_id = ?
      ORDER BY bt.position
    `).all(columnId, projectId) as TicketRow[]

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
   * Delete a project.
   */
  async deleteProject(projectId: string): Promise<void> {
    if (projectId === 'default') {
      throw new PMOError('INVALID', 'Cannot delete the default project')
    }

    const result = this.ctx.db.prepare(`DELETE FROM ${T.projects} WHERE id = ?`).run(projectId)

    if (result.changes === 0) {
      throw new PMOError('NOT_FOUND', `Project not found: ${projectId}`)
    }

    // Columns and tickets are deleted via CASCADE
  }

  /**
   * Get a project by ID.
   */
  async getProject(id: string): Promise<Project | null> {
    const row = this.ctx.db.prepare(`SELECT * FROM ${T.projects} WHERE id = ?`).get(
      id
    ) as ProjectRow | undefined

    if (!row) return null

    return this.rowToProject(row)
  }

  /**
   * Update a project.
   */
  async updateProject(id: string, changes: Partial<Project>): Promise<Project> {
    const existing = await this.getProject(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Project not found: ${id}`)
    }

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
    if (changes.isArchived !== undefined) {
      updates.push('is_archived = ?')
      params.push(changes.isArchived ? 1 : 0)
    }
    if (changes.targetDate !== undefined) {
      updates.push('target_date = ?')
      params.push(changes.targetDate ? changes.targetDate.toISOString() : null)
    }

    params.push(id)
    this.ctx.db.prepare(`UPDATE ${T.projects} SET ${updates.join(', ')} WHERE id = ?`).run(
      ...params
    )

    return (await this.getProject(id))!
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
   * Archive a project.
   */
  async archiveProject(id: string): Promise<Project> {
    const existing = await this.getProject(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Project not found: ${id}`)
    }

    if (existing.isArchived) {
      return existing
    }

    return this.updateProject(id, { isArchived: true })
  }

  /**
   * Unarchive a project.
   */
  async unarchiveProject(id: string): Promise<Project> {
    const existing = await this.getProject(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Project not found: ${id}`)
    }

    if (!existing.isArchived) {
      return existing
    }

    return this.updateProject(id, { isArchived: false })
  }

  private rowToProject(row: ProjectRow): Project {
    return {
      id: row.id,
      name: row.name,
      template: row.template || undefined,
      description: row.description || undefined,
      status: (row.status || 'active') as 'draft' | 'active' | 'completed' | 'archived',
      phaseId: row.phase_id || undefined,
      isArchived: row.is_archived === 1,
      targetDate: row.target_date ? new Date(row.target_date) : undefined,
      initiativeId: row.initiative_id || undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }
  }
}

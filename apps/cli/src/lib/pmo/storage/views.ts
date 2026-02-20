/**
 * Board view operations.
 *
 * This module uses Drizzle ORM for type-safe database queries.
 */

import { eq, and, like, or, asc, desc, sql } from 'drizzle-orm'
import {
  pmoBoardViews,
  pmoProjects,
  pmoTickets,
  pmoWorkflowStatuses,
  pmoSubtasks,
  pmoTicketMetadata,
} from '../../database/drizzle-schema.js'
import {
  Board,
  BoardView,
  BoardViewFilter,
  BoardViewFilters,
  BoardViewGroupBy,
  BoardViewSortBy,
  Column,
  PMOError,
  StateCategory,
  Subtask,
  Ticket,
} from '../types.js'
import { PMO_TABLES } from '../schema.js'
import { slugify } from '../utils.js'
import { StorageContext, BoardViewRow } from './types.js'

const T = PMO_TABLES
import { getAcceptanceCriteriaSync } from './helpers.js'

export class ViewStorage {
  constructor(private ctx: StorageContext) {}

  /**
   * Resolve a project identifier to its actual ID.
   * Tries multiple strategies:
   * 1. Exact ID match
   * 2. Case-insensitive ID match
   * 3. Exact name match
   * 4. Case-insensitive name match
   * 5. Slugified name match
   */
  private resolveProjectId(identifier: string): string | null {
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

    // 5. Slugified name match
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
   * List board views.
   */
  async listBoardViews(filter?: BoardViewFilter): Promise<BoardView[]> {
    let query = this.ctx.drizzle
      .select()
      .from(pmoBoardViews)
      .$dynamic()

    const conditions = []

    if (filter?.projectId) {
      conditions.push(eq(pmoBoardViews.projectId, filter.projectId))
    }

    if (filter?.isDefault !== undefined) {
      conditions.push(eq(pmoBoardViews.isDefault, filter.isDefault))
    }

    if (filter?.search) {
      conditions.push(
        or(
          like(pmoBoardViews.name, `%${filter.search}%`),
          like(pmoBoardViews.description, `%${filter.search}%`)
        )
      )
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions))
    }

    const rows = query
      .orderBy(desc(pmoBoardViews.isDefault), asc(pmoBoardViews.name))
      .all()

    return rows.map((row) => this.rowToBoardView(row))
  }

  /**
   * Get a board view by ID.
   */
  async getBoardView(id: string): Promise<BoardView | null> {
    const row = this.ctx.drizzle
      .select()
      .from(pmoBoardViews)
      .where(eq(pmoBoardViews.id, id))
      .get()

    if (!row) return null
    return this.rowToBoardView(row)
  }

  /**
   * Create a new board view.
   */
  async createBoardView(view: Partial<BoardView>): Promise<BoardView> {
    if (!view.projectId) {
      throw new PMOError('INVALID', 'Project ID is required')
    }
    if (!view.name) {
      throw new PMOError('INVALID', 'View name is required')
    }

    const id = view.id || slugify(view.name) + '-' + Date.now().toString(36)
    const now = Date.now()
    const filters = JSON.stringify(view.filters || {})

    // If this is set as default, unset other defaults for this project
    if (view.isDefault) {
      this.ctx.drizzle
        .update(pmoBoardViews)
        .set({ isDefault: false })
        .where(eq(pmoBoardViews.projectId, view.projectId))
        .run()
    }

    this.ctx.drizzle.insert(pmoBoardViews).values({
      id,
      projectId: view.projectId,
      name: view.name,
      description: view.description || null,
      isDefault: view.isDefault || false,
      filters,
      groupBy: view.groupBy || null,
      sortBy: view.sortBy || null,
      createdAt: String(now),
      updatedAt: String(now),
    }).run()

    return (await this.getBoardView(id))!
  }

  /**
   * Update a board view.
   */
  async updateBoardView(id: string, changes: Partial<BoardView>): Promise<BoardView> {
    const existing = await this.getBoardView(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Board view not found: ${id}`)
    }

    const updates: Partial<typeof pmoBoardViews.$inferInsert> = {
      updatedAt: String(Date.now()),
    }

    if (changes.name !== undefined) updates.name = changes.name
    if (changes.description !== undefined) updates.description = changes.description || null
    if (changes.isDefault !== undefined) {
      // If setting as default, unset other defaults for this project
      if (changes.isDefault) {
        this.ctx.drizzle
          .update(pmoBoardViews)
          .set({ isDefault: false })
          .where(eq(pmoBoardViews.projectId, existing.projectId))
          .run()
      }
      updates.isDefault = changes.isDefault
    }
    if (changes.filters !== undefined) updates.filters = JSON.stringify(changes.filters)
    if (changes.groupBy !== undefined) updates.groupBy = changes.groupBy || null
    if (changes.sortBy !== undefined) updates.sortBy = changes.sortBy || null

    this.ctx.drizzle
      .update(pmoBoardViews)
      .set(updates)
      .where(eq(pmoBoardViews.id, id))
      .run()

    return (await this.getBoardView(id))!
  }

  /**
   * Delete a board view.
   */
  async deleteBoardView(id: string): Promise<void> {
    const result = this.ctx.drizzle
      .delete(pmoBoardViews)
      .where(eq(pmoBoardViews.id, id))
      .run()

    if (result.changes === 0) {
      throw new PMOError('NOT_FOUND', `Board view not found: ${id}`)
    }
  }

  /**
   * Get the default board view for a project.
   */
  async getDefaultBoardView(projectId: string): Promise<BoardView | null> {
    const row = this.ctx.drizzle
      .select()
      .from(pmoBoardViews)
      .where(and(
        eq(pmoBoardViews.projectId, projectId),
        eq(pmoBoardViews.isDefault, true)
      ))
      .get()

    if (!row) return null
    return this.rowToBoardView(row)
  }

  /**
   * Get board with optional filters applied.
   * @param projectIdOrName - Project ID, name, or slug. Will be resolved to actual ID.
   */
  async getBoardWithView(projectIdOrName: string, viewId?: string, filters?: BoardViewFilters): Promise<Board> {
    // Resolve project identifier to actual ID
    const resolvedId = this.resolveProjectId(projectIdOrName)
    if (!resolvedId) {
      throw new PMOError('NOT_FOUND', `Project not found: ${projectIdOrName}. Run init() first.`)
    }

    let viewFilters: BoardViewFilters = {}
    let viewSortBy: BoardViewSortBy | undefined

    // Load view if specified
    if (viewId) {
      const view = await this.getBoardView(viewId)
      if (view) {
        viewFilters = view.filters
        viewSortBy = view.sortBy
      }
    }

    // Override with explicit filters if provided
    const effectiveFilters = { ...viewFilters, ...filters }

    // Get project metadata using resolved ID
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

    const workflowId = projectRow.workflowId || 'default'

    // Get workflow statuses as columns
    const columnRows = this.ctx.drizzle
      .select({
        id: pmoWorkflowStatuses.id,
        workflowId: pmoWorkflowStatuses.workflowId,
        name: pmoWorkflowStatuses.name,
        position: pmoWorkflowStatuses.position,
      })
      .from(pmoWorkflowStatuses)
      .where(eq(pmoWorkflowStatuses.workflowId, workflowId))
      .orderBy(asc(pmoWorkflowStatuses.position))
      .all()

    // Filter columns if columnIds filter is set
    const filteredColumnRows = effectiveFilters.columnIds?.length
      ? columnRows.filter((col) => effectiveFilters.columnIds!.includes(col.id))
      : columnRows

    // Get tickets with filters applied
    const columns: Column[] = await Promise.all(
      filteredColumnRows.map(async (col) => {
        const tickets = await this.getTicketsForColumnWithFilters(
          col.id,
          resolvedId,
          effectiveFilters
        )

        // Apply sorting if specified
        const sortedTickets = viewSortBy ? this.sortTickets(tickets, viewSortBy) : tickets

        return {
          id: col.id,
          name: col.name,
          position: col.position,
          tickets: sortedTickets,
        }
      })
    )

    return {
      id: projectRow.id,
      name: projectRow.name,
      columns,
      updatedAt: new Date(projectRow.updatedAt!),
    }
  }

  /**
   * Get tickets for a column (workflow status) with filters applied.
   */
  private async getTicketsForColumnWithFilters(
    columnId: string,
    projectId: string,
    filters: BoardViewFilters
  ): Promise<Ticket[]> {
    // NOTE: We use raw SQL here because this query requires complex dynamic
    // WHERE clauses that are more naturally expressed with string building.
    let sqlQuery = `
      SELECT t.*,
             ws.position as board_position,
             ws.name as column_name,
             ws.name as status_name,
             ws.category as status_category
      FROM ${T.tickets} t
      LEFT JOIN ${T.workflow_statuses} ws ON t.status_id = ws.id
      WHERE t.status_id = ? AND t.project_id = ?
    `
    const params: unknown[] = [columnId, projectId]

    // Apply filters
    if (filters.assignee !== undefined) {
      if (filters.assignee === 'unassigned') {
        sqlQuery += ' AND (t.assignee IS NULL OR t.assignee = "")'
      } else {
        sqlQuery += ' AND t.assignee = ?'
        params.push(filters.assignee)
      }
    }

    if (filters.owner !== undefined) {
      sqlQuery += ' AND t.owner = ?'
      params.push(filters.owner)
    }

    if (filters.priority !== undefined) {
      sqlQuery += ' AND UPPER(t.priority) = UPPER(?)'
      params.push(filters.priority)
    }

    if (filters.statusCategory !== undefined) {
      sqlQuery += ' AND ws.category = ?'
      params.push(filters.statusCategory)
    }

    if (filters.statusId !== undefined) {
      sqlQuery += ' AND t.status_id = ?'
      params.push(filters.statusId)
    }

    if (filters.epicId !== undefined) {
      sqlQuery += ' AND t.epic_id = ?'
      params.push(filters.epicId)
    }

    if (filters.search !== undefined) {
      sqlQuery += ' AND (t.title LIKE ? OR t.description LIKE ?)'
      const searchTerm = `%${filters.search}%`
      params.push(searchTerm, searchTerm)
    }

    // Order by ticket position, then created_at as tiebreaker
    sqlQuery += ` ORDER BY t.position ASC, t.created_at ASC`

    const rows = this.ctx.db.prepare(sqlQuery).all(...params) as Array<{
      id: string
      project_id: string
      title: string
      description: string | null
      priority: string | null
      category: string | null
      status: string
      status_id: string | null
      owner: string | null
      assignee: string | null
      branch: string | null
      spec_id: string | null
      epic_id: string | null
      labels: string | null
      created_at: string
      updated_at: string
      last_synced_from_spec: string | null
      last_synced_from_board: string | null
      board_position: number
      column_name: string
      status_name: string | null
      status_category: string | null
    }>

    return Promise.all(rows.map((row) => this.rowToTicketWithColumn(row)))
  }

  private async rowToTicketWithColumn(row: {
    id: string
    title: string
    description: string | null
    priority: string | null
    category: string | null
    status: string
    status_id: string | null
    owner: string | null
    assignee: string | null
    branch: string | null
    spec_id: string | null
    epic_id: string | null
    labels: string | null
    created_at: string
    updated_at: string
    last_synced_from_spec: string | null
    last_synced_from_board: string | null
    board_position: number
    column_name: string
    status_name: string | null
    status_category: string | null
  }): Promise<Ticket> {
    // Get subtasks
    const subtaskRows = this.ctx.drizzle
      .select()
      .from(pmoSubtasks)
      .where(eq(pmoSubtasks.ticketId, row.id))
      .orderBy(asc(pmoSubtasks.position))
      .all()

    const subtasks: Subtask[] = subtaskRows.map((s) => ({
      id: s.id,
      title: s.title,
      done: s.done ?? false,
    }))

    // Get metadata
    const metadataRows = this.ctx.drizzle
      .select({ key: pmoTicketMetadata.key, value: pmoTicketMetadata.value })
      .from(pmoTicketMetadata)
      .where(eq(pmoTicketMetadata.ticketId, row.id))
      .all()

    const metadata: Record<string, string> = {}
    for (const m of metadataRows) {
      metadata[m.key] = m.value || ''
    }

    // Parse labels from JSON
    let labels: string[] = []
    try {
      labels = row.labels ? JSON.parse(row.labels) : []
    } catch {
      labels = []
    }

    return {
      id: row.id,
      title: row.title,
      description: row.description || undefined,
      priority: row.priority || undefined,
      category: row.category || undefined,
      statusId: row.status_id || '',
      statusName: row.status_name || undefined,
      statusCategory: row.status_category as StateCategory | undefined,
      status: row.status,
      owner: row.owner || undefined,
      assignee: row.assignee || undefined,
      branch: row.branch || undefined,
      specId: row.spec_id || undefined,
      epicId: row.epic_id || undefined,
      subtasks,
      labels,
      metadata,
      acceptanceCriteria: getAcceptanceCriteriaSync(this.ctx.db, row.id),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      lastSyncedFromSpec: row.last_synced_from_spec
        ? new Date(row.last_synced_from_spec)
        : undefined,
      lastSyncedFromBoard: row.last_synced_from_board
        ? new Date(row.last_synced_from_board)
        : undefined,
    }
  }

  private sortTickets(tickets: Ticket[], sortBy: BoardViewSortBy): Ticket[] {
    const sorted = [...tickets]

    switch (sortBy) {
      case 'priority': {
        const priorityOrder: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 }
        sorted.sort((a, b) => {
          const aOrder = priorityOrder[(a.priority || 'MEDIUM').toUpperCase()] ?? 3
          const bOrder = priorityOrder[(b.priority || 'MEDIUM').toUpperCase()] ?? 3
          return aOrder - bOrder
        })
        break
      }
      case 'created':
        sorted.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        break
      case 'updated':
        sorted.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        break
      case 'title':
        sorted.sort((a, b) => a.title.localeCompare(b.title))
        break
      case 'assignee':
        sorted.sort((a, b) => (a.assignee || '').localeCompare(b.assignee || ''))
        break
    }

    return sorted
  }

  private rowToBoardView(row: {
    id: string
    projectId: string
    name: string
    description: string | null
    isDefault: boolean | null
    filters: string
    groupBy: string | null
    sortBy: string | null
    createdAt: string | null
    updatedAt: string | null
  }): BoardView {
    return {
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      description: row.description || undefined,
      isDefault: row.isDefault ?? false,
      filters: row.filters ? JSON.parse(row.filters) : {},
      groupBy: row.groupBy as BoardViewGroupBy | undefined,
      sortBy: row.sortBy as BoardViewSortBy | undefined,
      createdAt: new Date(row.createdAt || Date.now()),
      updatedAt: new Date(row.updatedAt || Date.now()),
    }
  }
}

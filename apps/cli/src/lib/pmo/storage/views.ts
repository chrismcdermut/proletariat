/**
 * Board view operations.
 */

import { PMO_TABLES } from '../schema.js'
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
import { slugify } from '../utils.js'
import { StorageContext, BoardViewRow } from './types.js'
import { getAcceptanceCriteriaSync } from './helpers.js'

const T = PMO_TABLES

export class ViewStorage {
  constructor(private ctx: StorageContext) {}

  /**
   * List board views.
   */
  async listBoardViews(filter?: BoardViewFilter): Promise<BoardView[]> {
    let sql = `SELECT * FROM ${T.board_views}`
    const conditions: string[] = []
    const params: unknown[] = []

    if (filter?.projectId) {
      conditions.push('project_id = ?')
      params.push(filter.projectId)
    }

    if (filter?.isDefault !== undefined) {
      conditions.push('is_default = ?')
      params.push(filter.isDefault ? 1 : 0)
    }

    if (filter?.search) {
      conditions.push('(name LIKE ? OR description LIKE ?)')
      const searchTerm = `%${filter.search}%`
      params.push(searchTerm, searchTerm)
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ')
    }

    sql += ' ORDER BY is_default DESC, name ASC'

    const rows = this.ctx.db.prepare(sql).all(...params) as BoardViewRow[]

    return rows.map((row) => this.rowToBoardView(row))
  }

  /**
   * Get a board view by ID.
   */
  async getBoardView(id: string): Promise<BoardView | null> {
    const row = this.ctx.db.prepare(`SELECT * FROM ${T.board_views} WHERE id = ?`).get(
      id
    ) as BoardViewRow | undefined

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
      this.ctx.db.prepare(`
        UPDATE ${T.board_views} SET is_default = 0 WHERE project_id = ?
      `).run(view.projectId)
    }

    this.ctx.db.prepare(`
      INSERT INTO ${T.board_views} (id, project_id, name, description, is_default, filters, group_by, sort_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      view.projectId,
      view.name,
      view.description || null,
      view.isDefault ? 1 : 0,
      filters,
      view.groupBy || null,
      view.sortBy || null,
      now,
      now
    )

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
    if (changes.isDefault !== undefined) {
      // If setting as default, unset other defaults for this project
      if (changes.isDefault) {
        this.ctx.db.prepare(`
          UPDATE ${T.board_views} SET is_default = 0 WHERE project_id = ?
        `).run(existing.projectId)
      }
      updates.push('is_default = ?')
      params.push(changes.isDefault ? 1 : 0)
    }
    if (changes.filters !== undefined) {
      updates.push('filters = ?')
      params.push(JSON.stringify(changes.filters))
    }
    if (changes.groupBy !== undefined) {
      updates.push('group_by = ?')
      params.push(changes.groupBy || null)
    }
    if (changes.sortBy !== undefined) {
      updates.push('sort_by = ?')
      params.push(changes.sortBy || null)
    }

    params.push(id)
    this.ctx.db.prepare(`UPDATE ${T.board_views} SET ${updates.join(', ')} WHERE id = ?`).run(
      ...params
    )

    return (await this.getBoardView(id))!
  }

  /**
   * Delete a board view.
   */
  async deleteBoardView(id: string): Promise<void> {
    const result = this.ctx.db.prepare(`DELETE FROM ${T.board_views} WHERE id = ?`).run(id)
    if (result.changes === 0) {
      throw new PMOError('NOT_FOUND', `Board view not found: ${id}`)
    }
  }

  /**
   * Get the default board view for a project.
   */
  async getDefaultBoardView(projectId: string): Promise<BoardView | null> {
    const row = this.ctx.db.prepare(`
      SELECT * FROM ${T.board_views} WHERE project_id = ? AND is_default = 1
    `).get(projectId) as BoardViewRow | undefined

    if (!row) return null
    return this.rowToBoardView(row)
  }

  /**
   * Get board with optional filters applied.
   */
  async getBoardWithView(viewId?: string, filters?: BoardViewFilters): Promise<Board> {
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

    const projectId = this.ctx.getCurrentProjectId()

    // Get project metadata
    const projectRow = this.ctx.db.prepare(`SELECT * FROM ${T.projects} WHERE id = ?`).get(
      projectId
    ) as { id: string; name: string; updated_at: string } | undefined

    if (!projectRow) {
      throw new PMOError('NOT_FOUND', `Project not found: ${projectId}. Run init() first.`)
    }

    // Get columns for current project
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

    // Filter columns if columnIds filter is set
    const filteredColumnRows = effectiveFilters.columnIds?.length
      ? columnRows.filter((col) => effectiveFilters.columnIds!.includes(col.id))
      : columnRows

    // Get tickets with filters applied
    const columns: Column[] = await Promise.all(
      filteredColumnRows.map(async (col) => {
        const tickets = await this.getTicketsForColumnWithFilters(
          col.id,
          projectId,
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
      updatedAt: new Date(projectRow.updated_at),
    }
  }

  /**
   * Get tickets for a column with filters applied.
   */
  private async getTicketsForColumnWithFilters(
    columnId: string,
    projectId: string,
    filters: BoardViewFilters
  ): Promise<Ticket[]> {
    let sql = `
      SELECT t.*, bt.position as board_position, c.name as column_name,
             s.name as status_name, s.category as status_category
      FROM ${T.tickets} t
      JOIN ${T.board_tickets} bt ON t.id = bt.ticket_id AND t.project_id = bt.project_id
      JOIN ${T.columns} c ON bt.column_id = c.id AND bt.project_id = c.project_id
      LEFT JOIN ${T.statuses} s ON t.status_id = s.id
      WHERE bt.column_id = ? AND bt.project_id = ?
    `
    const params: unknown[] = [columnId, projectId]

    // Apply filters
    if (filters.assignee !== undefined) {
      if (filters.assignee === 'unassigned') {
        sql += ' AND (t.assignee IS NULL OR t.assignee = "")'
      } else {
        sql += ' AND t.assignee = ?'
        params.push(filters.assignee)
      }
    }

    if (filters.owner !== undefined) {
      sql += ' AND t.owner = ?'
      params.push(filters.owner)
    }

    if (filters.priority !== undefined) {
      sql += ' AND UPPER(t.priority) = UPPER(?)'
      params.push(filters.priority)
    }

    if (filters.statusCategory !== undefined) {
      sql += ' AND s.category = ?'
      params.push(filters.statusCategory)
    }

    if (filters.statusId !== undefined) {
      sql += ' AND t.status_id = ?'
      params.push(filters.statusId)
    }

    if (filters.epicId !== undefined) {
      sql += ' AND t.epic_id = ?'
      params.push(filters.epicId)
    }

    if (filters.search !== undefined) {
      sql += ' AND (t.title LIKE ? OR t.description LIKE ?)'
      const searchTerm = `%${filters.search}%`
      params.push(searchTerm, searchTerm)
    }

    sql += ' ORDER BY bt.position'

    const rows = this.ctx.db.prepare(sql).all(...params) as Array<{
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
    const subtaskRows = this.ctx.db.prepare(`
      SELECT * FROM ${T.subtasks} WHERE ticket_id = ? ORDER BY position
    `).all(row.id) as Array<{ id: string; title: string; done: number }>

    const subtasks: Subtask[] = subtaskRows.map((s) => ({
      id: s.id,
      title: s.title,
      done: s.done === 1,
    }))

    // Get metadata
    const metadataRows = this.ctx.db.prepare(`
      SELECT key, value FROM ${T.ticket_metadata} WHERE ticket_id = ?
    `).all(row.id) as Array<{ key: string; value: string }>

    const metadata: Record<string, string> = {}
    for (const m of metadataRows) {
      metadata[m.key] = m.value
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

  private rowToBoardView(row: BoardViewRow): BoardView {
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      description: row.description || undefined,
      isDefault: row.is_default === 1,
      filters: row.filters ? JSON.parse(row.filters) : {},
      groupBy: row.group_by as BoardViewGroupBy | undefined,
      sortBy: row.sort_by as BoardViewSortBy | undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }
  }
}

/**
 * SQLite Storage Implementation for PMO
 *
 * Uses the unified workspace.db database with pmo_ prefixed tables.
 * This enables foreign key relationships between PMO tickets and agents.
 */

import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'
import {
  Board,
  BoardConfig,
  Column,
  Conflict,
  Epic,
  EpicFilter,
  PMOError,
  PMOStorage,
  Spec,
  SpecFilter,
  Subtask,
  SyncResult,
  SyncStatus,
  Ticket,
  TicketFilter,
} from './types.js'
import { generateBoardMarkdown } from './markdown.js'
import { slugify, generateEntityId } from './utils.js'
import { PMO_TABLES, PMO_SCHEMA_SQL, validateTicketSchema } from './schema.js'

// Use shared table names
const T = PMO_TABLES

// =============================================================================
// SQLite Storage Class
// =============================================================================

export class SQLiteStorage implements PMOStorage {
  readonly type = 'sqlite' as const
  private db: Database.Database
  private dbPath: string
  private currentProjectId: string

  constructor(dbPath: string, projectId: string = 'default') {
    this.dbPath = dbPath
    this.currentProjectId = projectId

    // Open database (creates if doesn't exist)
    this.db = new Database(dbPath)
    this.db.pragma('foreign_keys = ON')

    // Ensure PMO tables exist
    this.ensurePMOTables()
  }

  /**
   * Set the current project context for operations
   */
  setCurrentProject(projectId: string): void {
    this.currentProjectId = projectId
  }

  /**
   * Get the current project ID
   */
  getCurrentProjectId(): string {
    return this.currentProjectId
  }

  /**
   * Get the underlying database connection.
   * Use this when you need direct database access for custom queries.
   */
  getDatabase(): Database.Database {
    return this.db
  }

  /**
   * Ensure PMO tables exist in the database.
   * Uses shared schema from schema.ts to guarantee consistency.
   * This handles migration for workspaces created before PMO was added.
   */
  private ensurePMOTables(): void {
    // Run migrations FIRST for existing databases
    // This adds missing columns before we try to create indexes on them
    this.runMigrations()

    // Create tables and indexes using shared schema (single source of truth)
    // CREATE TABLE/INDEX IF NOT EXISTS is safe - won't fail if already exists
    this.db.exec(PMO_SCHEMA_SQL)

    // Validate schema matches expected columns (catches drift early)
    validateTicketSchema(this.db)
  }

  /**
   * Run schema migrations for existing databases.
   * Each migration checks if the column exists before adding it.
   */
  private runMigrations(): void {
    // Migration: Update specs table to new simplified schema
    const specsColumns = this.db.pragma(`table_info(${T.specs})`) as Array<{ name: string }>
    const specsColumnNames = specsColumns.map(c => c.name)

    // New columns for simplified spec schema
    const newColumns = [
      { name: 'type', sql: 'type TEXT' },
      { name: 'tags', sql: 'tags TEXT' },
      { name: 'depends_on', sql: 'depends_on TEXT' },
      { name: 'problem', sql: 'problem TEXT' },
      { name: 'solution', sql: 'solution TEXT' },
      { name: 'decisions', sql: 'decisions TEXT' },
      { name: 'not_now', sql: 'not_now TEXT' },
      { name: 'ui_ux', sql: 'ui_ux TEXT' },
      { name: 'acceptance_criteria', sql: 'acceptance_criteria TEXT' },
      { name: 'open_questions', sql: 'open_questions TEXT' },
      { name: 'requirements_functional', sql: 'requirements_functional TEXT' },
      { name: 'requirements_technical', sql: 'requirements_technical TEXT' },
      { name: 'context', sql: 'context TEXT' },
    ]

    for (const col of newColumns) {
      if (!specsColumnNames.includes(col.name)) {
        try {
          this.db.exec(`ALTER TABLE ${T.specs} ADD COLUMN ${col.sql}`)
        } catch {
          // Column may already exist
        }
      }
    }
  }


  // ===========================================================================
  // Project Operations
  // ===========================================================================

  async createProject(project: { id?: string; name: string; template?: string; description?: string }): Promise<Board> {
    const id = project.id || slugify(project.name)
    const now = Date.now()

    this.db.prepare(`
      INSERT INTO ${T.projects} (id, name, template, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, project.name, project.template || 'kanban', project.description || null, now, now)

    // Create default columns for the project
    const defaultColumns = ['Backlog', 'In Progress', 'Review', 'Done']
    const insertColumn = this.db.prepare(`
      INSERT INTO ${T.columns} (id, project_id, name, position, created_at)
      VALUES (?, ?, ?, ?, ?)
    `)

    defaultColumns.forEach((name, position) => {
      insertColumn.run(slugify(name), id, name, position, now)
    })

    // Switch context to new project and return it
    const oldProjectId = this.currentProjectId
    this.currentProjectId = id
    const result = await this.getBoard()
    this.currentProjectId = oldProjectId
    return result
  }

  async getProject(projectId: string): Promise<Board | null> {
    const projectRow = this.db.prepare(`SELECT * FROM ${T.projects} WHERE id = ?`).get(projectId) as
      | { id: string; name: string; template: string | null; description: string | null; updated_at: string }
      | undefined

    if (!projectRow) {
      return null
    }

    // Get columns with tickets for this project
    const columnRows = this.db.prepare(`
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

  async listProjects(): Promise<Array<{ id: string; name: string; template: string | null; description: string | null; ticketCount: number }>> {
    const projects = this.db.prepare(`
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

    return projects.map(p => ({
      id: p.id,
      name: p.name,
      template: p.template,
      description: p.description,
      ticketCount: p.ticket_count,
    }))
  }

  async deleteProject(projectId: string): Promise<void> {
    if (projectId === 'default') {
      throw new PMOError('INVALID', 'Cannot delete the default project')
    }

    const result = this.db.prepare(`DELETE FROM ${T.projects} WHERE id = ?`).run(projectId)

    if (result.changes === 0) {
      throw new PMOError('NOT_FOUND', `Project not found: ${projectId}`)
    }

    // Columns and tickets are deleted via CASCADE
  }

  // ===========================================================================
  // Board Operations (operates on current project)
  // ===========================================================================

  async init(config: BoardConfig): Promise<Board> {
    const projectId = this.currentProjectId
    const projectName = config.name || 'Project Board'
    const columns = config.columns || ['Backlog', 'In Progress', 'Review', 'Done']
    const now = Date.now()

    // Create or update project
    this.db.prepare(`
      INSERT OR REPLACE INTO ${T.projects} (id, name, template, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(projectId, projectName, 'kanban', now)

    // Delete existing columns for this project
    this.db.prepare(`DELETE FROM ${T.columns} WHERE project_id = ?`).run(projectId)

    // Create columns
    const insertColumn = this.db.prepare(`
      INSERT INTO ${T.columns} (id, project_id, name, position, created_at)
      VALUES (?, ?, ?, ?, ?)
    `)

    columns.forEach((name, position) => {
      insertColumn.run(slugify(name), projectId, name, position, now)
    })

    return this.getBoard()
  }

  async getBoard(): Promise<Board> {
    // Get project metadata
    const projectRow = this.db.prepare(`SELECT * FROM ${T.projects} WHERE id = ?`).get(this.currentProjectId) as
      | { id: string; name: string; updated_at: string }
      | undefined

    if (!projectRow) {
      throw new PMOError('NOT_FOUND', `Project not found: ${this.currentProjectId}. Run init() first.`)
    }

    // Get columns with tickets for current project
    const columnRows = this.db.prepare(`
      SELECT * FROM ${T.columns}
      WHERE project_id = ?
      ORDER BY position
    `).all(this.currentProjectId) as Array<{
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
        tickets: await this.getTicketsForColumn(col.id, this.currentProjectId),
      }))
    )

    return {
      id: projectRow.id,
      name: projectRow.name,
      columns,
      updatedAt: new Date(projectRow.updated_at),
    }
  }

  async getBoardMarkdown(): Promise<string> {
    const board = await this.getBoard()
    return generateBoardMarkdown(board)
  }

  // ===========================================================================
  // Column Operations
  // ===========================================================================

  /**
   * Get column names for current project
   * Returns array of column names in order
   */
  getColumnNames(): string[] {
    const columnRows = this.db.prepare(`
      SELECT name FROM ${T.columns}
      WHERE project_id = ?
      ORDER BY position
    `).all(this.currentProjectId) as Array<{ name: string }>;

    return columnRows.map(row => row.name);
  }

  async createColumn(name: string, position?: number): Promise<Column> {
    const id = slugify(name)
    const projectId = this.currentProjectId
    const pos = position ?? this.getMaxColumnPosition() + 1

    // Shift existing columns if inserting at specific position
    if (position !== undefined) {
      this.db.prepare(`
        UPDATE ${T.columns}
        SET position = position + 1
        WHERE project_id = ? AND position >= ?
      `).run(projectId, pos)
    }

    this.db.prepare(`
      INSERT INTO ${T.columns} (id, project_id, name, position, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, projectId, name, pos, Date.now())

    this.updateBoardTimestamp()

    return {
      id,
      name,
      position: pos,
      tickets: [],
    }
  }

  async renameColumn(id: string, name: string): Promise<Column> {
    const projectId = this.currentProjectId
    const result = this.db.prepare(`
      UPDATE ${T.columns}
      SET name = ?
      WHERE project_id = ? AND id = ?
    `).run(name, projectId, id)

    if (result.changes === 0) {
      throw new PMOError('NOT_FOUND', `Column not found: ${id}`)
    }

    this.updateBoardTimestamp()

    const row = this.db.prepare(`
      SELECT * FROM ${T.columns}
      WHERE project_id = ? AND id = ?
    `).get(projectId, id) as {
      id: string
      project_id: string
      name: string
      position: number
    }

    return {
      id: row.id,
      name: row.name,
      position: row.position,
      tickets: await this.getTicketsForColumn(id, projectId),
    }
  }

  async moveColumn(id: string, position: number): Promise<Column> {
    const projectId = this.currentProjectId
    const current = this.db.prepare(`
      SELECT position FROM ${T.columns}
      WHERE project_id = ? AND id = ?
    `).get(projectId, id) as { position: number } | undefined

    if (!current) {
      throw new PMOError('NOT_FOUND', `Column not found: ${id}`)
    }

    // Shift columns between old and new position
    if (position < current.position) {
      this.db.prepare(`
        UPDATE ${T.columns}
        SET position = position + 1
        WHERE project_id = ? AND position >= ? AND position < ?
      `).run(projectId, position, current.position)
    } else {
      this.db.prepare(`
        UPDATE ${T.columns}
        SET position = position - 1
        WHERE project_id = ? AND position > ? AND position <= ?
      `).run(projectId, current.position, position)
    }

    this.db.prepare(`
      UPDATE ${T.columns}
      SET position = ?
      WHERE project_id = ? AND id = ?
    `).run(position, projectId, id)

    this.updateBoardTimestamp()

    const row = this.db.prepare(`
      SELECT * FROM ${T.columns}
      WHERE project_id = ? AND id = ?
    `).get(projectId, id) as {
      id: string
      project_id: string
      name: string
      position: number
    }

    return {
      id: row.id,
      name: row.name,
      position: row.position,
      tickets: await this.getTicketsForColumn(id, projectId),
    }
  }

  async deleteColumn(id: string, cascade = false): Promise<void> {
    const projectId = this.currentProjectId
    const ticketCount = this.db.prepare(`
      SELECT COUNT(*) as count FROM ${T.board_tickets}
      WHERE project_id = ? AND column_id = ?
    `).get(projectId, id) as { count: number }

    if (ticketCount.count > 0 && !cascade) {
      throw new PMOError('INVALID', `Column has ${ticketCount.count} tickets. Use cascade=true to delete.`)
    }

    const result = this.db.prepare(`
      DELETE FROM ${T.columns}
      WHERE project_id = ? AND id = ?
    `).run(projectId, id)

    if (result.changes === 0) {
      throw new PMOError('NOT_FOUND', `Column not found: ${id}`)
    }

    this.updateBoardTimestamp()
  }

  // ===========================================================================
  // Ticket Operations
  // ===========================================================================

  async createTicket(ticket: Partial<Ticket>): Promise<Ticket> {
    const id = ticket.id || generateEntityId(this.db, 'ticket')
    const title = ticket.title || 'Untitled'
    const projectId = this.currentProjectId

    // Get column (default to first column) - this is for board position
    let columnId = ticket.column
    if (!columnId) {
      const firstColumn = this.db.prepare(`
        SELECT id FROM ${T.columns}
        WHERE project_id = ?
        ORDER BY position LIMIT 1
      `).get(projectId) as { id: string } | undefined
      if (!firstColumn) {
        throw new PMOError('NOT_FOUND', 'No columns exist. Initialize board first.')
      }
      columnId = firstColumn.id
    }

    // Verify column exists in current project
    const column = this.db.prepare(`
      SELECT id FROM ${T.columns}
      WHERE project_id = ? AND (id = ? OR name = ?)
    `).get(projectId, columnId, columnId) as { id: string } | undefined
    if (!column) {
      throw new PMOError('NOT_FOUND', `Column not found: ${columnId}`)
    }
    columnId = column.id

    // Get position for board
    const position = ticket.position ?? this.getMaxTicketPosition(columnId) + 1

    const now = Date.now()

    // Get spec_id (changed from specs array to single specId)
    const specId = ticket.specId || (ticket.specs && ticket.specs.length > 0 ? ticket.specs[0] : null)

    // Insert into tickets table (pure ticket data)
    this.db.prepare(`
      INSERT INTO ${T.tickets} (
        id, project_id, title, description, priority, category,
        status, owner, assignee, spec_id, epic_id,
        created_at, updated_at, last_synced_from_spec, last_synced_from_board
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, projectId, title,
      ticket.description || null,
      ticket.priority || null,
      ticket.category || null,
      ticket.status || 'backlog',
      ticket.owner || null,
      ticket.assignee || null,
      specId,
      ticket.epicId || null,
      now, now,
      ticket.lastSyncedFromSpec || null,
      ticket.lastSyncedFromBoard || null
    )

    // Insert into board_tickets table (board position)
    this.db.prepare(`
      INSERT INTO ${T.board_tickets} (project_id, ticket_id, column_id, position)
      VALUES (?, ?, ?, ?)
    `).run(projectId, id, columnId, position)

    // Insert subtasks
    if (ticket.subtasks && ticket.subtasks.length > 0) {
      const insertSubtask = this.db.prepare(`
        INSERT INTO ${T.subtasks} (id, ticket_id, title, done, position)
        VALUES (?, ?, ?, ?, ?)
      `)
      ticket.subtasks.forEach((st, idx) => {
        insertSubtask.run(st.id || slugify(st.title), id, st.title, st.done ? 1 : 0, idx)
      })
    }

    // Insert metadata
    if (ticket.metadata) {
      const insertMeta = this.db.prepare(`
        INSERT INTO ${T.ticket_metadata} (ticket_id, key, value)
        VALUES (?, ?, ?)
      `)
      for (const [key, value] of Object.entries(ticket.metadata)) {
        insertMeta.run(id, key, value)
      }
    }

    this.updateBoardTimestamp()

    return this.getTicketById(id) as Promise<Ticket>
  }

  async getTicket(id: string): Promise<Ticket | null> {
    return this.getTicketById(id)
  }

  async updateTicket(id: string, changes: Partial<Ticket>): Promise<Ticket> {
    const existing = await this.getTicketById(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Ticket not found: ${id}`, id)
    }

    const updates: string[] = []
    const params: unknown[] = []

    if (changes.title !== undefined) {
      updates.push('title = ?')
      params.push(changes.title)
    }
    if (changes.description !== undefined) {
      updates.push('description = ?')
      params.push(changes.description)
    }
    if (changes.priority !== undefined) {
      updates.push('priority = ?')
      params.push(changes.priority)
    }
    if (changes.category !== undefined) {
      updates.push('category = ?')
      params.push(changes.category)
    }
    if (changes.status !== undefined) {
      updates.push('status = ?')
      params.push(changes.status)
    }
    if (changes.owner !== undefined) {
      updates.push('owner = ?')
      params.push(changes.owner)
    }
    if (changes.assignee !== undefined) {
      updates.push('assignee = ?')
      params.push(changes.assignee)
    }
    if (changes.specId !== undefined) {
      updates.push('spec_id = ?')
      params.push(changes.specId)
    }
    if (changes.lastSyncedFromSpec !== undefined) {
      updates.push('last_synced_from_spec = ?')
      params.push(changes.lastSyncedFromSpec)
    }
    if (changes.lastSyncedFromBoard !== undefined) {
      updates.push('last_synced_from_board = ?')
      params.push(changes.lastSyncedFromBoard)
    }

    if (updates.length > 0) {
      updates.push('updated_at = ?')
      params.push(Date.now())
      params.push(id)

      this.db.prepare(`UPDATE ${T.tickets} SET ${updates.join(', ')} WHERE id = ?`).run(...params)
    }

    // Update subtasks if provided
    if (changes.subtasks !== undefined) {
      this.db.prepare(`DELETE FROM ${T.subtasks} WHERE ticket_id = ?`).run(id)
      const insertSubtask = this.db.prepare(`
        INSERT INTO ${T.subtasks} (id, ticket_id, title, done, position)
        VALUES (?, ?, ?, ?, ?)
      `)
      changes.subtasks.forEach((st, idx) => {
        insertSubtask.run(st.id || slugify(st.title), id, st.title, st.done ? 1 : 0, idx)
      })
    }

    // Update metadata if provided
    if (changes.metadata !== undefined) {
      this.db.prepare(`DELETE FROM ${T.ticket_metadata} WHERE ticket_id = ?`).run(id)
      const insertMeta = this.db.prepare(`
        INSERT INTO ${T.ticket_metadata} (ticket_id, key, value)
        VALUES (?, ?, ?)
      `)
      for (const [key, value] of Object.entries(changes.metadata)) {
        insertMeta.run(id, key, value)
      }
    }

    this.updateBoardTimestamp()

    return this.getTicketById(id) as Promise<Ticket>
  }

  async moveTicket(id: string, column: string, position?: number): Promise<Ticket> {
    const projectId = this.currentProjectId
    const existing = await this.getTicketById(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Ticket not found: ${id}`, id)
    }

    // Verify target column exists in current project
    const targetColumn = this.db.prepare(`
      SELECT id FROM ${T.columns}
      WHERE project_id = ? AND (id = ? OR name = ?)
    `).get(projectId, column, column) as { id: string } | undefined
    if (!targetColumn) {
      throw new PMOError('NOT_FOUND', `Column not found: ${column}`)
    }

    const targetColumnId = targetColumn.id
    const pos = position ?? this.getMaxTicketPosition(targetColumnId) + 1

    // Get current board position
    const currentBoardPos = this.db.prepare(`
      SELECT column_id, position FROM ${T.board_tickets}
      WHERE project_id = ? AND ticket_id = ?
    `).get(projectId, id) as { column_id: string; position: number } | undefined

    if (!currentBoardPos) {
      throw new PMOError('NOT_FOUND', `Board position not found for ticket: ${id}`)
    }

    // If moving within same column, adjust positions
    if (currentBoardPos.column_id === targetColumnId) {
      if (pos < currentBoardPos.position) {
        this.db.prepare(`
          UPDATE ${T.board_tickets}
          SET position = position + 1
          WHERE project_id = ? AND column_id = ? AND position >= ? AND position < ?
        `).run(projectId, targetColumnId, pos, currentBoardPos.position)
      } else if (pos > currentBoardPos.position) {
        this.db.prepare(`
          UPDATE ${T.board_tickets}
          SET position = position - 1
          WHERE project_id = ? AND column_id = ? AND position > ? AND position <= ?
        `).run(projectId, targetColumnId, currentBoardPos.position, pos)
      }
    } else {
      // Moving to different column
      // Shift positions in old column
      this.db.prepare(`
        UPDATE ${T.board_tickets}
        SET position = position - 1
        WHERE project_id = ? AND column_id = ? AND position > ?
      `).run(projectId, currentBoardPos.column_id, currentBoardPos.position)
      // Shift positions in new column
      this.db.prepare(`
        UPDATE ${T.board_tickets}
        SET position = position + 1
        WHERE project_id = ? AND column_id = ? AND position >= ?
      `).run(projectId, targetColumnId, pos)
    }

    // Update board position
    this.db.prepare(`
      UPDATE ${T.board_tickets}
      SET column_id = ?, position = ?
      WHERE project_id = ? AND ticket_id = ?
    `).run(targetColumnId, pos, projectId, id)

    // Update ticket timestamp
    this.db.prepare(`
      UPDATE ${T.tickets}
      SET updated_at = ?
      WHERE id = ?
    `).run(Date.now(), id)

    this.updateBoardTimestamp()

    return this.getTicketById(id) as Promise<Ticket>
  }

  async deleteTicket(id: string): Promise<void> {
    const projectId = this.currentProjectId
    const existing = await this.getTicketById(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Ticket not found: ${id}`, id)
    }

    // Get board position before deleting
    const boardPos = this.db.prepare(`
      SELECT column_id, position FROM ${T.board_tickets}
      WHERE project_id = ? AND ticket_id = ?
    `).get(projectId, id) as { column_id: string; position: number } | undefined

    // Delete ticket (CASCADE will delete board_tickets entry)
    const result = this.db.prepare(`
      DELETE FROM ${T.tickets}
      WHERE project_id = ? AND id = ?
    `).run(projectId, id)

    if (result.changes === 0) {
      throw new PMOError('NOT_FOUND', `Ticket not found: ${id}`, id)
    }

    // Shift positions of remaining tickets in the same column
    if (boardPos) {
      this.db.prepare(`
        UPDATE ${T.board_tickets}
        SET position = position - 1
        WHERE project_id = ? AND column_id = ? AND position > ?
      `).run(projectId, boardPos.column_id, boardPos.position)
    }

    this.updateBoardTimestamp()
  }

  async listTickets(filter?: TicketFilter): Promise<Ticket[]> {
    const projectId = this.currentProjectId
    let query = `
      SELECT t.*, bt.column_id, bt.position, c.name as column_name
      FROM ${T.tickets} t
      LEFT JOIN ${T.board_tickets} bt ON t.id = bt.ticket_id AND t.project_id = bt.project_id
      LEFT JOIN ${T.columns} c ON bt.project_id = c.project_id AND bt.column_id = c.id
      WHERE t.project_id = ?
    `
    const params: unknown[] = [projectId]

    if (filter?.status) {
      query += ' AND t.status = ?'
      params.push(filter.status)
    }
    if (filter?.priority) {
      query += ' AND t.priority = ?'
      params.push(filter.priority)
    }
    if (filter?.category) {
      query += ' AND t.category = ?'
      params.push(filter.category)
    }
    if (filter?.owner) {
      query += ' AND t.owner = ?'
      params.push(filter.owner)
    }
    if (filter?.assignee) {
      query += ' AND t.assignee = ?'
      params.push(filter.assignee)
    }
    if (filter?.search) {
      query += ' AND (t.title LIKE ? OR t.description LIKE ?)'
      params.push(`%${filter.search}%`, `%${filter.search}%`)
    }
    if (filter?.spec) {
      query += ' AND t.spec_id = ?'
      params.push(filter.spec)
    }
    if (filter?.epic) {
      query += ' AND t.epic_id = ?'
      params.push(filter.epic)
    }
    if (filter?.column) {
      query += ' AND c.name = ?'
      params.push(filter.column)
    }

    query += ' ORDER BY c.position, bt.position'

    const rows = this.db.prepare(query).all(...params) as Array<{
      id: string
      project_id: string
      title: string
      description: string | null
      priority: string | null
      category: string | null
      status: string
      owner: string | null
      assignee: string | null
      spec_id: string | null
      epic_id: string | null
      column_id: string | null
      column_name: string | null
      position: number | null
      created_at: string
      updated_at: string
      last_synced_from_spec: string | null
      last_synced_from_board: string | null
    }>

    return Promise.all(rows.map((row) => this.rowToTicket(row)))
  }

  // ===========================================================================
  // Subtask Operations
  // ===========================================================================

  async addSubtask(ticketId: string, title: string): Promise<Subtask> {
    const ticket = await this.getTicketById(ticketId)
    if (!ticket) {
      throw new PMOError('NOT_FOUND', `Ticket not found: ${ticketId}`, ticketId)
    }

    const id = slugify(title)
    const position = ticket.subtasks.length

    this.db
      .prepare(
        `
      INSERT INTO ${T.subtasks} (id, ticket_id, title, done, position)
      VALUES (?, ?, ?, 0, ?)
    `
      )
      .run(id, ticketId, title, position)

    this.db.prepare(`UPDATE ${T.tickets} SET updated_at = ? WHERE id = ?`).run(Date.now(), ticketId)

    this.updateBoardTimestamp()

    return { id, title, done: false }
  }

  async toggleSubtask(ticketId: string, subtaskId: string): Promise<Subtask> {
    const subtask = this.db
      .prepare(`SELECT * FROM ${T.subtasks} WHERE ticket_id = ? AND id = ?`)
      .get(ticketId, subtaskId) as { id: string; title: string; done: number } | undefined

    if (!subtask) {
      throw new PMOError('NOT_FOUND', `Subtask not found: ${subtaskId}`)
    }

    const newDone = subtask.done ? 0 : 1
    this.db.prepare(`UPDATE ${T.subtasks} SET done = ? WHERE ticket_id = ? AND id = ?`).run(newDone, ticketId, subtaskId)

    this.db.prepare(`UPDATE ${T.tickets} SET updated_at = ? WHERE id = ?`).run(Date.now(), ticketId)

    this.updateBoardTimestamp()

    return {
      id: subtask.id,
      title: subtask.title,
      done: newDone === 1,
    }
  }

  async removeSubtask(ticketId: string, subtaskId: string): Promise<void> {
    const result = this.db
      .prepare(`DELETE FROM ${T.subtasks} WHERE ticket_id = ? AND id = ?`)
      .run(ticketId, subtaskId)

    if (result.changes === 0) {
      throw new PMOError('NOT_FOUND', `Subtask not found: ${subtaskId}`)
    }

    this.db.prepare(`UPDATE ${T.tickets} SET updated_at = ? WHERE id = ?`).run(Date.now(), ticketId)

    this.updateBoardTimestamp()
  }

  // ===========================================================================
  // Spec Operations
  // ===========================================================================

  async createSpec(spec: Partial<Spec>): Promise<Spec> {
    const id = spec.id || slugify(spec.title || 'untitled')
    const now = Date.now()

    this.db
      .prepare(
        `
      INSERT INTO ${T.specs} (
        id, title, status, type, tags, depends_on,
        problem, solution, decisions, not_now, ui_ux,
        acceptance_criteria, open_questions,
        requirements_functional, requirements_technical,
        context, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
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

  async getSpec(id: string): Promise<Spec | null> {
    const row = this.db.prepare(`
      SELECT id, title, status, type, tags, depends_on,
             problem, solution, decisions, not_now, ui_ux,
             acceptance_criteria, open_questions,
             requirements_functional, requirements_technical,
             context, created_at, updated_at
      FROM ${T.specs} WHERE id = ?
    `).get(id) as
      | {
          id: string
          title: string
          status: string
          type: string | null
          tags: string | null
          depends_on: string | null
          problem: string | null
          solution: string | null
          decisions: string | null
          not_now: string | null
          ui_ux: string | null
          acceptance_criteria: string | null
          open_questions: string | null
          requirements_functional: string | null
          requirements_technical: string | null
          context: string | null
          created_at: string
          updated_at: string
        }
      | undefined

    if (!row) return null

    return {
      id: row.id,
      title: row.title,
      status: row.status as 'draft' | 'active' | 'implemented',
      type: row.type as 'product' | 'platform' | 'infra' | 'integration' | undefined,
      tags: row.tags ? JSON.parse(row.tags) : undefined,
      dependsOn: row.depends_on ? JSON.parse(row.depends_on) : undefined,
      problem: row.problem || undefined,
      solution: row.solution || undefined,
      decisions: row.decisions || undefined,
      notNow: row.not_now || undefined,
      uiUx: row.ui_ux || undefined,
      acceptanceCriteria: row.acceptance_criteria || undefined,
      openQuestions: row.open_questions || undefined,
      requirementsFunctional: row.requirements_functional || undefined,
      requirementsTechnical: row.requirements_technical || undefined,
      context: row.context || undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }
  }

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
      params.push(`%${filter.search}%`, `%${filter.search}%`, `%${filter.search}%`, `%${filter.search}%`)
    }

    query += ' ORDER BY title'

    const rows = this.db.prepare(query).all(...params) as Array<{
      id: string
      title: string
      status: string
      type: string | null
      tags: string | null
      depends_on: string | null
      problem: string | null
      solution: string | null
      decisions: string | null
      not_now: string | null
      ui_ux: string | null
      acceptance_criteria: string | null
      open_questions: string | null
      requirements_functional: string | null
      requirements_technical: string | null
      context: string | null
      created_at: string
      updated_at: string
    }>

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status as 'draft' | 'active' | 'implemented',
      type: row.type as 'product' | 'platform' | 'infra' | 'integration' | undefined,
      tags: row.tags ? JSON.parse(row.tags) : undefined,
      dependsOn: row.depends_on ? JSON.parse(row.depends_on) : undefined,
      problem: row.problem || undefined,
      solution: row.solution || undefined,
      decisions: row.decisions || undefined,
      notNow: row.not_now || undefined,
      uiUx: row.ui_ux || undefined,
      acceptanceCriteria: row.acceptance_criteria || undefined,
      openQuestions: row.open_questions || undefined,
      requirementsFunctional: row.requirements_functional || undefined,
      requirementsTechnical: row.requirements_technical || undefined,
      context: row.context || undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }))
  }

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

      this.db.prepare(`UPDATE ${T.specs} SET ${updates.join(', ')} WHERE id = ?`).run(...params)
    }

    return this.getSpec(id) as Promise<Spec>
  }

  async deleteSpec(id: string): Promise<void> {
    const existing = await this.getSpec(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Spec not found: ${id}`)
    }

    // Delete spec (cascade will handle spec_dependencies)
    this.db.prepare(`DELETE FROM ${T.specs} WHERE id = ?`).run(id)

    // Clear spec_id from any tickets that reference this spec
    this.db.prepare(`UPDATE ${T.tickets} SET spec_id = NULL WHERE spec_id = ?`).run(id)
  }

  async linkTicketToSpec(ticketId: string, specId: string): Promise<void> {
    // Verify both exist
    const ticket = await this.getTicketById(ticketId)
    if (!ticket) {
      throw new PMOError('NOT_FOUND', `Ticket not found: ${ticketId}`, ticketId)
    }

    const spec = await this.getSpec(specId)
    if (!spec) {
      throw new PMOError('NOT_FOUND', `Spec not found: ${specId}`)
    }

    // Update spec_id on ticket (one-to-many relationship)
    this.db.prepare(`
      UPDATE ${T.tickets}
      SET spec_id = ?, updated_at = ?
      WHERE id = ?
    `).run(specId, Date.now(), ticketId)

    this.updateBoardTimestamp()
  }

  async unlinkTicketFromSpec(ticketId: string, specId: string): Promise<void> {
    // Clear spec_id if it matches
    this.db.prepare(`
      UPDATE ${T.tickets}
      SET spec_id = NULL, updated_at = ?
      WHERE id = ? AND spec_id = ?
    `).run(Date.now(), ticketId, specId)

    this.updateBoardTimestamp()
  }

  async getTicketsForSpec(specId: string): Promise<Ticket[]> {
    return this.listTickets({ spec: specId })
  }

  async getSpecsForTicket(ticketId: string): Promise<Spec[]> {
    // Get the ticket to find its spec_id
    const ticket = await this.getTicketById(ticketId)
    if (!ticket || !ticket.specId) {
      return []
    }

    const spec = await this.getSpec(ticket.specId)
    return spec ? [spec] : []
  }

  async addSpecDependency(specId: string, dependsOnId: string): Promise<void> {
    // Verify both specs exist
    const spec = await this.getSpec(specId)
    if (!spec) {
      throw new PMOError('NOT_FOUND', `Spec not found: ${specId}`)
    }

    const dependsOnSpec = await this.getSpec(dependsOnId)
    if (!dependsOnSpec) {
      throw new PMOError('NOT_FOUND', `Spec not found: ${dependsOnId}`)
    }

    // Insert dependency (ignore if already exists)
    this.db.prepare(`
      INSERT OR IGNORE INTO ${T.spec_dependencies} (spec_id, depends_on, created_at)
      VALUES (?, ?, ?)
    `).run(specId, dependsOnId, Date.now())
  }

  async removeSpecDependency(specId: string, dependsOnId: string): Promise<void> {
    this.db.prepare(`
      DELETE FROM ${T.spec_dependencies}
      WHERE spec_id = ? AND depends_on = ?
    `).run(specId, dependsOnId)
  }

  async getSpecDependencies(specId: string): Promise<Spec[]> {
    const rows = this.db.prepare(`
      SELECT depends_on FROM ${T.spec_dependencies} WHERE spec_id = ?
    `).all(specId) as Array<{ depends_on: string }>

    const specs: Spec[] = []
    for (const row of rows) {
      const spec = await this.getSpec(row.depends_on)
      if (spec) specs.push(spec)
    }
    return specs
  }

  async getSpecDependents(specId: string): Promise<Spec[]> {
    const rows = this.db.prepare(`
      SELECT spec_id FROM ${T.spec_dependencies} WHERE depends_on = ?
    `).all(specId) as Array<{ spec_id: string }>

    const specs: Spec[] = []
    for (const row of rows) {
      const spec = await this.getSpec(row.spec_id)
      if (spec) specs.push(spec)
    }
    return specs
  }

  // ===========================================================================
  // Epic Operations
  // ===========================================================================

  async createEpic(epic: Partial<Epic>): Promise<Epic> {
    const id = epic.id || generateEntityId(this.db, 'epic')
    const title = epic.title || 'Untitled Epic'
    const projectId = this.currentProjectId
    const status = epic.status || 'active'
    const now = Date.now()

    // Get next position if not provided (add to end)
    let position = epic.position
    if (position === undefined) {
      const maxPos = this.db.prepare(`
        SELECT COALESCE(MAX(position), -1) as max_pos FROM ${T.epics} WHERE project_id = ?
      `).get(projectId) as { max_pos: number }
      position = maxPos.max_pos + 1
    }

    this.db.prepare(`
      INSERT INTO ${T.epics} (id, project_id, title, description, status, position, file_path, spec_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, projectId, title, epic.description || null, status, position, epic.filePath || null, epic.specId || null, now, now)

    this.updateBoardTimestamp()

    return {
      id,
      projectId,
      title,
      description: epic.description,
      status,
      position,
      filePath: epic.filePath,
      specId: epic.specId,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    }
  }

  async getEpic(id: string): Promise<Epic | null> {
    const row = this.db.prepare(`
      SELECT * FROM ${T.epics} WHERE id = ?
    `).get(id) as {
      id: string
      project_id: string
      title: string
      description: string | null
      status: string
      position: number
      file_path: string | null
      spec_id: string | null
      created_at: string
      updated_at: string
    } | undefined

    if (!row) return null

    return {
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      description: row.description || undefined,
      status: row.status as Epic['status'],
      position: row.position,
      filePath: row.file_path || undefined,
      specId: row.spec_id || undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }
  }

  async listEpics(filter?: EpicFilter): Promise<Epic[]> {
    const projectId = this.currentProjectId
    let query = `SELECT * FROM ${T.epics} WHERE project_id = ?`
    const params: unknown[] = [projectId]

    if (filter?.status) {
      query += ' AND status = ?'
      params.push(filter.status)
    }
    if (filter?.search) {
      query += ' AND (title LIKE ? OR description LIKE ?)'
      params.push(`%${filter.search}%`, `%${filter.search}%`)
    }

    // Sort by position (priority order), then by created_at as tiebreaker
    query += ' ORDER BY position ASC, created_at ASC'

    const rows = this.db.prepare(query).all(...params) as Array<{
      id: string
      project_id: string
      title: string
      description: string | null
      status: string
      position: number
      file_path: string | null
      spec_id: string | null
      created_at: string
      updated_at: string
    }>

    return rows.map(row => ({
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      description: row.description || undefined,
      status: row.status as Epic['status'],
      position: row.position,
      filePath: row.file_path || undefined,
      specId: row.spec_id || undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }))
  }

  /**
   * Reorder an epic to a new position.
   * Updates positions of other epics to maintain order.
   */
  async reorderEpic(epicId: string, newPosition: number): Promise<Epic> {
    const epic = await this.getEpic(epicId)
    if (!epic) {
      throw new Error(`Epic not found: ${epicId}`)
    }

    const oldPosition = epic.position
    if (oldPosition === newPosition) {
      return epic
    }

    const projectId = this.currentProjectId

    // Shift other epics to make room
    if (newPosition < oldPosition) {
      // Moving up: shift epics in [newPosition, oldPosition) down by 1
      this.db.prepare(`
        UPDATE ${T.epics}
        SET position = position + 1, updated_at = ?
        WHERE project_id = ? AND position >= ? AND position < ?
      `).run(Date.now(), projectId, newPosition, oldPosition)
    } else {
      // Moving down: shift epics in (oldPosition, newPosition] up by 1
      this.db.prepare(`
        UPDATE ${T.epics}
        SET position = position - 1, updated_at = ?
        WHERE project_id = ? AND position > ? AND position <= ?
      `).run(Date.now(), projectId, oldPosition, newPosition)
    }

    // Update the epic's position
    this.db.prepare(`
      UPDATE ${T.epics}
      SET position = ?, updated_at = ?
      WHERE id = ?
    `).run(newPosition, Date.now(), epicId)

    this.updateBoardTimestamp()

    return (await this.getEpic(epicId))!
  }

  async updateEpic(id: string, changes: Partial<Epic>): Promise<Epic> {
    const epic = await this.getEpic(id)
    if (!epic) {
      throw new PMOError('NOT_FOUND', `Epic not found: ${id}`)
    }

    const updates: string[] = []
    const params: unknown[] = []

    if (changes.title !== undefined) {
      updates.push('title = ?')
      params.push(changes.title)
    }
    if (changes.description !== undefined) {
      updates.push('description = ?')
      params.push(changes.description)
    }
    if (changes.status !== undefined) {
      updates.push('status = ?')
      params.push(changes.status)
    }
    if (changes.filePath !== undefined) {
      updates.push('file_path = ?')
      params.push(changes.filePath)
    }
    if (changes.specId !== undefined) {
      updates.push('spec_id = ?')
      params.push(changes.specId || null)
    }

    if (updates.length > 0) {
      updates.push('updated_at = ?')
      params.push(Date.now())
      params.push(id)

      this.db.prepare(`UPDATE ${T.epics} SET ${updates.join(', ')} WHERE id = ?`).run(...params)
    }

    this.updateBoardTimestamp()
    return this.getEpic(id) as Promise<Epic>
  }

  async deleteEpic(id: string): Promise<void> {
    const epic = await this.getEpic(id)
    if (!epic) {
      throw new PMOError('NOT_FOUND', `Epic not found: ${id}`)
    }

    // Unlink all tickets from this epic first
    this.db.prepare(`
      UPDATE ${T.tickets} SET epic_id = NULL WHERE epic_id = ?
    `).run(id)

    this.db.prepare(`DELETE FROM ${T.epics} WHERE id = ?`).run(id)
    this.updateBoardTimestamp()
  }

  async getTicketsForEpic(epicId: string): Promise<Ticket[]> {
    return this.listTickets({ epic: epicId })
  }

  async linkTicketToEpic(ticketId: string, epicId: string): Promise<void> {
    // Verify both exist
    const ticket = await this.getTicketById(ticketId)
    if (!ticket) {
      throw new PMOError('NOT_FOUND', `Ticket not found: ${ticketId}`, ticketId)
    }

    const epic = await this.getEpic(epicId)
    if (!epic) {
      throw new PMOError('NOT_FOUND', `Epic not found: ${epicId}`)
    }

    this.db.prepare(`
      UPDATE ${T.tickets}
      SET epic_id = ?, updated_at = ?
      WHERE id = ?
    `).run(epicId, Date.now(), ticketId)

    this.updateBoardTimestamp()
  }

  async unlinkTicketFromEpic(ticketId: string): Promise<void> {
    this.db.prepare(`
      UPDATE ${T.tickets}
      SET epic_id = NULL, updated_at = ?
      WHERE id = ?
    `).run(Date.now(), ticketId)

    this.updateBoardTimestamp()
  }

  // ===========================================================================
  // Sync Operations (no-op for pure SQLite)
  // ===========================================================================

  async pull(): Promise<SyncResult> {
    // SQLite is local-only, no remote to pull from
    return { success: true, changes: 0 }
  }

  async push(): Promise<SyncResult> {
    // SQLite is local-only, no remote to push to
    return { success: true, changes: 0 }
  }

  async status(): Promise<SyncStatus> {
    // SQLite is local-only, always in sync
    return { ahead: 0, behind: 0, conflicts: false }
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  async close(): Promise<void> {
    this.db.close()
  }

  // ===========================================================================
  // Cache Operations (for git storage)
  // ===========================================================================

  getCacheMetadata(): { boardMtime: number; cacheBuiltAt: number; contentHash?: string } | null {
    const mtime = this.db.prepare(`SELECT value FROM ${T.cache_metadata} WHERE key = 'boardMtime'`).get() as
      | { value: string }
      | undefined
    const builtAt = this.db.prepare(`SELECT value FROM ${T.cache_metadata} WHERE key = 'cacheBuiltAt'`).get() as
      | { value: string }
      | undefined
    const hash = this.db.prepare(`SELECT value FROM ${T.cache_metadata} WHERE key = 'contentHash'`).get() as
      | { value: string }
      | undefined

    if (!mtime || !builtAt) return null

    return {
      boardMtime: parseInt(mtime.value, 10),
      cacheBuiltAt: parseInt(builtAt.value, 10),
      contentHash: hash?.value,
    }
  }

  setCacheMetadata(meta: { boardMtime: number; cacheBuiltAt: number; contentHash?: string }): void {
    this.db
      .prepare(
        `
      INSERT OR REPLACE INTO ${T.cache_metadata} (key, value)
      VALUES ('boardMtime', ?)
    `
      )
      .run(meta.boardMtime.toString())

    this.db
      .prepare(
        `
      INSERT OR REPLACE INTO ${T.cache_metadata} (key, value)
      VALUES ('cacheBuiltAt', ?)
    `
      )
      .run(meta.cacheBuiltAt.toString())

    if (meta.contentHash) {
      this.db
        .prepare(
          `
        INSERT OR REPLACE INTO ${T.cache_metadata} (key, value)
        VALUES ('contentHash', ?)
      `
        )
        .run(meta.contentHash)
    }
  }

  rebuildFromBoard(board: Board): void {
    const projectId = this.currentProjectId

    // Clear existing data for current project only
    this.db.prepare(`DELETE FROM ${T.tickets} WHERE project_id = ?`).run(projectId)
    this.db.prepare(`DELETE FROM ${T.columns} WHERE project_id = ?`).run(projectId)

    // Rebuild
    const now = Date.now()

    // Update or insert project - preserve existing name if board.name is default "Board"
    const existingProject = this.db.prepare(`SELECT name FROM ${T.projects} WHERE id = ?`).get(projectId) as { name: string } | undefined
    const projectName = (board.name === 'Board' && existingProject?.name) ? existingProject.name : board.name

    this.db.prepare(`
      INSERT OR REPLACE INTO ${T.projects} (id, name, updated_at)
      VALUES (?, ?, ?)
    `).run(projectId, projectName, now)

    // Insert columns and tickets
    const insertColumn = this.db.prepare(`
      INSERT INTO ${T.columns} (id, project_id, name, position, created_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    const insertTicket = this.db.prepare(`
      INSERT INTO ${T.tickets} (
        id, project_id, title, description, priority, category,
        status, owner, assignee, spec_id,
        created_at, updated_at, last_synced_from_spec, last_synced_from_board
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const insertBoardTicket = this.db.prepare(`
      INSERT INTO ${T.board_tickets} (project_id, ticket_id, column_id, position)
      VALUES (?, ?, ?, ?)
    `)
    const insertSubtask = this.db.prepare(`
      INSERT INTO ${T.subtasks} (id, ticket_id, title, done, position)
      VALUES (?, ?, ?, ?, ?)
    `)
    const insertMeta = this.db.prepare(`
      INSERT INTO ${T.ticket_metadata} (ticket_id, key, value)
      VALUES (?, ?, ?)
    `)

    for (const column of board.columns) {
      insertColumn.run(column.id, projectId, column.name, column.position, now)

      for (const ticket of column.tickets) {
        // Insert ticket data
        insertTicket.run(
          ticket.id,
          projectId,
          ticket.title,
          ticket.description || null,
          ticket.priority || null,
          ticket.category || null,
          ticket.status || 'backlog',
          ticket.owner || null,
          ticket.assignee || null,
          ticket.specId || null,
          ticket.createdAt.toISOString(),
          ticket.updatedAt.toISOString(),
          ticket.lastSyncedFromSpec || null,
          ticket.lastSyncedFromBoard || null
        )

        // Insert board position
        insertBoardTicket.run(projectId, ticket.id, column.id, ticket.position)

        // Subtasks
        ticket.subtasks.forEach((st, idx) => {
          insertSubtask.run(st.id, ticket.id, st.title, st.done ? 1 : 0, idx)
        })

        // Metadata
        for (const [key, value] of Object.entries(ticket.metadata)) {
          insertMeta.run(ticket.id, key, value)
        }
      }
    }
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private async getTicketsForColumn(columnId: string, projectId?: string): Promise<Ticket[]> {
    const pid = projectId ?? this.currentProjectId
    const rows = this.db.prepare(`
      SELECT t.*, bt.column_id, bt.position, c.name as column_name
      FROM ${T.tickets} t
      JOIN ${T.board_tickets} bt ON t.id = bt.ticket_id AND t.project_id = bt.project_id
      JOIN ${T.columns} c ON bt.project_id = c.project_id AND bt.column_id = c.id
      WHERE t.project_id = ? AND bt.column_id = ?
      ORDER BY bt.position
    `).all(pid, columnId) as Array<{
      id: string
      project_id: string
      title: string
      description: string | null
      priority: string | null
      category: string | null
      status: string
      owner: string | null
      assignee: string | null
      spec_id: string | null
      epic_id: string | null
      column_id: string
      column_name: string
      position: number
      created_at: string
      updated_at: string
      last_synced_from_spec: string | null
      last_synced_from_board: string | null
    }>

    return Promise.all(rows.map((row) => this.rowToTicket(row)))
  }

  private async getTicketById(id: string): Promise<Ticket | null> {
    const projectId = this.currentProjectId
    const row = this.db.prepare(`
      SELECT t.*, bt.column_id, bt.position, c.name as column_name
      FROM ${T.tickets} t
      LEFT JOIN ${T.board_tickets} bt ON t.id = bt.ticket_id AND t.project_id = bt.project_id
      LEFT JOIN ${T.columns} c ON bt.project_id = c.project_id AND bt.column_id = c.id
      WHERE t.project_id = ? AND LOWER(t.id) = LOWER(?)
    `).get(projectId, id) as
      | {
          id: string
          project_id: string
          title: string
          description: string | null
          priority: string | null
          category: string | null
          status: string
          owner: string | null
          assignee: string | null
          spec_id: string | null
          epic_id: string | null
          column_id: string | null
          column_name: string | null
          position: number | null
          created_at: string
          updated_at: string
          last_synced_from_spec: string | null
          last_synced_from_board: string | null
        }
      | undefined

    if (!row) return null

    return this.rowToTicket(row)
  }

  private async rowToTicket(row: {
    id: string
    title: string
    description: string | null
    priority: string | null
    category: string | null
    status: string
    owner: string | null
    assignee: string | null
    spec_id: string | null
    epic_id: string | null
    column_id: string | null
    column_name: string | null
    position: number | null
    created_at: string
    updated_at: string
    last_synced_from_spec: string | null
    last_synced_from_board: string | null
  }): Promise<Ticket> {
    // Get subtasks
    const subtasks = this.db
      .prepare(`SELECT * FROM ${T.subtasks} WHERE ticket_id = ? ORDER BY position`)
      .all(row.id) as Array<{
      id: string
      title: string
      done: number
    }>

    // Get metadata
    const metaRows = this.db
      .prepare(`SELECT key, value FROM ${T.ticket_metadata} WHERE ticket_id = ?`)
      .all(row.id) as Array<{ key: string; value: string }>
    const metadata: Record<string, string> = {}
    for (const m of metaRows) {
      metadata[m.key] = m.value
    }

    // Get spec path for backward compat
    let specPath: string | undefined
    if (row.spec_id) {
      const specRow = this.db
        .prepare(`SELECT path FROM ${T.specs} WHERE id = ?`)
        .get(row.spec_id) as { path: string } | undefined
      if (specRow) {
        specPath = specRow.path
      }
    }

    return {
      id: row.id,
      title: row.title,
      description: row.description || undefined,
      priority: row.priority || undefined,
      category: row.category || undefined,
      status: row.status as Ticket['status'],
      owner: row.owner || undefined,
      assignee: row.assignee || undefined,
      specId: row.spec_id || undefined,
      epicId: row.epic_id || undefined,
      subtasks: subtasks.map((st) => ({
        id: st.id,
        title: st.title,
        done: st.done === 1,
      })),
      metadata,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      lastSyncedFromSpec: row.last_synced_from_spec ? new Date(row.last_synced_from_spec) : undefined,
      lastSyncedFromBoard: row.last_synced_from_board ? new Date(row.last_synced_from_board) : undefined,
      // DEPRECATED fields for backward compat
      column: row.column_name || undefined,
      position: row.position !== null ? row.position : undefined,
      specs: specPath ? [specPath] : [],
    }
  }

  private getMaxColumnPosition(): number {
    const projectId = this.currentProjectId
    const result = this.db.prepare(`
      SELECT MAX(position) as max FROM ${T.columns}
      WHERE project_id = ?
    `).get(projectId) as { max: number | null }
    return result.max ?? -1
  }

  private getMaxTicketPosition(columnId: string): number {
    const projectId = this.currentProjectId
    const result = this.db.prepare(`
      SELECT MAX(position) as max FROM ${T.board_tickets}
      WHERE project_id = ? AND column_id = ?
    `).get(projectId, columnId) as { max: number | null }
    return result.max ?? -1
  }

  private updateBoardTimestamp(): void {
    this.db.prepare(`
      UPDATE ${T.projects}
      SET updated_at = ?
      WHERE id = ?
    `).run(Date.now(), this.currentProjectId)
  }
}

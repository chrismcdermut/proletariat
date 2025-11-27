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
import { slugify } from './utils.js'

// =============================================================================
// Table name constants (all PMO tables use pmo_ prefix in workspace.db)
// =============================================================================

const T = {
  projects: 'pmo_projects',
  initiatives: 'pmo_initiatives',
  epics: 'pmo_epics',
  columns: 'pmo_columns',
  tickets: 'pmo_tickets',
  subtasks: 'pmo_subtasks',
  ticket_metadata: 'pmo_ticket_metadata',
  specs: 'pmo_specs',
  ticket_specs: 'pmo_ticket_specs',
  ticket_assignments: 'pmo_ticket_assignments',
  cache_metadata: 'pmo_cache_metadata',
} as const

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

    if (!fs.existsSync(dbPath)) {
      throw new Error(`Database not found: ${dbPath}. Run 'prlt init' first.`)
    }

    // Open database
    this.db = new Database(dbPath)
    this.db.pragma('foreign_keys = ON')

    // Ensure PMO tables exist (migration for older workspaces)
    this.ensurePMOTables()

    // Run migration for multi-project support
    this.migrateToMultiProject()
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
   * Ensure PMO tables exist in the database.
   * This handles migration for workspaces created before PMO was added.
   */
  private ensurePMOTables(): void {
    this.db.exec(`
      -- Projects (replaces pmo_board for multi-project support)
      CREATE TABLE IF NOT EXISTS ${T.projects} (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        template TEXT,
        description TEXT,
        initiative_id TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Initiatives (optional OKR-level grouping)
      CREATE TABLE IF NOT EXISTS ${T.initiatives} (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        objective TEXT,
        key_results TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Columns (kanban lanes) - now per-project
      CREATE TABLE IF NOT EXISTS ${T.columns} (
        id TEXT NOT NULL,
        project_id TEXT NOT NULL DEFAULT 'default',
        name TEXT NOT NULL,
        position INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (project_id, id)
      );

      -- Tickets (kanban cards) - now per-project
      CREATE TABLE IF NOT EXISTS ${T.tickets} (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL DEFAULT 'default',
        title TEXT NOT NULL,
        column_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        priority TEXT,
        category TEXT,
        description TEXT,
        epic_id TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id, column_id) REFERENCES ${T.columns}(project_id, id) ON DELETE CASCADE
      );

      -- Epics (optional grouping within a project)
      CREATE TABLE IF NOT EXISTS ${T.epics} (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES ${T.projects}(id) ON DELETE CASCADE
      );

      -- Subtasks
      CREATE TABLE IF NOT EXISTS ${T.subtasks} (
        id TEXT NOT NULL,
        ticket_id TEXT NOT NULL REFERENCES ${T.tickets}(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        done INTEGER DEFAULT 0,
        position INTEGER NOT NULL,
        PRIMARY KEY (ticket_id, id)
      );

      -- Custom metadata fields for tickets
      CREATE TABLE IF NOT EXISTS ${T.ticket_metadata} (
        ticket_id TEXT NOT NULL REFERENCES ${T.tickets}(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        value TEXT,
        PRIMARY KEY (ticket_id, key)
      );

      -- Specs (specification documents)
      CREATE TABLE IF NOT EXISTS ${T.specs} (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        title TEXT,
        status TEXT DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Ticket-Spec relationship (many-to-many)
      CREATE TABLE IF NOT EXISTS ${T.ticket_specs} (
        ticket_id TEXT NOT NULL REFERENCES ${T.tickets}(id) ON DELETE CASCADE,
        spec_id TEXT NOT NULL REFERENCES ${T.specs}(id) ON DELETE CASCADE,
        PRIMARY KEY (ticket_id, spec_id)
      );

      -- Agent-Ticket assignments (many-to-many)
      CREATE TABLE IF NOT EXISTS ${T.ticket_assignments} (
        ticket_id TEXT NOT NULL REFERENCES ${T.tickets}(id) ON DELETE CASCADE,
        agent_name TEXT NOT NULL,
        assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (ticket_id, agent_name)
      );

      -- Cache metadata (for board.md sync)
      CREATE TABLE IF NOT EXISTS ${T.cache_metadata} (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_pmo_columns_project ON ${T.columns}(project_id);
      CREATE INDEX IF NOT EXISTS idx_pmo_tickets_project ON ${T.tickets}(project_id);
      CREATE INDEX IF NOT EXISTS idx_pmo_tickets_column ON ${T.tickets}(column_id);
      CREATE INDEX IF NOT EXISTS idx_pmo_tickets_priority ON ${T.tickets}(priority);
      CREATE INDEX IF NOT EXISTS idx_pmo_tickets_category ON ${T.tickets}(category);
      CREATE INDEX IF NOT EXISTS idx_pmo_tickets_epic ON ${T.tickets}(epic_id);
      CREATE INDEX IF NOT EXISTS idx_pmo_subtasks_ticket ON ${T.subtasks}(ticket_id);
      CREATE INDEX IF NOT EXISTS idx_pmo_ticket_specs_spec ON ${T.ticket_specs}(spec_id);
      CREATE INDEX IF NOT EXISTS idx_pmo_assignments_agent ON ${T.ticket_assignments}(agent_name);
      CREATE INDEX IF NOT EXISTS idx_pmo_epics_project ON ${T.epics}(project_id);
      CREATE INDEX IF NOT EXISTS idx_pmo_projects_initiative ON ${T.projects}(initiative_id);
    `)
  }

  /**
   * Migrate existing data to multi-project schema.
   * This handles upgrading workspaces from the old single-board schema.
   */
  private migrateToMultiProject(): void {
    // Check if pmo_board table exists (old schema)
    const hasOldBoardTable = this.db.prepare(`
      SELECT COUNT(*) as count FROM sqlite_master
      WHERE type = 'table' AND name = 'pmo_board'
    `).get() as { count: number }

    if (hasOldBoardTable.count === 0) {
      // No old schema, ensure default project exists
      this.ensureDefaultProject()
      return
    }

    // Check if columns already have project_id (already migrated)
    const columnsInfo = this.db.prepare(`PRAGMA table_info(${T.columns})`).all() as Array<{ name: string }>
    const hasProjectIdInColumns = columnsInfo.some(col => col.name === 'project_id')

    if (hasProjectIdInColumns) {
      // Already migrated, just ensure default project exists
      this.ensureDefaultProject()
      return
    }

    // Perform migration
    this.db.transaction(() => {
      // Get existing board data
      const existingBoard = this.db.prepare(`SELECT * FROM pmo_board WHERE id = 'default'`).get() as
        | { id: string; name: string; template: string | null; updated_at: string }
        | undefined

      // Create default project from existing board
      if (existingBoard) {
        this.db.prepare(`
          INSERT OR IGNORE INTO ${T.projects} (id, name, template, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run('default', existingBoard.name, existingBoard.template, existingBoard.updated_at, existingBoard.updated_at)
      } else {
        this.ensureDefaultProject()
      }

      // Recreate columns table with project_id
      // First, save existing columns
      const existingColumns = this.db.prepare(`SELECT * FROM ${T.columns}`).all() as Array<{
        id: string
        name: string
        position: number
        created_at: string
      }>

      // Save existing tickets
      const existingTickets = this.db.prepare(`SELECT * FROM ${T.tickets}`).all() as Array<{
        id: string
        title: string
        column_id: string
        position: number
        priority: string | null
        category: string | null
        description: string | null
        created_at: string
        updated_at: string
      }>

      // Drop old table and recreate with new schema
      this.db.exec(`
        DROP TABLE IF EXISTS ${T.tickets};
        DROP TABLE IF EXISTS ${T.columns};

        CREATE TABLE ${T.columns} (
          id TEXT NOT NULL,
          project_id TEXT NOT NULL DEFAULT 'default',
          name TEXT NOT NULL,
          position INTEGER NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (project_id, id)
        );

        CREATE TABLE ${T.tickets} (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL DEFAULT 'default',
          title TEXT NOT NULL,
          column_id TEXT NOT NULL,
          position INTEGER NOT NULL,
          priority TEXT,
          category TEXT,
          description TEXT,
          epic_id TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (project_id, column_id) REFERENCES ${T.columns}(project_id, id) ON DELETE CASCADE
        );

        CREATE INDEX idx_pmo_columns_project ON ${T.columns}(project_id);
        CREATE INDEX idx_pmo_tickets_project ON ${T.tickets}(project_id);
        CREATE INDEX idx_pmo_tickets_column ON ${T.tickets}(column_id);
      `)

      // Re-insert columns with project_id = 'default'
      const insertColumn = this.db.prepare(`
        INSERT INTO ${T.columns} (id, project_id, name, position, created_at)
        VALUES (?, 'default', ?, ?, ?)
      `)
      for (const col of existingColumns) {
        insertColumn.run(col.id, col.name, col.position, col.created_at)
      }

      // Re-insert tickets with project_id = 'default'
      const insertTicket = this.db.prepare(`
        INSERT INTO ${T.tickets} (id, project_id, title, column_id, position, priority, category, description, created_at, updated_at)
        VALUES (?, 'default', ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const ticket of existingTickets) {
        insertTicket.run(
          ticket.id,
          ticket.title,
          ticket.column_id,
          ticket.position,
          ticket.priority,
          ticket.category,
          ticket.description,
          ticket.created_at,
          ticket.updated_at
        )
      }

      // Drop old pmo_board table
      this.db.exec(`DROP TABLE IF EXISTS pmo_board`)
    })()
  }

  /**
   * Ensure the default project exists
   */
  private ensureDefaultProject(): void {
    const exists = this.db.prepare(`SELECT id FROM ${T.projects} WHERE id = 'default'`).get()
    if (!exists) {
      this.db.prepare(`
        INSERT INTO ${T.projects} (id, name, template, created_at, updated_at)
        VALUES ('default', 'Main Project', 'kanban', datetime('now'), datetime('now'))
      `).run()
    }
  }

  // ===========================================================================
  // Project Operations
  // ===========================================================================

  async createProject(project: { id?: string; name: string; template?: string; description?: string }): Promise<Board> {
    const id = project.id || slugify(project.name)
    const now = new Date().toISOString()

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
    const now = new Date().toISOString()

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
    `).run(id, projectId, name, pos, new Date().toISOString())

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
      SELECT COUNT(*) as count FROM ${T.tickets}
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
    const id = ticket.id || slugify(ticket.title || 'untitled')
    const title = ticket.title || id
    const projectId = this.currentProjectId

    // Get column (default to first column)
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

    // Get position
    const position = ticket.position ?? this.getMaxTicketPosition(columnId) + 1

    const now = new Date().toISOString()

    // Insert ticket
    this.db.prepare(`
      INSERT INTO ${T.tickets} (id, project_id, title, column_id, position, priority, category, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, projectId, title, columnId, position, ticket.priority || null, ticket.category || null, ticket.description || null, now, now)

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

    // Insert spec links
    if (ticket.specs && ticket.specs.length > 0) {
      const insertSpec = this.db.prepare(`
        INSERT OR IGNORE INTO ${T.ticket_specs} (ticket_id, spec_id)
        VALUES (?, ?)
      `)
      ticket.specs.forEach((specId) => {
        insertSpec.run(id, specId)
      })
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
    if (changes.priority !== undefined) {
      updates.push('priority = ?')
      params.push(changes.priority)
    }
    if (changes.category !== undefined) {
      updates.push('category = ?')
      params.push(changes.category)
    }
    if (changes.description !== undefined) {
      updates.push('description = ?')
      params.push(changes.description)
    }

    if (updates.length > 0) {
      updates.push('updated_at = ?')
      params.push(new Date().toISOString())
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

    // Update specs if provided
    if (changes.specs !== undefined) {
      this.db.prepare(`DELETE FROM ${T.ticket_specs} WHERE ticket_id = ?`).run(id)
      const insertSpec = this.db.prepare(`
        INSERT OR IGNORE INTO ${T.ticket_specs} (ticket_id, spec_id)
        VALUES (?, ?)
      `)
      changes.specs.forEach((specId) => {
        insertSpec.run(id, specId)
      })
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

    // If moving within same column, adjust positions
    if (existing.column === targetColumnId) {
      if (pos < existing.position) {
        this.db.prepare(`
          UPDATE ${T.tickets}
          SET position = position + 1
          WHERE project_id = ? AND column_id = ? AND position >= ? AND position < ?
        `).run(projectId, targetColumnId, pos, existing.position)
      } else if (pos > existing.position) {
        this.db.prepare(`
          UPDATE ${T.tickets}
          SET position = position - 1
          WHERE project_id = ? AND column_id = ? AND position > ? AND position <= ?
        `).run(projectId, targetColumnId, existing.position, pos)
      }
    } else {
      // Moving to different column
      // Shift positions in old column
      this.db.prepare(`
        UPDATE ${T.tickets}
        SET position = position - 1
        WHERE project_id = ? AND column_id = ? AND position > ?
      `).run(projectId, existing.column, existing.position)
      // Shift positions in new column
      this.db.prepare(`
        UPDATE ${T.tickets}
        SET position = position + 1
        WHERE project_id = ? AND column_id = ? AND position >= ?
      `).run(projectId, targetColumnId, pos)
    }

    this.db
      .prepare(`UPDATE ${T.tickets} SET column_id = ?, position = ?, updated_at = ? WHERE id = ?`)
      .run(targetColumnId, pos, new Date().toISOString(), id)

    this.updateBoardTimestamp()

    return this.getTicketById(id) as Promise<Ticket>
  }

  async deleteTicket(id: string): Promise<void> {
    const projectId = this.currentProjectId
    const existing = await this.getTicketById(id)
    if (!existing) {
      throw new PMOError('NOT_FOUND', `Ticket not found: ${id}`, id)
    }

    const result = this.db.prepare(`
      DELETE FROM ${T.tickets}
      WHERE project_id = ? AND id = ?
    `).run(projectId, id)

    if (result.changes === 0) {
      throw new PMOError('NOT_FOUND', `Ticket not found: ${id}`, id)
    }

    // Shift positions of remaining tickets
    this.db.prepare(`
      UPDATE ${T.tickets}
      SET position = position - 1
      WHERE project_id = ? AND column_id = ? AND position > ?
    `).run(projectId, existing.column, existing.position)

    this.updateBoardTimestamp()
  }

  async listTickets(filter?: TicketFilter): Promise<Ticket[]> {
    const projectId = this.currentProjectId
    let query = `
      SELECT t.*, c.name as column_name
      FROM ${T.tickets} t
      JOIN ${T.columns} c ON t.project_id = c.project_id AND t.column_id = c.id
      WHERE t.project_id = ?
    `
    const params: unknown[] = [projectId]

    if (filter?.column) {
      query += ' AND (c.id = ? OR c.name = ?)'
      params.push(filter.column, filter.column)
    }
    if (filter?.priority) {
      query += ' AND t.priority = ?'
      params.push(filter.priority)
    }
    if (filter?.category) {
      query += ' AND t.category = ?'
      params.push(filter.category)
    }
    if (filter?.search) {
      query += ' AND (t.title LIKE ? OR t.description LIKE ?)'
      params.push(`%${filter.search}%`, `%${filter.search}%`)
    }
    if (filter?.spec) {
      query += ` AND EXISTS (SELECT 1 FROM ${T.ticket_specs} ts WHERE ts.ticket_id = t.id AND ts.spec_id = ?)`
      params.push(filter.spec)
    }

    query += ' ORDER BY c.position, t.position'

    const rows = this.db.prepare(query).all(...params) as Array<{
      id: string
      project_id: string
      title: string
      column_id: string
      column_name: string
      position: number
      priority: string | null
      category: string | null
      description: string | null
      created_at: string
      updated_at: string
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

    this.db.prepare(`UPDATE ${T.tickets} SET updated_at = ? WHERE id = ?`).run(new Date().toISOString(), ticketId)

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

    this.db.prepare(`UPDATE ${T.tickets} SET updated_at = ? WHERE id = ?`).run(new Date().toISOString(), ticketId)

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

    this.db.prepare(`UPDATE ${T.tickets} SET updated_at = ? WHERE id = ?`).run(new Date().toISOString(), ticketId)

    this.updateBoardTimestamp()
  }

  // ===========================================================================
  // Spec Operations
  // ===========================================================================

  async createSpec(spec: Partial<Spec>): Promise<Spec> {
    const id = spec.id || slugify(spec.path || 'untitled')
    const specPath = spec.path || `specs/${id}.md`
    const now = new Date().toISOString()

    this.db
      .prepare(
        `
      INSERT INTO ${T.specs} (id, path, title, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `
      )
      .run(id, specPath, spec.title || null, spec.status || 'active', now, now)

    return {
      id,
      path: specPath,
      title: spec.title,
      status: spec.status || 'active',
      createdAt: new Date(now),
      updatedAt: new Date(now),
    }
  }

  async getSpec(id: string): Promise<Spec | null> {
    const row = this.db.prepare(`SELECT * FROM ${T.specs} WHERE id = ?`).get(id) as
      | {
          id: string
          path: string
          title: string | null
          status: string
          created_at: string
          updated_at: string
        }
      | undefined

    if (!row) return null

    return {
      id: row.id,
      path: row.path,
      title: row.title || undefined,
      status: row.status as 'draft' | 'active' | 'deprecated',
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }
  }

  async listSpecs(filter?: SpecFilter): Promise<Spec[]> {
    let query = `SELECT * FROM ${T.specs} WHERE 1=1`
    const params: unknown[] = []

    if (filter?.status) {
      query += ' AND status = ?'
      params.push(filter.status)
    }
    if (filter?.search) {
      query += ' AND (id LIKE ? OR title LIKE ? OR path LIKE ?)'
      params.push(`%${filter.search}%`, `%${filter.search}%`, `%${filter.search}%`)
    }

    query += ' ORDER BY id'

    const rows = this.db.prepare(query).all(...params) as Array<{
      id: string
      path: string
      title: string | null
      status: string
      created_at: string
      updated_at: string
    }>

    return rows.map((row) => ({
      id: row.id,
      path: row.path,
      title: row.title || undefined,
      status: row.status as 'draft' | 'active' | 'deprecated',
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

    if (changes.path !== undefined) {
      updates.push('path = ?')
      params.push(changes.path)
    }
    if (changes.title !== undefined) {
      updates.push('title = ?')
      params.push(changes.title)
    }
    if (changes.status !== undefined) {
      updates.push('status = ?')
      params.push(changes.status)
    }

    if (updates.length > 0) {
      updates.push('updated_at = ?')
      params.push(new Date().toISOString())
      params.push(id)

      this.db.prepare(`UPDATE ${T.specs} SET ${updates.join(', ')} WHERE id = ?`).run(...params)
    }

    return this.getSpec(id) as Promise<Spec>
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

    this.db
      .prepare(
        `
      INSERT OR IGNORE INTO ${T.ticket_specs} (ticket_id, spec_id)
      VALUES (?, ?)
    `
      )
      .run(ticketId, specId)

    this.db.prepare(`UPDATE ${T.tickets} SET updated_at = ? WHERE id = ?`).run(new Date().toISOString(), ticketId)

    this.updateBoardTimestamp()
  }

  async unlinkTicketFromSpec(ticketId: string, specId: string): Promise<void> {
    this.db.prepare(`DELETE FROM ${T.ticket_specs} WHERE ticket_id = ? AND spec_id = ?`).run(ticketId, specId)

    this.db.prepare(`UPDATE ${T.tickets} SET updated_at = ? WHERE id = ?`).run(new Date().toISOString(), ticketId)

    this.updateBoardTimestamp()
  }

  async getTicketsForSpec(specId: string): Promise<Ticket[]> {
    return this.listTickets({ spec: specId })
  }

  async getSpecsForTicket(ticketId: string): Promise<Spec[]> {
    const rows = this.db
      .prepare(
        `
      SELECT s.* FROM ${T.specs} s
      JOIN ${T.ticket_specs} ts ON s.id = ts.spec_id
      WHERE ts.ticket_id = ?
      ORDER BY s.id
    `
      )
      .all(ticketId) as Array<{
      id: string
      path: string
      title: string | null
      status: string
      created_at: string
      updated_at: string
    }>

    return rows.map((row) => ({
      id: row.id,
      path: row.path,
      title: row.title || undefined,
      status: row.status as 'draft' | 'active' | 'deprecated',
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }))
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
    const now = new Date().toISOString()

    // Update or insert project
    this.db.prepare(`
      INSERT OR REPLACE INTO ${T.projects} (id, name, updated_at)
      VALUES (?, ?, ?)
    `).run(projectId, board.name, now)

    // Insert columns and tickets
    const insertColumn = this.db.prepare(`
      INSERT INTO ${T.columns} (id, project_id, name, position, created_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    const insertTicket = this.db.prepare(`
      INSERT INTO ${T.tickets} (id, project_id, title, column_id, position, priority, category, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const insertSubtask = this.db.prepare(`
      INSERT INTO ${T.subtasks} (id, ticket_id, title, done, position)
      VALUES (?, ?, ?, ?, ?)
    `)
    const insertMeta = this.db.prepare(`
      INSERT INTO ${T.ticket_metadata} (ticket_id, key, value)
      VALUES (?, ?, ?)
    `)
    const insertSpec = this.db.prepare(`
      INSERT OR IGNORE INTO ${T.ticket_specs} (ticket_id, spec_id)
      VALUES (?, ?)
    `)

    for (const column of board.columns) {
      insertColumn.run(column.id, projectId, column.name, column.position, now)

      for (const ticket of column.tickets) {
        insertTicket.run(
          ticket.id,
          projectId,
          ticket.title,
          column.id,
          ticket.position,
          ticket.priority || null,
          ticket.category || null,
          ticket.description || null,
          ticket.createdAt.toISOString(),
          ticket.updatedAt.toISOString()
        )

        // Subtasks
        ticket.subtasks.forEach((st, idx) => {
          insertSubtask.run(st.id, ticket.id, st.title, st.done ? 1 : 0, idx)
        })

        // Metadata
        for (const [key, value] of Object.entries(ticket.metadata)) {
          insertMeta.run(ticket.id, key, value)
        }

        // Specs
        for (const specId of ticket.specs) {
          insertSpec.run(ticket.id, specId)
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
      SELECT t.*, c.name as column_name
      FROM ${T.tickets} t
      JOIN ${T.columns} c ON t.project_id = c.project_id AND t.column_id = c.id
      WHERE t.project_id = ? AND t.column_id = ?
      ORDER BY t.position
    `).all(pid, columnId) as Array<{
      id: string
      project_id: string
      title: string
      column_id: string
      column_name: string
      position: number
      priority: string | null
      category: string | null
      description: string | null
      created_at: string
      updated_at: string
    }>

    return Promise.all(rows.map((row) => this.rowToTicket(row)))
  }

  private async getTicketById(id: string): Promise<Ticket | null> {
    const projectId = this.currentProjectId
    const row = this.db.prepare(`
      SELECT t.*, c.name as column_name
      FROM ${T.tickets} t
      JOIN ${T.columns} c ON t.project_id = c.project_id AND t.column_id = c.id
      WHERE t.project_id = ? AND t.id = ?
    `).get(projectId, id) as
      | {
          id: string
          project_id: string
          title: string
          column_id: string
          column_name: string
          position: number
          priority: string | null
          category: string | null
          description: string | null
          created_at: string
          updated_at: string
        }
      | undefined

    if (!row) return null

    return this.rowToTicket(row)
  }

  private async rowToTicket(row: {
    id: string
    title: string
    column_id: string
    column_name: string
    position: number
    priority: string | null
    category: string | null
    description: string | null
    created_at: string
    updated_at: string
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

    // Get specs
    const specRows = this.db
      .prepare(`SELECT spec_id FROM ${T.ticket_specs} WHERE ticket_id = ?`)
      .all(row.id) as Array<{ spec_id: string }>

    return {
      id: row.id,
      title: row.title,
      column: row.column_name,
      position: row.position,
      priority: row.priority || undefined,
      category: row.category || undefined,
      description: row.description || undefined,
      specs: specRows.map((s) => s.spec_id),
      subtasks: subtasks.map((st) => ({
        id: st.id,
        title: st.title,
        done: st.done === 1,
      })),
      metadata,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
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
      SELECT MAX(position) as max FROM ${T.tickets}
      WHERE project_id = ? AND column_id = ?
    `).get(projectId, columnId) as { max: number | null }
    return result.max ?? -1
  }

  private updateBoardTimestamp(): void {
    this.db.prepare(`
      UPDATE ${T.projects}
      SET updated_at = ?
      WHERE id = ?
    `).run(new Date().toISOString(), this.currentProjectId)
  }
}

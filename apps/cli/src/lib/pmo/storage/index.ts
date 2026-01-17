/**
 * SQLite Storage Implementation for PMO
 *
 * This is the main facade that delegates to domain-specific storage modules.
 * Uses the unified workspace.db database with pmo_ prefixed tables.
 */

import Database from 'better-sqlite3'
import {
  AcceptanceCriterion,
  Board,
  BoardConfig,
  BoardView,
  BoardViewFilter,
  BoardViewFilters,
  Column,
  CreateTicketInput,
  Epic,
  EpicDependency,
  EpicDependencyType,
  EpicFilter,
  PhaseFilter,
  PhaseTemplate,
  PhaseTemplateFilter,
  PMOError,
  PMOStorage,
  Project,
  ProjectFilter,
  ProjectPhase,
  Spec,
  SpecDependency,
  SpecDependencyType,
  SpecFilter,
  StateCategory,
  Subtask,
  SyncResult,
  SyncStatus,
  TemplateFilter,
  Ticket,
  TicketDependency,
  TicketDependencyType,
  TicketFilter,
  TicketTemplate,
  TicketTemplateFilter,
  WorkAction,
  WorkActionFilter,
  WorkflowStatus,
  WorkflowTemplate,
} from '../types.js'
import { PMO_TABLES, PMO_SCHEMA_SQL, validateTicketSchema } from '../schema.js'
import { StorageContext } from './types.js'
import {
  initializePMOTables,
  runMigrations,
  seedBuiltinTemplates,
  seedBuiltinPhases,
  seedBuiltinPhaseTemplates,
  seedBuiltinActions,
  seedBuiltinTicketTemplates,
  updateBoardTimestamp,
  getMaxColumnPosition,
  getMaxTicketPosition,
} from './base.js'
import { ProjectStorage } from './projects.js'
import { ColumnStorage } from './columns.js'
import { TicketStorage } from './tickets.js'
import { SubtaskStorage, AcceptanceCriteriaStorage } from './subtasks.js'
import { SpecStorage } from './specs.js'
import { EpicStorage } from './epics.js'
import { DependencyStorage } from './dependencies.js'
import { StatusStorage } from './statuses.js'
import { TemplateStorage } from './templates.js'
import { PhaseStorage } from './phases.js'
import { ActionStorage } from './actions.js'
import { ViewStorage } from './views.js'

const T = PMO_TABLES

export class SQLiteStorage implements PMOStorage {
  readonly type = 'sqlite' as const
  private db: Database.Database
  private dbPath: string

  // Domain-specific storage modules
  private projectStorage: ProjectStorage
  private columnStorage: ColumnStorage
  private ticketStorage: TicketStorage
  private subtaskStorage: SubtaskStorage
  private acceptanceCriteriaStorage: AcceptanceCriteriaStorage
  private specStorage: SpecStorage
  private epicStorage: EpicStorage
  private dependencyStorage: DependencyStorage
  private statusStorage: StatusStorage
  private templateStorage: TemplateStorage
  private phaseStorage: PhaseStorage
  private actionStorage: ActionStorage
  private viewStorage: ViewStorage

  constructor(dbPath: string) {
    this.dbPath = dbPath

    // Open database (creates if doesn't exist)
    this.db = new Database(dbPath)
    this.db.pragma('foreign_keys = ON')

    // Create the storage context shared by all modules
    // Note: projectId is passed explicitly to operations, not stored in context
    const ctx: StorageContext = {
      db: this.db,
      updateBoardTimestamp: (projectId: string) => updateBoardTimestamp(this.db, projectId),
    }

    // Initialize domain-specific storage modules
    this.projectStorage = new ProjectStorage(ctx)
    this.columnStorage = new ColumnStorage(ctx)
    this.ticketStorage = new TicketStorage(ctx)
    this.subtaskStorage = new SubtaskStorage(ctx)
    this.acceptanceCriteriaStorage = new AcceptanceCriteriaStorage(ctx)
    this.specStorage = new SpecStorage(ctx)
    this.epicStorage = new EpicStorage(ctx)
    this.dependencyStorage = new DependencyStorage(ctx)
    this.statusStorage = new StatusStorage(ctx)
    this.templateStorage = new TemplateStorage(ctx)
    this.phaseStorage = new PhaseStorage(ctx)
    this.actionStorage = new ActionStorage(ctx)
    this.viewStorage = new ViewStorage(ctx)

    // Ensure PMO tables exist
    this.ensurePMOTables()
  }

  /**
   * Get the underlying database connection.
   */
  getDatabase(): Database.Database {
    return this.db
  }

  /**
   * Ensure PMO tables exist in the database.
   */
  private ensurePMOTables(): void {
    // Run migrations FIRST for existing databases
    runMigrations(this.db)

    // Create tables and indexes using shared schema
    this.db.exec(PMO_SCHEMA_SQL)

    // Seed built-in data
    seedBuiltinTemplates(this.db)
    seedBuiltinPhases(this.db)
    seedBuiltinPhaseTemplates(this.db)
    seedBuiltinActions(this.db)
    seedBuiltinTicketTemplates(this.db)

    // Validate schema
    validateTicketSchema(this.db)
  }

  // ===========================================================================
  // Board Operations
  // ===========================================================================

  async init(projectId: string, config: BoardConfig): Promise<Board> {
    return this.projectStorage.init(projectId, config)
  }

  async getBoard(projectId: string): Promise<Board> {
    return this.projectStorage.getBoard(projectId)
  }

  async getBoardMarkdown(projectId: string): Promise<string> {
    return this.projectStorage.getBoardMarkdown(projectId)
  }

  // ===========================================================================
  // Column Operations
  // ===========================================================================

  getColumnNames(projectId: string): string[] {
    return this.columnStorage.getColumnNames(projectId)
  }

  async createColumn(projectId: string, name: string, position?: number): Promise<Column> {
    return this.columnStorage.createColumn(projectId, name, position)
  }

  async renameColumn(projectId: string, id: string, name: string): Promise<Column> {
    return this.columnStorage.renameColumn(projectId, id, name)
  }

  async moveColumn(projectId: string, id: string, position: number): Promise<Column> {
    return this.columnStorage.moveColumn(projectId, id, position)
  }

  async deleteColumn(projectId: string, id: string, cascade?: boolean): Promise<void> {
    return this.columnStorage.deleteColumn(projectId, id, cascade)
  }

  // ===========================================================================
  // Ticket Operations
  // ===========================================================================

  async createTicket(projectId: string, ticket: CreateTicketInput): Promise<Ticket> {
    return this.ticketStorage.createTicket(projectId, ticket)
  }

  async getTicket(id: string): Promise<Ticket | null> {
    return this.ticketStorage.getTicket(id)
  }

  async getTicketById(id: string): Promise<Ticket | null> {
    return this.ticketStorage.getTicketById(id)
  }

  async updateTicket(id: string, changes: Partial<Ticket>): Promise<Ticket> {
    return this.ticketStorage.updateTicket(id, changes)
  }

  async moveTicket(projectId: string, id: string, column: string, position?: number): Promise<Ticket> {
    return this.ticketStorage.moveTicket(projectId, id, column, position)
  }

  async moveTicketToProject(ticketId: string, newProjectId: string): Promise<Ticket> {
    return this.ticketStorage.moveTicketToProject(ticketId, newProjectId)
  }

  async deleteTicket(id: string): Promise<void> {
    return this.ticketStorage.deleteTicket(id)
  }

  async listTickets(projectId: string | undefined, filter?: TicketFilter): Promise<Ticket[]> {
    return this.ticketStorage.listTickets(projectId, filter)
  }

  // ===========================================================================
  // Subtask Operations
  // ===========================================================================

  async addSubtask(ticketId: string, title: string): Promise<Subtask> {
    return this.subtaskStorage.addSubtask(ticketId, title)
  }

  async toggleSubtask(ticketId: string, subtaskId: string): Promise<Subtask> {
    return this.subtaskStorage.toggleSubtask(ticketId, subtaskId)
  }

  async removeSubtask(ticketId: string, subtaskId: string): Promise<void> {
    return this.subtaskStorage.removeSubtask(ticketId, subtaskId)
  }

  // ===========================================================================
  // Acceptance Criteria Operations
  // ===========================================================================

  async addAcceptanceCriterion(ticketId: string, criterion: string): Promise<AcceptanceCriterion> {
    return this.acceptanceCriteriaStorage.addAcceptanceCriterion(ticketId, criterion)
  }

  async removeAcceptanceCriterion(ticketId: string, criterionId: string): Promise<void> {
    return this.acceptanceCriteriaStorage.removeAcceptanceCriterion(ticketId, criterionId)
  }

  async clearAcceptanceCriteria(ticketId: string): Promise<void> {
    return this.acceptanceCriteriaStorage.clearAcceptanceCriteria(ticketId)
  }

  // ===========================================================================
  // Spec Operations
  // ===========================================================================

  async createSpec(spec: Partial<Spec>): Promise<Spec> {
    return this.specStorage.createSpec(spec)
  }

  async getSpec(id: string): Promise<Spec | null> {
    return this.specStorage.getSpec(id)
  }

  async listSpecs(filter?: SpecFilter): Promise<Spec[]> {
    return this.specStorage.listSpecs(filter)
  }

  async updateSpec(id: string, changes: Partial<Spec>): Promise<Spec> {
    return this.specStorage.updateSpec(id, changes)
  }

  async deleteSpec(id: string): Promise<void> {
    return this.specStorage.deleteSpec(id)
  }

  async linkTicketToSpec(ticketId: string, specId: string): Promise<void> {
    return this.specStorage.linkTicketToSpec(ticketId, specId)
  }

  async unlinkTicketFromSpec(ticketId: string, specId: string): Promise<void> {
    return this.specStorage.unlinkTicketFromSpec(ticketId, specId)
  }

  async getTicketsForSpec(projectId: string, specId: string): Promise<Ticket[]> {
    return this.specStorage.getTicketsForSpec(projectId, specId)
  }

  async getSpecsForTicket(ticketId: string): Promise<Spec[]> {
    return this.specStorage.getSpecsForTicket(ticketId)
  }

  async addSpecDependency(specId: string, dependsOnId: string): Promise<void> {
    return this.specStorage.addSpecDependency(specId, dependsOnId)
  }

  async removeSpecDependency(specId: string, dependsOnId: string): Promise<void> {
    return this.specStorage.removeSpecDependency(specId, dependsOnId)
  }

  async getSpecDependencies(specId: string): Promise<Spec[]> {
    return this.specStorage.getSpecDependencies(specId)
  }

  async getSpecDependents(specId: string): Promise<Spec[]> {
    return this.specStorage.getSpecDependents(specId)
  }

  async linkProjectToSpec(projectId: string, specId: string): Promise<void> {
    return this.specStorage.linkProjectToSpec(projectId, specId)
  }

  async unlinkProjectFromSpec(projectId: string, specId: string): Promise<void> {
    return this.specStorage.unlinkProjectFromSpec(projectId, specId)
  }

  async getSpecsForProject(projectId: string): Promise<Spec[]> {
    return this.specStorage.getSpecsForProject(projectId)
  }

  async getProjectsForSpec(specId: string): Promise<Project[]> {
    return this.specStorage.getProjectsForSpec(specId)
  }

  // ===========================================================================
  // Epic Operations
  // ===========================================================================

  async createEpic(projectId: string, epic: Partial<Epic>): Promise<Epic> {
    return this.epicStorage.createEpic(projectId, epic)
  }

  async getEpic(id: string): Promise<Epic | null> {
    return this.epicStorage.getEpic(id)
  }

  async listEpics(projectId: string, filter?: EpicFilter): Promise<Epic[]> {
    return this.epicStorage.listEpics(projectId, filter)
  }

  async reorderEpic(projectId: string, epicId: string, newPosition: number): Promise<Epic> {
    return this.epicStorage.reorderEpic(projectId, epicId, newPosition)
  }

  async updateEpic(id: string, changes: Partial<Epic>): Promise<Epic> {
    return this.epicStorage.updateEpic(id, changes)
  }

  async deleteEpic(id: string): Promise<void> {
    return this.epicStorage.deleteEpic(id)
  }

  async getTicketsForEpic(projectId: string, epicId: string): Promise<Ticket[]> {
    return this.epicStorage.getTicketsForEpic(projectId, epicId)
  }

  async linkTicketToEpic(ticketId: string, epicId: string): Promise<void> {
    return this.epicStorage.linkTicketToEpic(ticketId, epicId)
  }

  async unlinkTicketFromEpic(ticketId: string): Promise<void> {
    return this.epicStorage.unlinkTicketFromEpic(ticketId)
  }

  // ===========================================================================
  // Dependency Operations
  // ===========================================================================

  async createTicketDependency(
    ticketId: string,
    dependsOnId: string,
    type?: TicketDependencyType
  ): Promise<TicketDependency> {
    return this.dependencyStorage.createTicketDependency(ticketId, dependsOnId, type)
  }

  async deleteTicketDependency(
    ticketId: string,
    dependsOnId: string,
    type?: TicketDependencyType
  ): Promise<void> {
    return this.dependencyStorage.deleteTicketDependency(ticketId, dependsOnId, type)
  }

  async listTicketDependencies(ticketId: string): Promise<TicketDependency[]> {
    return this.dependencyStorage.listTicketDependencies(ticketId)
  }

  async getTicketBlockers(ticketId: string): Promise<Ticket[]> {
    return this.dependencyStorage.getTicketBlockers(ticketId)
  }

  async getTicketsBlockedBy(ticketId: string): Promise<Ticket[]> {
    return this.dependencyStorage.getTicketsBlockedBy(ticketId)
  }

  async isTicketBlocked(ticketId: string): Promise<boolean> {
    return this.dependencyStorage.isTicketBlocked(ticketId)
  }

  async createSpecDependency(
    specId: string,
    dependsOnId: string,
    type?: SpecDependencyType
  ): Promise<SpecDependency> {
    return this.dependencyStorage.createSpecDependency(specId, dependsOnId, type)
  }

  async deleteSpecDependency(
    specId: string,
    dependsOnId: string,
    type?: SpecDependencyType
  ): Promise<void> {
    return this.dependencyStorage.deleteSpecDependency(specId, dependsOnId, type)
  }

  async listSpecDependencies(specId: string): Promise<SpecDependency[]> {
    return this.dependencyStorage.listSpecDependencies(specId)
  }

  async createEpicDependency(
    epicId: string,
    dependsOnId: string,
    type?: EpicDependencyType
  ): Promise<EpicDependency> {
    return this.dependencyStorage.createEpicDependency(epicId, dependsOnId, type)
  }

  async deleteEpicDependency(
    epicId: string,
    dependsOnId: string,
    type?: EpicDependencyType
  ): Promise<void> {
    return this.dependencyStorage.deleteEpicDependency(epicId, dependsOnId, type)
  }

  async listEpicDependencies(epicId: string): Promise<EpicDependency[]> {
    return this.dependencyStorage.listEpicDependencies(epicId)
  }

  async isEpicBlocked(epicId: string): Promise<boolean> {
    return this.dependencyStorage.isEpicBlocked(epicId)
  }

  // ===========================================================================
  // Status Operations
  // ===========================================================================

  async listStatuses(projectId: string): Promise<WorkflowStatus[]> {
    return this.statusStorage.listStatuses(projectId)
  }

  async getStatus(id: string): Promise<WorkflowStatus | null> {
    return this.statusStorage.getStatus(id)
  }

  async createStatus(projectId: string, status: Partial<WorkflowStatus>): Promise<WorkflowStatus> {
    return this.statusStorage.createStatus(projectId, status)
  }

  async updateStatus(id: string, changes: Partial<WorkflowStatus>): Promise<WorkflowStatus> {
    return this.statusStorage.updateStatus(id, changes)
  }

  async deleteStatus(id: string): Promise<void> {
    return this.statusStorage.deleteStatus(id)
  }

  async reorderStatus(id: string, newPosition: number): Promise<WorkflowStatus> {
    return this.statusStorage.reorderStatus(id, newPosition)
  }

  async getDefaultStatus(projectId: string): Promise<WorkflowStatus | null> {
    return this.statusStorage.getDefaultStatus(projectId)
  }

  // ===========================================================================
  // Template Operations
  // ===========================================================================

  async listTemplates(filter?: TemplateFilter): Promise<WorkflowTemplate[]> {
    return this.templateStorage.listTemplates(filter)
  }

  async getTemplate(id: string): Promise<WorkflowTemplate | null> {
    return this.templateStorage.getTemplate(id)
  }

  async applyTemplate(projectId: string, templateId: string): Promise<WorkflowStatus[]> {
    return this.templateStorage.applyTemplate(projectId, templateId)
  }

  async saveTemplate(
    name: string,
    projectId: string,
    description?: string
  ): Promise<WorkflowTemplate> {
    return this.templateStorage.saveTemplate(name, projectId, description)
  }

  async deleteTemplate(id: string): Promise<void> {
    return this.templateStorage.deleteTemplate(id)
  }

  // ===========================================================================
  // Ticket Template Operations
  // ===========================================================================

  async listTicketTemplates(filter?: TicketTemplateFilter): Promise<TicketTemplate[]> {
    return this.templateStorage.listTicketTemplates(filter)
  }

  async getTicketTemplate(id: string): Promise<TicketTemplate | null> {
    return this.templateStorage.getTicketTemplate(id)
  }

  async createTicketTemplate(
    template: Partial<TicketTemplate> & { name: string }
  ): Promise<TicketTemplate> {
    return this.templateStorage.createTicketTemplate(template)
  }

  async createTicketTemplateFromTicket(
    ticketId: string,
    name: string,
    description?: string
  ): Promise<TicketTemplate> {
    return this.templateStorage.createTicketTemplateFromTicket(ticketId, name, description)
  }

  async updateTicketTemplate(
    id: string,
    changes: Partial<TicketTemplate>
  ): Promise<TicketTemplate> {
    return this.templateStorage.updateTicketTemplate(id, changes)
  }

  async deleteTicketTemplate(id: string): Promise<void> {
    return this.templateStorage.deleteTicketTemplate(id)
  }

  // ===========================================================================
  // Phase Operations
  // ===========================================================================

  async listPhases(filter?: PhaseFilter): Promise<ProjectPhase[]> {
    return this.phaseStorage.listPhases(filter)
  }

  async getPhase(id: string): Promise<ProjectPhase | null> {
    return this.phaseStorage.getPhase(id)
  }

  async createPhase(phase: Partial<ProjectPhase>): Promise<ProjectPhase> {
    return this.phaseStorage.createPhase(phase)
  }

  async updatePhase(id: string, changes: Partial<ProjectPhase>): Promise<ProjectPhase> {
    return this.phaseStorage.updatePhase(id, changes)
  }

  async deletePhase(id: string): Promise<void> {
    return this.phaseStorage.deletePhase(id)
  }

  async reorderPhase(id: string, newPosition: number): Promise<ProjectPhase> {
    return this.phaseStorage.reorderPhase(id, newPosition)
  }

  async getDefaultPhase(): Promise<ProjectPhase | null> {
    return this.phaseStorage.getDefaultPhase()
  }

  // ===========================================================================
  // Phase Template Operations
  // ===========================================================================

  async listPhaseTemplates(filter?: PhaseTemplateFilter): Promise<PhaseTemplate[]> {
    return this.phaseStorage.listPhaseTemplates(filter)
  }

  async getPhaseTemplate(id: string): Promise<PhaseTemplate | null> {
    return this.phaseStorage.getPhaseTemplate(id)
  }

  async applyPhaseTemplate(templateId: string): Promise<ProjectPhase[]> {
    return this.phaseStorage.applyPhaseTemplate(templateId)
  }

  async savePhaseTemplate(name: string, description?: string): Promise<PhaseTemplate> {
    return this.phaseStorage.savePhaseTemplate(name, description)
  }

  async updatePhaseTemplate(
    id: string,
    changes: { name?: string; description?: string }
  ): Promise<PhaseTemplate> {
    return this.phaseStorage.updatePhaseTemplate(id, changes)
  }

  async deletePhaseTemplate(id: string): Promise<void> {
    return this.phaseStorage.deletePhaseTemplate(id)
  }

  // ===========================================================================
  // Action Operations
  // ===========================================================================

  async listActions(filter?: WorkActionFilter): Promise<WorkAction[]> {
    return this.actionStorage.listActions(filter)
  }

  async getAction(id: string): Promise<WorkAction | null> {
    return this.actionStorage.getAction(id)
  }

  async createAction(action: Partial<WorkAction>): Promise<WorkAction> {
    return this.actionStorage.createAction(action)
  }

  async updateAction(id: string, changes: Partial<WorkAction>): Promise<WorkAction> {
    return this.actionStorage.updateAction(id, changes)
  }

  async deleteAction(id: string): Promise<void> {
    return this.actionStorage.deleteAction(id)
  }

  async getSuggestedAction(category: StateCategory): Promise<WorkAction | null> {
    return this.actionStorage.getSuggestedAction(category)
  }

  // ===========================================================================
  // Project Operations
  // ===========================================================================

  async createProject(
    project: { id?: string; name: string; template?: string; description?: string }
  ): Promise<Board> {
    return this.projectStorage.createProject(
      project,
      (projectId, templateId) => this.applyTemplate(projectId, templateId),
      (projectId) => this.listStatuses(projectId),
      (id) => this.getTemplate(id)
    )
  }

  async getProjectBoard(projectId: string): Promise<Board | null> {
    return this.projectStorage.getProjectBoard(projectId)
  }

  async listProjectSummaries(): Promise<
    Array<{
      id: string
      name: string
      template: string | null
      description: string | null
      ticketCount: number
    }>
  > {
    return this.projectStorage.listProjectSummaries()
  }

  async deleteProject(projectId: string): Promise<void> {
    return this.projectStorage.deleteProject(projectId)
  }

  async getProject(id: string): Promise<Project | null> {
    return this.projectStorage.getProject(id)
  }

  async updateProject(id: string, changes: Partial<Project>): Promise<Project> {
    return this.projectStorage.updateProject(id, changes)
  }

  async listProjects(filter?: ProjectFilter): Promise<Project[]> {
    return this.projectStorage.listProjects(filter)
  }

  async archiveProject(id: string): Promise<Project> {
    return this.projectStorage.archiveProject(id)
  }

  async unarchiveProject(id: string): Promise<Project> {
    return this.projectStorage.unarchiveProject(id)
  }

  // ===========================================================================
  // Board View Operations
  // ===========================================================================

  async listBoardViews(filter?: BoardViewFilter): Promise<BoardView[]> {
    return this.viewStorage.listBoardViews(filter)
  }

  async getBoardView(id: string): Promise<BoardView | null> {
    return this.viewStorage.getBoardView(id)
  }

  async createBoardView(view: Partial<BoardView>): Promise<BoardView> {
    return this.viewStorage.createBoardView(view)
  }

  async updateBoardView(id: string, changes: Partial<BoardView>): Promise<BoardView> {
    return this.viewStorage.updateBoardView(id, changes)
  }

  async deleteBoardView(id: string): Promise<void> {
    return this.viewStorage.deleteBoardView(id)
  }

  async getDefaultBoardView(projectId: string): Promise<BoardView | null> {
    return this.viewStorage.getDefaultBoardView(projectId)
  }

  async getBoardWithView(projectId: string, viewId?: string, filters?: BoardViewFilters): Promise<Board> {
    return this.viewStorage.getBoardWithView(projectId, viewId, filters)
  }

  // ===========================================================================
  // Sync Operations (no-op for pure SQLite)
  // ===========================================================================

  async pull(): Promise<SyncResult> {
    return { success: true, changes: 0 }
  }

  async push(): Promise<SyncResult> {
    return { success: true, changes: 0 }
  }

  async status(): Promise<SyncStatus> {
    return { ahead: 0, behind: 0, conflicts: false }
  }

  // ===========================================================================
  // Rebuild Operations (for git storage sync)
  // ===========================================================================

  rebuildFromBoard(board: Board): void {
    const projectId = board.id
    const T = PMO_TABLES

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
  // Lifecycle
  // ===========================================================================

  async close(): Promise<void> {
    this.db.close()
  }

  // ===========================================================================
  // Cache Operations (for git storage compatibility)
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

  setCacheMetadata(metadata: { boardMtime: number; cacheBuiltAt: number; contentHash?: string }): void {
    const upsert = this.db.prepare(`
      INSERT OR REPLACE INTO ${T.cache_metadata} (key, value)
      VALUES (?, ?)
    `)
    upsert.run('boardMtime', metadata.boardMtime.toString())
    upsert.run('cacheBuiltAt', metadata.cacheBuiltAt.toString())
    if (metadata.contentHash) {
      upsert.run('contentHash', metadata.contentHash)
    }
  }

  clearCache(): void {
    this.db.prepare(`DELETE FROM ${T.cache_metadata}`).run()
  }
}

// Re-export for backward compatibility
export { SQLiteStorage as default }

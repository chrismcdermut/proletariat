/**
 * SQLite Storage Implementation for PMO
 *
 * This is the main facade that delegates to domain-specific storage modules.
 * Uses the unified workspace.db database with pmo_ prefixed tables.
 *
 * PRLT-1299: Removed dead storage modules (tickets, specs, epics, statuses,
 * subtasks, dependencies) and all methods that delegated to them. The ticket
 * provider (Linear, Jira, etc.) is now the source of truth for those entities.
 * Only project CRUD, actions, workflow rules, and templates remain.
 *
 * This module now supports Drizzle ORM for type-safe queries while maintaining
 * backward compatibility with raw SQL queries during the migration period.
 */

import Database from 'better-sqlite3'
import * as path from 'node:path'
import { createDrizzleConnection, DrizzleDB } from '../../database/drizzle.js'
import { type DatabaseDriver, BetterSqlite3Driver } from '../../database/driver.js'
import { configureConnection } from '../../database/db-safety.js'
import { isReadOnlyHQMount } from '../../container.js'
import {
  Board,
  BoardConfig,
  Project,
  ProjectFilter,
  Ticket,
  TicketFilter,
  CreateTicketInput,
  TicketTemplate,
  TicketTemplateFilter,
  WorkAction,
  WorkActionFilter,
  WorkflowRule,
  WorkflowRuleFilter,
  WorkflowStatus,
  Subtask,
  Spec,
  SpecFilter,
  Epic,
  EpicFilter,
  Workflow,
  WorkflowFilter,
  Column,
  StatusFilter,
  AcceptanceCriterion,
  TicketDependency,
  SyncResult,
  SyncStatus,
  PMOStorage,
  Category,
  CategoryFilter,
  Label,
  LabelFilter,
  LabelGroup,
  LabelGroupFilter,
  BoardView,
  BoardViewFilter,
  Roadmap,
  RoadmapFilter,
  RoadmapProject,
  ProjectPhase,
  PhaseFilter,
  PhaseTemplate,
  PhaseTemplateFilter,
  WorkflowTemplate,
  TemplateFilter,
} from '../types.js'
import { PMO_TABLES, PMO_SCHEMA_SQL } from '../schema.js'
import { StorageContext } from './types.js'
import {
  runMigrations,
  seedBuiltinActions,
  seedBuiltinWorkflowRules,
  seedBuiltinTicketTemplates,
  updateBoardTimestamp,
} from './base.js'
import { ProjectStorage } from './projects.js'
import { TemplateStorage } from './templates.js'
import { ActionStorage } from './actions.js'
import { WorkflowRuleStorage } from './workflow-rules.js'

const T = PMO_TABLES

// PRLT-1299: SQLiteStorage implements PMOStorage for type compatibility.
// Dead entity operations (tickets, specs, epics, statuses, subtasks, dependencies,
// workflows, board, columns, sync) are stubbed out. The ticket provider is the
// source of truth for those entities. Only project CRUD, actions, workflow rules,
// and templates have real implementations.
export class SQLiteStorage implements PMOStorage {
  readonly type = 'sqlite' as const
  private db: Database.Database
  private driver: DatabaseDriver
  private drizzle: DrizzleDB
  private dbPath: string

  // Domain-specific storage modules
  private projectStorage: ProjectStorage
  private templateStorage: TemplateStorage
  private actionStorage: ActionStorage
  private workflowRuleStorage: WorkflowRuleStorage

  constructor(dbPath: string) {
    this.dbPath = dbPath

    // Auto-detect read-only mode for container environments (PRLT-1183).
    // The dbPath lives under .proletariat/ — derive the workspace root (grandparent)
    // and check if it sits on a read-only HQ mount.
    const workspaceRoot = path.dirname(path.dirname(dbPath))
    const readOnly = isReadOnlyHQMount(workspaceRoot)

    // Open database — read-only in container environments to prevent SQLITE_READONLY crashes
    this.db = new Database(dbPath, readOnly ? { readonly: true } : undefined)
    configureConnection(this.db, { readonly: readOnly })

    // Create DatabaseDriver abstraction
    this.driver = new BetterSqlite3Driver(this.db)

    // Create Drizzle ORM connection wrapping the same database
    this.drizzle = createDrizzleConnection(this.db)

    // Create the storage context shared by all modules
    const ctx: StorageContext = {
      db: this.db,
      driver: this.driver,
      drizzle: this.drizzle,
      updateBoardTimestamp: readOnly
        ? () => {} // No-op in read-only mode
        : (projectId: string) => updateBoardTimestamp(this.db, projectId),
    }

    // Initialize domain-specific storage modules
    this.projectStorage = new ProjectStorage(ctx)
    this.templateStorage = new TemplateStorage(ctx)
    this.actionStorage = new ActionStorage(ctx)
    this.workflowRuleStorage = new WorkflowRuleStorage(ctx)

    // Ensure PMO tables exist — skip in read-only mode (tables already exist on HQ)
    if (!readOnly) {
      this.ensurePMOTables()
    }
  }

  /**
   * Get the underlying database connection.
   * @deprecated Prefer getDriver() for new code.
   */
  getDatabase(): Database.Database {
    return this.db
  }

  /**
   * Get the DatabaseDriver abstraction.
   * Preferred over getDatabase() — supports driver swapping.
   */
  getDriver(): DatabaseDriver {
    return this.driver
  }

  /**
   * Get the Drizzle ORM database connection for type-safe queries.
   */
  getDrizzle(): DrizzleDB {
    return this.drizzle
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
    seedBuiltinActions(this.db)
    seedBuiltinWorkflowRules(this.db)
    seedBuiltinTicketTemplates(this.db)
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

  async getSuggestedAction(stateName: string): Promise<WorkAction | null> {
    return this.actionStorage.getSuggestedAction(stateName)
  }

  // ===========================================================================
  // Workflow Rule Operations
  // ===========================================================================

  async listWorkflowRules(filter?: WorkflowRuleFilter): Promise<WorkflowRule[]> {
    return this.workflowRuleStorage.listWorkflowRules(filter)
  }

  async getWorkflowRule(id: string): Promise<WorkflowRule | null> {
    return this.workflowRuleStorage.getWorkflowRule(id)
  }

  async createWorkflowRule(rule: Partial<WorkflowRule>): Promise<WorkflowRule> {
    return this.workflowRuleStorage.createWorkflowRule(rule)
  }

  async updateWorkflowRule(id: string, changes: Partial<WorkflowRule>): Promise<WorkflowRule> {
    return this.workflowRuleStorage.updateWorkflowRule(id, changes)
  }

  async deleteWorkflowRule(id: string): Promise<void> {
    return this.workflowRuleStorage.deleteWorkflowRule(id)
  }

  async getWorkflowRulesForState(toState: string): Promise<WorkflowRule[]> {
    return this.workflowRuleStorage.getWorkflowRulesForState(toState)
  }

  // ===========================================================================
  // Project Operations
  // ===========================================================================

  async createProject(
    project: { id?: string; name: string; template?: string; description?: string }
  ): Promise<Board> {
    // PMOStorage interface expects Board return; cast the Project for compatibility
    return this.projectStorage.createProject(project) as any
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
  // Removed Entity Operations — Stubs for backward compatibility (PRLT-1299)
  //
  // The local ticket/spec/epic/dependency store has been removed. Provider is
  // the source of truth. These stubs prevent compile errors in commands that
  // haven't fully migrated to the provider interface yet.
  // ===========================================================================

  private static readonly REMOVED_MSG = 'Local ticket store removed (PRLT-1299). Use the ticket provider instead.'

  // --- Board Operations ---
  async init(_projectId: string, _config: BoardConfig): Promise<Board> {
    // No-op — already initializes in constructor
    return { id: _projectId, name: '', columns: [], updatedAt: new Date() }
  }
  async getBoard(_projectId: string): Promise<Board> {
    return { id: _projectId, name: '', columns: [], updatedAt: new Date() } as Board
  }
  async getBoardMarkdown(_projectId: string): Promise<string> { return '' }
  async getProjectBoard(_projectId: string): Promise<{ name: string; columns: Array<{ name: string }> } | null> { return null }

  // --- Column Operations ---
  getColumnNames(_projectId: string): string[] { return [] }
  async createColumn(_projectId: string, _name: string, _position?: number): Promise<Column> {
    throw new Error(SQLiteStorage.REMOVED_MSG)
  }
  async renameColumn(_projectId: string, _id: string, _name: string): Promise<Column> {
    throw new Error(SQLiteStorage.REMOVED_MSG)
  }
  async moveColumn(_projectId: string, _id: string, _position: number): Promise<Column> {
    throw new Error(SQLiteStorage.REMOVED_MSG)
  }
  async deleteColumn(_projectId: string, _id: string, _cascade?: boolean): Promise<void> {
    throw new Error(SQLiteStorage.REMOVED_MSG)
  }

  // --- Ticket Operations ---
  async getTicket(_id: string): Promise<Ticket | null> { return null }
  async getTicketById(_id: string): Promise<Ticket | null> { return null }
  async getTicketByExternalKey(_externalKey: string): Promise<Ticket | null> { return null }
  async listTickets(_projectId?: string, _filter?: TicketFilter): Promise<Ticket[]> { return [] }
  async createTicket(_projectId: string, _input: CreateTicketInput): Promise<Ticket> {
    throw new Error(SQLiteStorage.REMOVED_MSG)
  }
  async updateTicket(_id: string, _changes: Partial<Ticket>): Promise<Ticket> {
    throw new Error(SQLiteStorage.REMOVED_MSG)
  }
  async moveTicket(_projectId: string, _ticketId: string, _columnName: string, _position?: number): Promise<Ticket> {
    throw new Error(SQLiteStorage.REMOVED_MSG)
  }
  async moveTicketToProject(_ticketId: string, _newProjectId: string): Promise<Ticket> {
    throw new Error(SQLiteStorage.REMOVED_MSG)
  }
  async reorderTicket(_id: string, _opts: { position?: number; afterTicketId?: string }): Promise<Ticket> {
    throw new Error(SQLiteStorage.REMOVED_MSG)
  }
  async deleteTicket(_id: string): Promise<void> {
    throw new Error(SQLiteStorage.REMOVED_MSG)
  }
  async getTicketBlockers(_ticketId: string): Promise<Ticket[]> { return [] }
  async isTicketBlocked(_ticketId: string): Promise<boolean> { return false }
  async getTicketsForEpic(_projectId: string, _epicId?: string): Promise<Ticket[]> { return [] }
  async getTicketsForSpec(_projectId: string, _specId: string): Promise<Ticket[]> { return [] }
  async getSpecsForTicket(_ticketId: string): Promise<Spec[]> { return [] }

  // --- Subtask Operations ---
  async addSubtask(_ticketId: string, _title: string): Promise<Subtask> {
    throw new Error(SQLiteStorage.REMOVED_MSG)
  }
  async toggleSubtask(_ticketId: string, _subtaskId: string): Promise<Subtask> {
    throw new Error(SQLiteStorage.REMOVED_MSG)
  }
  async removeSubtask(_ticketId: string, _subtaskId: string): Promise<void> {
    throw new Error(SQLiteStorage.REMOVED_MSG)
  }
  async getSubtask(_ticketId: string, _subtaskId: string): Promise<Subtask | null> { return null }
  async listSubtasks(_ticketId: string): Promise<Subtask[]> { return [] }
  async updateSubtask(_ticketId: string, _subtaskId: string, _changes: Partial<Subtask>): Promise<Subtask> {
    throw new Error(SQLiteStorage.REMOVED_MSG)
  }
  async deleteSubtask(_ticketId: string, _subtaskId: string): Promise<void> {}

  // --- Acceptance Criteria Operations ---
  async getAcceptanceCriteria(_ticketId: string): Promise<AcceptanceCriterion[]> { return [] }
  async addAcceptanceCriterion(_ticketId: string, ..._args: any[]): Promise<AcceptanceCriterion> {
    throw new Error(SQLiteStorage.REMOVED_MSG)
  }
  async removeAcceptanceCriterion(_ticketId: string, _criterionId: string): Promise<void> {
    throw new Error(SQLiteStorage.REMOVED_MSG)
  }
  async clearAcceptanceCriteria(_ticketId: string): Promise<void> {
    throw new Error(SQLiteStorage.REMOVED_MSG)
  }

  // --- Ticket Dependency Operations ---
  async createTicketDependency(_ticketId: string, _dependsOnId: string, ..._args: any[]): Promise<void> {
    throw new Error(SQLiteStorage.REMOVED_MSG)
  }
  async deleteTicketDependency(_ticketId: string, _dependsOnId: string, ..._args: any[]): Promise<void> {
    throw new Error(SQLiteStorage.REMOVED_MSG)
  }

  // --- Spec Operations ---
  async createSpec(_spec: Partial<Spec>): Promise<Spec> {
    throw new Error(SQLiteStorage.REMOVED_MSG)
  }
  async getSpec(_id: string): Promise<Spec | null> { return null }
  async listSpecs(_filter?: SpecFilter): Promise<Spec[]> { return [] }
  async updateSpec(_id: string, _changes: Partial<Spec>): Promise<Spec> {
    throw new Error(SQLiteStorage.REMOVED_MSG)
  }
  async deleteSpec(_id: string): Promise<void> {
    throw new Error(SQLiteStorage.REMOVED_MSG)
  }
  async linkTicketToSpec(_ticketId: string, _specId: string): Promise<void> {
    throw new Error(SQLiteStorage.REMOVED_MSG)
  }
  async unlinkTicketFromSpec(_ticketId: string, _specId: string): Promise<void> {
    throw new Error(SQLiteStorage.REMOVED_MSG)
  }
  async addSpecDependency(_specId: string, _dependsOnId: string): Promise<void> {
    throw new Error(SQLiteStorage.REMOVED_MSG)
  }
  async removeSpecDependency(_specId: string, _dependsOnId: string): Promise<void> {
    throw new Error(SQLiteStorage.REMOVED_MSG)
  }
  async getSpecDependencies(_specId: string): Promise<Spec[]> { return [] }
  async getSpecDependents(_specId: string): Promise<Spec[]> { return [] }
  async linkProjectToSpec(_projectId: string, _specId: string): Promise<void> {
    throw new Error(SQLiteStorage.REMOVED_MSG)
  }
  async unlinkProjectFromSpec(_projectId: string, _specId: string): Promise<void> {
    throw new Error(SQLiteStorage.REMOVED_MSG)
  }
  async getSpecsForProject(_projectId: string): Promise<Spec[]> { return [] }
  async getProjectsForSpec(_specId: string): Promise<Project[]> { return [] }

  // --- Epic Operations ---
  async createEpic(_projectId: string, _epic: Partial<Epic>): Promise<Epic> {
    throw new Error(SQLiteStorage.REMOVED_MSG)
  }
  async getEpic(_id: string): Promise<Epic | null> { return null }
  async listEpics(_projectId: string, _filter?: EpicFilter): Promise<Epic[]> { return [] }
  async reorderEpic(_projectId: string, _epicId: string, _newPosition: number): Promise<Epic> {
    throw new Error(SQLiteStorage.REMOVED_MSG)
  }
  async updateEpic(_id: string, _changes: Partial<Epic>): Promise<Epic> {
    throw new Error(SQLiteStorage.REMOVED_MSG)
  }
  async deleteEpic(_id: string): Promise<void> {
    throw new Error(SQLiteStorage.REMOVED_MSG)
  }
  async linkTicketToEpic(_ticketId: string, _epicId: string): Promise<void> {
    throw new Error(SQLiteStorage.REMOVED_MSG)
  }
  async unlinkTicketFromEpic(_ticketId: string): Promise<void> {
    throw new Error(SQLiteStorage.REMOVED_MSG)
  }

  // --- Workflow Operations ---
  async listWorkflows(_filter?: WorkflowFilter): Promise<Workflow[]> { return [] }
  async getWorkflow(_id: string): Promise<Workflow | null> { return null }
  async createWorkflow(_workflow: Partial<Workflow>): Promise<Workflow> {
    throw new Error(SQLiteStorage.REMOVED_MSG)
  }
  async updateWorkflow(_id: string, _changes: Partial<Workflow>): Promise<Workflow> {
    throw new Error(SQLiteStorage.REMOVED_MSG)
  }
  async deleteWorkflow(_id: string): Promise<void> {
    throw new Error(SQLiteStorage.REMOVED_MSG)
  }
  async getProjectWorkflow(_projectId: string): Promise<Workflow | null> { return null }

  // --- Workflow Status Operations ---
  async listStatuses(_workflowId: string): Promise<WorkflowStatus[]> { return [] }
  async getStatus(_id: string): Promise<WorkflowStatus | null> { return null }
  async createStatus(_workflowId: string, _status: Partial<WorkflowStatus>): Promise<WorkflowStatus> {
    throw new Error(SQLiteStorage.REMOVED_MSG)
  }
  async updateStatus(_id: string, _changes: Partial<WorkflowStatus>): Promise<WorkflowStatus> {
    throw new Error(SQLiteStorage.REMOVED_MSG)
  }
  async deleteStatus(_id: string): Promise<void> {
    throw new Error(SQLiteStorage.REMOVED_MSG)
  }
  async reorderStatus(_id: string, _newPosition: number): Promise<WorkflowStatus> {
    throw new Error(SQLiteStorage.REMOVED_MSG)
  }
  async getDefaultStatus(_workflowId: string): Promise<WorkflowStatus | null> { return null }

  // --- Ticket Template (extra interface method) ---
  async createTicketTemplateFromTicket(_ticketId: string, _name: string, _description?: string): Promise<TicketTemplate> {
    throw new Error(SQLiteStorage.REMOVED_MSG)
  }

  // --- Sync Operations ---
  async pull(): Promise<SyncResult> { return { success: true, changes: 0 } }
  async push(): Promise<SyncResult> { return { success: true, changes: 0 } }
  async status(): Promise<SyncStatus> { return { ahead: 0, behind: 0, conflicts: false } }

  // --- Cache/Rebuild (table removed — no-ops) ---
  getCacheMetadata(): any { return null }
  setCacheMetadata(..._args: any[]): void { /* no-op */ }
  async rebuildFromBoard(..._args: any[]): Promise<void> { /* no-op */ }

  // ===========================================================================
  // Settings Operations
  // ===========================================================================

  getSetting(key: string): string | null {
    const row = this.db.prepare(`SELECT value FROM ${T.settings} WHERE key = ?`).get(key) as
      | { value: string }
      | undefined
    return row?.value ?? null
  }

  setSetting(key: string, value: string): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO ${T.settings} (key, value) VALUES (?, ?)
    `).run(key, value)
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  async close(): Promise<void> {
    this.db.close()
  }
}

// Re-export for backward compatibility
export { SQLiteStorage as default }

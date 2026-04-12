/**
 * SQLite Storage Implementation for PMO
 *
 * This is the main facade that delegates to domain-specific storage modules.
 * Uses the unified workspace.db database with pmo_ prefixed tables.
 *
 * Local ticket store, local workflows, and vestigial tables were removed in
 * PRLT-1299. The provider (Linear, Jira, etc.) is now the source of truth
 * for tickets and workflows. This storage layer manages:
 * - Projects (HQ scoping)
 * - Actions (reusable agent prompts)
 * - Workflow rules (state-to-action wiring)
 * - Ticket templates (creation presets)
 * - Settings, labels, categories
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
  Column,
  CreateTicketInput,
  Epic,
  EpicDependency,
  EpicDependencyType,
  EpicFilter,
  PMOStorage,
  Project,
  ProjectFilter,
  Spec,
  SpecDependency,
  SpecDependencyType,
  SpecFilter,
  Subtask,
  SyncResult,
  SyncStatus,
  Ticket,
  TicketDependency,
  TicketDependencyType,
  TicketFilter,
  TicketTemplate,
  TicketTemplateFilter,
  WorkAction,
  WorkActionFilter,
  Workflow,
  WorkflowFilter,
  WorkflowRule,
  WorkflowRuleFilter,
  WorkflowStatus,
  AcceptanceCriterion,
} from '../types.js'
import { PMO_TABLES, PMO_SCHEMA_SQL } from '../schema.js'
import { StorageContext } from './types.js'
import {
  runMigrations,
  seedBuiltinActions,
  seedBuiltinWorkflowRules,
  seedBuiltinTicketTemplates,
} from './base.js'
import { ProjectStorage } from './projects.js'
import { TemplateStorage } from './templates.js'
import { ActionStorage } from './actions.js'
import { WorkflowRuleStorage } from './workflow-rules.js'

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
        : (_projectId: string) => {
            // Board timestamp updates are no longer needed since board views were removed
          },
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
  ): Promise<Board & Project> {
    // PMOStorage interface expects Board return, but boards are dead (PRLT-1299).
    // Return project data cast to satisfy the interface.
    const p = await this.projectStorage.createProject(project)
    return p as unknown as Board & Project
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

  async deleteProject(projectId: string): Promise<void> {
    return this.projectStorage.deleteProject(projectId)
  }

  async archiveProject(id: string): Promise<Project> {
    return this.projectStorage.archiveProject(id)
  }

  async unarchiveProject(id: string): Promise<Project> {
    return this.projectStorage.unarchiveProject(id)
  }

  // ===========================================================================
  // Dead Operations — stubs that satisfy PMOStorage interface
  // Local ticket store, local workflows, specs, epics removed in PRLT-1299.
  // These throw at runtime. Use resolveTicketProvider() or
  // resolveProjectProvider() for ticket/workflow operations.
  // ===========================================================================

  private deadMethod(method: string): never {
    throw new Error(
      `SQLiteStorage.${method}() removed (PRLT-1299). ` +
      `Local ticket/workflow tables no longer exist. ` +
      `Use resolveTicketProvider() or resolveProjectProvider() instead.`
    )
  }

  // Board/Column stubs
  async init(_projectId: string, _config: BoardConfig): Promise<Board> { this.deadMethod('init') }
  async getBoard(_projectId: string): Promise<Board> { this.deadMethod('getBoard') }
  async getBoardMarkdown(_projectId: string): Promise<string> { this.deadMethod('getBoardMarkdown') }
  getColumnNames(_projectId: string): string[] { this.deadMethod('getColumnNames') }
  async createColumn(_projectId: string, _name: string, _position?: number): Promise<Column> { this.deadMethod('createColumn') }
  async renameColumn(_projectId: string, _id: string, _name: string): Promise<Column> { this.deadMethod('renameColumn') }
  async moveColumn(_projectId: string, _id: string, _position: number): Promise<Column> { this.deadMethod('moveColumn') }
  async deleteColumn(_projectId: string, _id: string, _cascade?: boolean): Promise<void> { this.deadMethod('deleteColumn') }

  // Ticket stubs
  async createTicket(_projectId: string, _ticket: CreateTicketInput): Promise<Ticket> { this.deadMethod('createTicket') }
  async getTicket(_id: string): Promise<Ticket | null> { this.deadMethod('getTicket') }
  async getTicketById(_id: string): Promise<Ticket | null> { this.deadMethod('getTicketById') }
  async getTicketByExternalKey(_externalKey: string): Promise<Ticket | null> { this.deadMethod('getTicketByExternalKey') }
  async updateTicket(_id: string, _changes: Partial<Ticket>): Promise<Ticket> { this.deadMethod('updateTicket') }
  async moveTicket(_projectId: string, _id: string, _column: string, _position?: number): Promise<Ticket> { this.deadMethod('moveTicket') }
  async reorderTicket(_id: string, _opts: { position?: number; afterTicketId?: string }): Promise<Ticket> { this.deadMethod('reorderTicket') }
  async moveTicketToProject(_ticketId: string, _newProjectId: string): Promise<Ticket> { this.deadMethod('moveTicketToProject') }
  async deleteTicket(_id: string): Promise<void> { this.deadMethod('deleteTicket') }
  async listTickets(_projectId: string | undefined, _filter?: TicketFilter): Promise<Ticket[]> { this.deadMethod('listTickets') }

  // Subtask stubs
  async addSubtask(_ticketId: string, _title: string): Promise<Subtask> { this.deadMethod('addSubtask') }
  async toggleSubtask(_ticketId: string, _subtaskId: string): Promise<Subtask> { this.deadMethod('toggleSubtask') }
  async removeSubtask(_ticketId: string, _subtaskId: string): Promise<void> { this.deadMethod('removeSubtask') }

  // Acceptance criteria stubs
  async addAcceptanceCriterion(_ticketId: string, _criterion: string): Promise<AcceptanceCriterion> { this.deadMethod('addAcceptanceCriterion') }
  async removeAcceptanceCriterion(_ticketId: string, _criterionId: string): Promise<void> { this.deadMethod('removeAcceptanceCriterion') }
  async clearAcceptanceCriteria(_ticketId: string): Promise<void> { this.deadMethod('clearAcceptanceCriteria') }

  // Spec stubs
  async createSpec(_spec: Partial<Spec>): Promise<Spec> { this.deadMethod('createSpec') }
  async getSpec(_id: string): Promise<Spec | null> { this.deadMethod('getSpec') }
  async listSpecs(_filter?: SpecFilter): Promise<Spec[]> { this.deadMethod('listSpecs') }
  async updateSpec(_id: string, _changes: Partial<Spec>): Promise<Spec> { this.deadMethod('updateSpec') }
  async deleteSpec(_id: string): Promise<void> { this.deadMethod('deleteSpec') }
  async linkTicketToSpec(_ticketId: string, _specId: string): Promise<void> { this.deadMethod('linkTicketToSpec') }
  async unlinkTicketFromSpec(_ticketId: string, _specId: string): Promise<void> { this.deadMethod('unlinkTicketFromSpec') }
  async getTicketsForSpec(_projectId: string, _specId: string): Promise<Ticket[]> { this.deadMethod('getTicketsForSpec') }
  async getSpecsForTicket(_ticketId: string): Promise<Spec[]> { this.deadMethod('getSpecsForTicket') }
  async addSpecDependency(_specId: string, _dependsOnId: string): Promise<void> { this.deadMethod('addSpecDependency') }
  async removeSpecDependency(_specId: string, _dependsOnId: string): Promise<void> { this.deadMethod('removeSpecDependency') }
  async getSpecDependencies(_specId: string): Promise<Spec[]> { this.deadMethod('getSpecDependencies') }
  async getSpecDependents(_specId: string): Promise<Spec[]> { this.deadMethod('getSpecDependents') }
  async linkProjectToSpec(_projectId: string, _specId: string): Promise<void> { this.deadMethod('linkProjectToSpec') }
  async unlinkProjectFromSpec(_projectId: string, _specId: string): Promise<void> { this.deadMethod('unlinkProjectFromSpec') }
  async getSpecsForProject(_projectId: string): Promise<Spec[]> { this.deadMethod('getSpecsForProject') }
  async getProjectsForSpec(_specId: string): Promise<Project[]> { this.deadMethod('getProjectsForSpec') }

  // Epic stubs
  async createEpic(_projectId: string, _epic: Partial<Epic>): Promise<Epic> { this.deadMethod('createEpic') }
  async getEpic(_id: string): Promise<Epic | null> { this.deadMethod('getEpic') }
  async listEpics(_projectId: string, _filter?: EpicFilter): Promise<Epic[]> { this.deadMethod('listEpics') }
  async reorderEpic(_projectId: string, _epicId: string, _newPosition: number): Promise<Epic> { this.deadMethod('reorderEpic') }
  async updateEpic(_id: string, _changes: Partial<Epic>): Promise<Epic> { this.deadMethod('updateEpic') }
  async deleteEpic(_id: string): Promise<void> { this.deadMethod('deleteEpic') }
  async getTicketsForEpic(_projectId: string, _epicId: string): Promise<Ticket[]> { this.deadMethod('getTicketsForEpic') }
  async linkTicketToEpic(_ticketId: string, _epicId: string): Promise<void> { this.deadMethod('linkTicketToEpic') }
  async unlinkTicketFromEpic(_ticketId: string): Promise<void> { this.deadMethod('unlinkTicketFromEpic') }

  // Dependency stubs
  async createTicketDependency(_ticketId: string, _dependsOnId: string, _type?: TicketDependencyType): Promise<TicketDependency> { this.deadMethod('createTicketDependency') }
  async deleteTicketDependency(_ticketId: string, _dependsOnId: string, _type?: TicketDependencyType): Promise<void> { this.deadMethod('deleteTicketDependency') }
  async listTicketDependencies(_ticketId: string): Promise<TicketDependency[]> { this.deadMethod('listTicketDependencies') }
  async getTicketBlockers(_ticketId: string): Promise<Ticket[]> { this.deadMethod('getTicketBlockers') }
  async getTicketsBlockedBy(_ticketId: string): Promise<Ticket[]> { this.deadMethod('getTicketsBlockedBy') }
  async isTicketBlocked(_ticketId: string): Promise<boolean> { this.deadMethod('isTicketBlocked') }
  async createSpecDependency(_specId: string, _dependsOnId: string, _type?: SpecDependencyType): Promise<SpecDependency> { this.deadMethod('createSpecDependency') }
  async deleteSpecDependency(_specId: string, _dependsOnId: string, _type?: SpecDependencyType): Promise<void> { this.deadMethod('deleteSpecDependency') }
  async listSpecDependencies(_specId: string): Promise<SpecDependency[]> { this.deadMethod('listSpecDependencies') }
  async createEpicDependency(_epicId: string, _dependsOnId: string, _type?: EpicDependencyType): Promise<EpicDependency> { this.deadMethod('createEpicDependency') }
  async deleteEpicDependency(_epicId: string, _dependsOnId: string, _type?: EpicDependencyType): Promise<void> { this.deadMethod('deleteEpicDependency') }
  async listEpicDependencies(_epicId: string): Promise<EpicDependency[]> { this.deadMethod('listEpicDependencies') }
  async isEpicBlocked(_epicId: string): Promise<boolean> { this.deadMethod('isEpicBlocked') }

  // Workflow/Status stubs
  async listWorkflows(_filter?: WorkflowFilter): Promise<Workflow[]> { this.deadMethod('listWorkflows') }
  async getWorkflow(_id: string): Promise<Workflow | null> { this.deadMethod('getWorkflow') }
  async createWorkflow(_workflow: Partial<Workflow>): Promise<Workflow> { this.deadMethod('createWorkflow') }
  async updateWorkflow(_id: string, _changes: Partial<Workflow>): Promise<Workflow> { this.deadMethod('updateWorkflow') }
  async deleteWorkflow(_id: string): Promise<void> { this.deadMethod('deleteWorkflow') }
  async getProjectWorkflow(_projectId: string): Promise<Workflow | null> { this.deadMethod('getProjectWorkflow') }
  async listStatuses(_workflowId: string): Promise<WorkflowStatus[]> { this.deadMethod('listStatuses') }
  async getStatus(_id: string): Promise<WorkflowStatus | null> { this.deadMethod('getStatus') }
  async createStatus(_workflowId: string, _status: Partial<WorkflowStatus>): Promise<WorkflowStatus> { this.deadMethod('createStatus') }
  async updateStatus(_id: string, _changes: Partial<WorkflowStatus>): Promise<WorkflowStatus> { this.deadMethod('updateStatus') }
  async deleteStatus(_id: string): Promise<void> { this.deadMethod('deleteStatus') }
  async reorderStatus(_id: string, _newPosition: number): Promise<WorkflowStatus> { this.deadMethod('reorderStatus') }
  async getDefaultStatus(_workflowId: string): Promise<WorkflowStatus | null> { this.deadMethod('getDefaultStatus') }

  // Project stubs for removed methods
  async getProjectBoard(_projectId: string): Promise<Board | null> { this.deadMethod('getProjectBoard') }
  async listProjectSummaries(): Promise<Array<{ id: string; name: string; template: string | null; description: string | null; ticketCount: number }>> { this.deadMethod('listProjectSummaries') }

  // Ticket template stub for removed method
  async createTicketTemplateFromTicket(_ticketId: string, _name: string, _description?: string): Promise<TicketTemplate> { this.deadMethod('createTicketTemplateFromTicket') }

  // Sync stubs
  async pull(): Promise<SyncResult> { return { success: true, changes: 0 } }
  async push(): Promise<SyncResult> { return { success: true, changes: 0 } }
  async status(): Promise<SyncStatus> { return { ahead: 0, behind: 0, conflicts: false } }

  // Cache stubs (dead tables)
  getCacheMetadata(): null { return null }
  setCacheMetadata(_metadata: { boardMtime: number; cacheBuiltAt: number; contentHash?: string }): void { /* no-op */ }
  clearCache(): void { /* no-op */ }

  // Board rebuild stub
  rebuildFromBoard(_board: Board): void { this.deadMethod('rebuildFromBoard') }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  async close(): Promise<void> {
    this.db.close()
  }
}

// Re-export for backward compatibility
export { SQLiteStorage as default }

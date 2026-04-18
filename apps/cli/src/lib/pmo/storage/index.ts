/**
 * SQLite Storage Implementation for PMO
 *
 * Slimmed down after PRLT-1299: dead local ticket store, local workflows,
 * and vestigial tables removed. Provider (Linear/Jira) is the source of truth
 * for tickets, workflows, and board state.
 *
 * Remaining responsibilities:
 * - Project metadata
 * - Work actions and workflow rules
 * - Ticket templates
 * - Settings
 * - External issue/execution mapping
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as url from 'node:url'
import Database from 'better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { createDrizzleConnection, DrizzleDB } from '../../database/drizzle.js'
import { type DatabaseDriver, BetterSqlite3Driver } from '../../database/driver.js'
import { configureConnection } from '../../database/db-safety.js'
import { isReadOnlyHQMount } from '../../container.js'
import {
  Board,
  BoardConfig,
  CreateTicketInput,
  Epic,
  EpicFilter,
  Project,
  ProjectFilter,
  Subtask,
  Ticket,
  TicketFilter,
  WorkAction,
  WorkActionFilter,
  Workflow,
  WorkflowRule,
  WorkflowRuleFilter,
  WorkflowStatus,
  TicketTemplate,
  TicketTemplateFilter,
} from '../types.js'
import { PMO_SCHEMA_SQL } from '../schema.js'
import { StorageContext } from './types.js'
import {
  runMigrations,
  seedBuiltinActions,
  seedBuiltinWorkflowRules,
  seedBuiltinTicketTemplates,
  seedDefaultPriorities,
} from './base.js'
import { ProjectStorage } from './projects.js'
import { TemplateStorage } from './templates.js'
import { ActionStorage } from './actions.js'
import { WorkflowRuleStorage } from './workflow-rules.js'

export class SQLiteStorage {
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

    // Open database — read-only in container environments
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
      updateBoardTimestamp: () => {}, // No-op — board timestamps removed with dead tables
    }

    // Initialize domain-specific storage modules
    this.projectStorage = new ProjectStorage(ctx)
    this.templateStorage = new TemplateStorage(ctx)
    this.actionStorage = new ActionStorage(ctx)
    this.workflowRuleStorage = new WorkflowRuleStorage(ctx)

    // Ensure PMO tables exist — skip in read-only mode
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
   * Resolve the path to the Drizzle Kit migration files.
   */
  private getDrizzleMigrationsPath(): string {
    const thisDir = path.dirname(url.fileURLToPath(import.meta.url))
    // Navigate from src/lib/pmo/storage/ → apps/cli/drizzle/
    return path.resolve(thisDir, '..', '..', '..', '..', 'drizzle')
  }

  /**
   * Ensure PMO tables exist in the database.
   * Uses Drizzle Kit migrations for table creation (PRLT-1302),
   * with fallback to legacy PMO_SCHEMA_SQL for environments
   * where migration files are unavailable (e.g., tests).
   */
  private ensurePMOTables(): void {
    // Try Drizzle Kit migrations first
    const migrationsPath = this.getDrizzleMigrationsPath()
    let tablesCreated = false

    if (fs.existsSync(migrationsPath)) {
      try {
        migrate(this.drizzle, { migrationsFolder: migrationsPath })
        tablesCreated = true
      } catch {
        // Fall through to legacy schema creation
      }
    }

    if (!tablesCreated) {
      // Fallback: use legacy PMO_SCHEMA_SQL (CREATE TABLE IF NOT EXISTS)
      this.db.exec(PMO_SCHEMA_SQL)
    }

    // Legacy DDL migrations for column additions (ALTER TABLE)
    runMigrations(this.db)

    // Seed built-in data using Drizzle ORM (PRLT-1302)
    seedBuiltinActions(this.drizzle)
    seedBuiltinWorkflowRules(this.drizzle)
    seedBuiltinTicketTemplates(this.drizzle)
    seedDefaultPriorities(this.drizzle)
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

  async updateBuiltinAction(id: string, changes: Record<string, unknown>): Promise<WorkAction> {
    return this.actionStorage.updateBuiltinAction(id, changes)
  }

  async getSuggestedAction(stateName: string): Promise<WorkAction | null> {
    return this.actionStorage.getSuggestedAction(stateName)
  }

  async getActionByFromIntent(intent: string): Promise<WorkAction | null> {
    return this.actionStorage.getActionByFromIntent(intent)
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

  async getWorkflowRulesForIntent(toIntent: string): Promise<WorkflowRule[]> {
    return this.workflowRuleStorage.getWorkflowRulesForIntent(toIntent)
  }

  async getWorkflowRulesForState(toState: string): Promise<WorkflowRule[]> {
    return this.workflowRuleStorage.getWorkflowRulesForState(toState)
  }

  // ===========================================================================
  // Project Operations
  // ===========================================================================

  async getProject(id: string): Promise<Project | null> {
    return this.projectStorage.getProject(id)
  }

  async updateProject(id: string, changes: Partial<Project>): Promise<Project> {
    return this.projectStorage.updateProject(id, changes)
  }

  async listProjects(filter?: ProjectFilter): Promise<Project[]> {
    return this.projectStorage.listProjects(filter)
  }

  async createProject(
    project: Partial<Project> & { template?: string }
  ): Promise<Board> {
    return this.projectStorage.createProject({
      id: project.id,
      name: project.name || 'Untitled Project',
      template: project.template,
      description: project.description,
    })
  }

  async init(projectId: string, config: BoardConfig): Promise<Board> {
    return this.projectStorage.init(projectId, config)
  }

  // ===========================================================================
  // PRLT-1299/1319 — Dead local ticket/workflow/board operations
  //
  // These methods used to live on SQLiteStorage when it managed local tickets,
  // workflows, epics, specs, columns, and board state. Those tables have been
  // removed; the provider (Linear, Jira, etc.) is now the source of truth.
  //
  // Methods that currently have live callers are kept here as thin runtime
  // stubs so the code compiles while callers are migrated to the provider
  // layer. Methods with no remaining callers are fully deleted — attempting to
  // call them now produces a compile error, which is the whole point.
  // ===========================================================================

  /* eslint-disable proletariat/no-stub-functions -- Legacy stubs with live callers being migrated (PRLT-1319). */

  private deadMethod(name: string): never {
    throw new Error(
      `SQLiteStorage.${name}() removed (PRLT-1299). ` +
      `Local ticket store is dead. Use resolveTicketProvider() instead.`
    )
  }

  // --- Board / Column stubs (still have callers) ---

  async getBoard(_projectId: string): Promise<Board> { this.deadMethod('getBoard') }
  async getBoardMarkdown(_projectId: string): Promise<string> { this.deadMethod('getBoardMarkdown') }
  getColumnNames(_projectId: string): string[] { this.deadMethod('getColumnNames') }
  async getProjectBoard(_projectId: string): Promise<Board | null> { this.deadMethod('getProjectBoard') }

  // --- Ticket stubs (still have callers) ---

  async createTicket(_projectId: string, _ticket: CreateTicketInput): Promise<Ticket> { this.deadMethod('createTicket') }
  async getTicket(_id: string): Promise<Ticket | null> { this.deadMethod('getTicket') }
  async updateTicket(_id: string, _changes: Partial<Ticket>): Promise<Ticket> { this.deadMethod('updateTicket') }
  async moveTicket(_projectId: string, _id: string, _column: string, _position?: number): Promise<Ticket> { this.deadMethod('moveTicket') }
  async reorderTicket(_id: string, _opts: { position?: number; afterTicketId?: string }): Promise<Ticket> { this.deadMethod('reorderTicket') }
  async moveTicketToProject(_ticketId: string, _newProjectId: string): Promise<Ticket> { this.deadMethod('moveTicketToProject') }
  async deleteTicket(_id: string): Promise<void> { this.deadMethod('deleteTicket') }
  async listTickets(_projectId: string | undefined, _filter?: TicketFilter): Promise<Ticket[]> { this.deadMethod('listTickets') }
  async isTicketBlocked(_ticketId: string): Promise<boolean> { this.deadMethod('isTicketBlocked') }

  // --- Subtask stubs (still have callers in MCP tools) ---

  async addSubtask(_ticketId: string, _title: string): Promise<Subtask> { this.deadMethod('addSubtask') }
  async toggleSubtask(_ticketId: string, _subtaskId: string): Promise<Subtask> { this.deadMethod('toggleSubtask') }
  async removeSubtask(_ticketId: string, _subtaskId: string): Promise<void> { this.deadMethod('removeSubtask') }

  // --- Acceptance Criteria stubs (still have callers in MCP tools) ---

  async addAcceptanceCriterion(_ticketId: string, _criterion: string): Promise<{ id: string; criterion: string; met: boolean }> { this.deadMethod('addAcceptanceCriterion') }
  async removeAcceptanceCriterion(_ticketId: string, _criterionId: string): Promise<void> { this.deadMethod('removeAcceptanceCriterion') }
  async clearAcceptanceCriteria(_ticketId: string): Promise<void> { this.deadMethod('clearAcceptanceCriteria') }

  // --- Dependency stubs (still have callers in MCP tools) ---

  async createTicketDependency(_ticketId: string, _blockerId: string, _type: string): Promise<void> { this.deadMethod('createTicketDependency') }
  async deleteTicketDependency(_ticketId: string, _blockerId: string, _type: string): Promise<void> { this.deadMethod('deleteTicketDependency') }
  async getTicketBlockers(_ticketId: string): Promise<Ticket[]> { this.deadMethod('getTicketBlockers') }

  // --- Epic stubs (still have callers) ---

  async linkTicketToEpic(_ticketId: string, _epicId: string): Promise<void> { this.deadMethod('linkTicketToEpic') }
  async unlinkTicketFromEpic(_ticketId: string): Promise<void> { this.deadMethod('unlinkTicketFromEpic') }
  async linkTicketToSpec(_ticketId: string, _specId: string): Promise<void> { this.deadMethod('linkTicketToSpec') }
  async getEpic(_id: string): Promise<Epic | null> { this.deadMethod('getEpic') }
  async listEpics(_projectId: string, _filter?: EpicFilter): Promise<Epic[]> { this.deadMethod('listEpics') }
  async getTicketsForEpic(_projectId: string, _epicId: string): Promise<Ticket[]> { this.deadMethod('getTicketsForEpic') }

  // --- Workflow stubs (still have callers in spawn/pull/linear import) ---

  async getProjectWorkflow(_projectId: string): Promise<Workflow | null> { this.deadMethod('getProjectWorkflow') }
  async listStatuses(_workflowId: string): Promise<WorkflowStatus[]> { this.deadMethod('listStatuses') }

  /* eslint-enable proletariat/no-stub-functions */

  // --- Project ops ---

  async archiveProject(id: string): Promise<Project> {
    return this.projectStorage.archiveProject(id)
  }

  async unarchiveProject(id: string): Promise<Project> {
    return this.projectStorage.unarchiveProject(id)
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
  // Lifecycle
  // ===========================================================================

  async close(): Promise<void> {
    this.db.close()
  }
}

// Re-export for backward compatibility
export { SQLiteStorage as default }

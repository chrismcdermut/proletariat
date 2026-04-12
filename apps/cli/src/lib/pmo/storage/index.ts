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
  Project,
  ProjectFilter,
  TicketTemplate,
  TicketTemplateFilter,
  WorkAction,
  WorkActionFilter,
  WorkflowRule,
  WorkflowRuleFilter,
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
  ): Promise<Project> {
    return this.projectStorage.createProject(project)
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
  // Lifecycle
  // ===========================================================================

  async close(): Promise<void> {
    this.db.close()
  }
}

// Re-export for backward compatibility
export { SQLiteStorage as default }

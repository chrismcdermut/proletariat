/**
 * SQLite Storage Implementation for PMO
 *
 * This is the main facade that delegates to domain-specific storage modules.
 * Uses the unified workspace.db database with pmo_ prefixed tables.
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
  AcceptanceCriterion,
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
  WorkflowRule,
  WorkflowRuleFilter,
  Workflow,
  WorkflowFilter,
  WorkflowStatus,
} from '../types.js'
import { PMO_TABLES, PMO_SCHEMA_SQL, validateTicketSchema } from '../schema.js'
import { StorageContext } from './types.js'
import {
  runMigrations,
  seedBuiltinWorkflows,
  seedBuiltinActions,
  seedBuiltinWorkflowRules,
  seedBuiltinTicketTemplates,
  updateBoardTimestamp,
} from './base.js'
import { ProjectStorage } from './projects.js'
import { TicketStorage } from './tickets.js'
import { SubtaskStorage, AcceptanceCriteriaStorage } from './subtasks.js'
import { SpecStorage } from './specs.js'
import { EpicStorage } from './epics.js'
import { DependencyStorage } from './dependencies.js'
import { StatusStorage } from './statuses.js'
import { TemplateStorage } from './templates.js'
import { ActionStorage } from './actions.js'
import { WorkflowRuleStorage } from './workflow-rules.js'

const T = PMO_TABLES

export class SQLiteStorage implements PMOStorage {
  readonly type = 'sqlite' as const
  private db: Database.Database
  private driver: DatabaseDriver
  private drizzle: DrizzleDB
  private dbPath: string

  // Domain-specific storage modules
  private projectStorage: ProjectStorage
  private ticketStorage: TicketStorage
  private subtaskStorage: SubtaskStorage
  private acceptanceCriteriaStorage: AcceptanceCriteriaStorage
  private specStorage: SpecStorage
  private epicStorage: EpicStorage
  private dependencyStorage: DependencyStorage
  private statusStorage: StatusStorage
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
    this.ticketStorage = new TicketStorage(ctx)
    this.subtaskStorage = new SubtaskStorage(ctx)
    this.acceptanceCriteriaStorage = new AcceptanceCriteriaStorage(ctx)
    this.specStorage = new SpecStorage(ctx)
    this.epicStorage = new EpicStorage(ctx)
    this.dependencyStorage = new DependencyStorage(ctx)
    this.statusStorage = new StatusStorage(ctx)
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

    // Seed built-in data (workflows are the source of truth for status configurations)
    seedBuiltinWorkflows(this.db)
    seedBuiltinActions(this.db)
    seedBuiltinWorkflowRules(this.db)
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
  // Column Operations (columns are now workflow statuses)
  // ===========================================================================

  getColumnNames(projectId: string): string[] {
    // Get project's workflow
    const project = this.db.prepare(`
      SELECT workflow_id FROM ${T.projects} WHERE id = ?
    `).get(projectId) as { workflow_id: string | null } | undefined

    const workflowId = project?.workflow_id || 'default'

    const rows = this.db.prepare(`
      SELECT name FROM ${T.workflow_statuses}
      WHERE workflow_id = ?
      ORDER BY position
    `).all(workflowId) as Array<{ name: string }>
    return rows.map((r) => r.name)
  }

  async createColumn(projectId: string, name: string, position?: number): Promise<Column> {
    // Get project's workflow
    const project = this.db.prepare(`
      SELECT workflow_id FROM ${T.projects} WHERE id = ?
    `).get(projectId) as { workflow_id: string | null } | undefined

    const workflowId = project?.workflow_id || 'default'

    // Create a status in the workflow
    const status = await this.statusStorage.createStatus(workflowId, {
      name,
      category: 'unstarted', // Default category for manually created columns
      position,
    })

    return {
      id: status.id,
      name: status.name,
      position: status.position,
      tickets: [],
    }
  }

  async renameColumn(projectId: string, id: string, name: string): Promise<Column> {
    const status = await this.statusStorage.updateStatus(id, { name })
    return {
      id: status.id,
      name: status.name,
      position: status.position,
      tickets: [],
    }
  }

  async moveColumn(projectId: string, id: string, position: number): Promise<Column> {
    const status = await this.statusStorage.reorderStatus(id, position)
    return {
      id: status.id,
      name: status.name,
      position: status.position,
      tickets: [],
    }
  }

  async deleteColumn(projectId: string, id: string, _cascade?: boolean): Promise<void> {
    return this.statusStorage.deleteStatus(id)
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

  async getTicketByExternalKey(externalKey: string): Promise<Ticket | null> {
    return this.ticketStorage.getTicketByExternalKey(externalKey)
  }

  async updateTicket(id: string, changes: Partial<Ticket>): Promise<Ticket> {
    return this.ticketStorage.updateTicket(id, changes)
  }

  async moveTicket(projectId: string, id: string, column: string, position?: number): Promise<Ticket> {
    return this.ticketStorage.moveTicket(projectId, id, column, position)
  }

  async reorderTicket(id: string, opts: { position?: number; afterTicketId?: string }): Promise<Ticket> {
    return this.ticketStorage.reorderTicket(id, opts)
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
  // Workflow Operations
  // ===========================================================================

  async listWorkflows(filter?: WorkflowFilter): Promise<Workflow[]> {
    return this.statusStorage.listWorkflows(filter)
  }

  async getWorkflow(id: string): Promise<Workflow | null> {
    return this.statusStorage.getWorkflow(id)
  }

  async createWorkflow(workflow: Partial<Workflow>): Promise<Workflow> {
    return this.statusStorage.createWorkflow(workflow)
  }

  async updateWorkflow(id: string, changes: Partial<Workflow>): Promise<Workflow> {
    return this.statusStorage.updateWorkflow(id, changes)
  }

  async deleteWorkflow(id: string): Promise<void> {
    return this.statusStorage.deleteWorkflow(id)
  }

  async getProjectWorkflow(projectId: string): Promise<Workflow | null> {
    return this.statusStorage.getProjectWorkflow(projectId)
  }

  // ===========================================================================
  // Workflow Status Operations
  // ===========================================================================

  async listStatuses(workflowId: string): Promise<WorkflowStatus[]> {
    return this.statusStorage.listStatuses(workflowId)
  }

  async getStatus(id: string): Promise<WorkflowStatus | null> {
    return this.statusStorage.getStatus(id)
  }

  async createStatus(workflowId: string, status: Partial<WorkflowStatus>): Promise<WorkflowStatus> {
    return this.statusStorage.createStatus(workflowId, status)
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

  async getDefaultStatus(workflowId: string): Promise<WorkflowStatus | null> {
    return this.statusStorage.getDefaultStatus(workflowId)
  }

  // ===========================================================================
  // Ticket Template Operations
  // ===========================================================================
  // Note: Workflow templates have been removed. Use workflow commands directly
  // (prlt workflow list, prlt workflow create, prlt workflow switch)

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

  async getWorkflowRulesForIntent(toIntent: string): Promise<WorkflowRule[]> {
    return this.workflowRuleStorage.getWorkflowRulesForIntent(toIntent)
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
    return this.projectStorage.createProject(project)
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

    // Clear existing tickets for current project
    this.db.prepare(`DELETE FROM ${T.tickets} WHERE project_id = ?`).run(projectId)

    const now = Date.now()
    const nowIso = new Date(now).toISOString()

    // Get or create project and its workflow
    const existingProject = this.db.prepare(`
      SELECT name, workflow_id FROM ${T.projects} WHERE id = ?
    `).get(projectId) as { name: string; workflow_id: string | null } | undefined

    const projectName = (board.name === 'Board' && existingProject?.name) ? existingProject.name : board.name
    let workflowId = existingProject?.workflow_id

    // If no workflow, create a project-specific one
    if (!workflowId) {
      workflowId = `workflow-${projectId}`
      this.db.prepare(`
        INSERT OR IGNORE INTO ${T.workflows} (id, name, description, is_builtin, created_at, updated_at)
        VALUES (?, ?, ?, 0, ?, ?)
      `).run(workflowId, `${projectName} Workflow`, `Workflow for ${projectName}`, nowIso, nowIso)
    }

    // Update or insert project with workflow
    this.db.prepare(`
      INSERT OR REPLACE INTO ${T.projects} (id, name, workflow_id, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(projectId, projectName, workflowId, now)

    // Create a map of column name to status id
    const statusMap = new Map<string, string>()

    // Clear existing statuses for this workflow (only if not builtin)
    const workflow = this.db.prepare(`SELECT is_builtin FROM ${T.workflows} WHERE id = ?`).get(workflowId) as { is_builtin: number } | undefined
    if (workflow && !workflow.is_builtin) {
      this.db.prepare(`DELETE FROM ${T.workflow_statuses} WHERE workflow_id = ?`).run(workflowId)
    }

    // Create statuses from board columns (if workflow is not builtin)
    if (!workflow?.is_builtin) {
      const insertStatus = this.db.prepare(`
        INSERT OR REPLACE INTO ${T.workflow_statuses} (id, workflow_id, name, category, position, is_default, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)

      for (const column of board.columns) {
        const statusId = `${workflowId}-${column.id}`
        // Infer category from column name or position
        const category = this.inferCategoryFromColumnName(column.name, column.position, board.columns.length)
        const isDefault = column.position === 0 ? 1 : 0
        insertStatus.run(statusId, workflowId, column.name, category, column.position, isDefault, nowIso)
        statusMap.set(column.name, statusId)
      }
    } else {
      // For builtin workflows, map column names to existing statuses
      const statuses = this.db.prepare(`
        SELECT id, name FROM ${T.workflow_statuses} WHERE workflow_id = ? ORDER BY position
      `).all(workflowId) as Array<{ id: string; name: string }>
      for (const status of statuses) {
        statusMap.set(status.name, status.id)
      }
    }

    // Insert tickets
    const insertTicket = this.db.prepare(`
      INSERT INTO ${T.tickets} (
        id, project_id, title, description, priority, category,
        status_id, owner, assignee, spec_id,
        created_at, updated_at, last_synced_from_spec, last_synced_from_board
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      const statusId = statusMap.get(column.name)

      for (const ticket of column.tickets) {
        // Insert ticket data with status_id
        insertTicket.run(
          ticket.id,
          projectId,
          ticket.title,
          ticket.description || null,
          ticket.priority || null,
          ticket.category || null,
          statusId || null,
          ticket.owner || null,
          ticket.assignee || null,
          ticket.specId || null,
          ticket.createdAt.toISOString(),
          ticket.updatedAt.toISOString(),
          ticket.lastSyncedFromSpec || null,
          ticket.lastSyncedFromBoard || null
        )

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

  /**
   * Infer a status category from column name or position.
   */
  private inferCategoryFromColumnName(name: string, position: number, totalColumns: number): string {
    const lowerName = name.toLowerCase()

    // Match common column names to categories
    if (lowerName.includes('backlog') || lowerName.includes('icebox')) return 'backlog'
    if (lowerName.includes('ready') || lowerName.includes('todo') || lowerName.includes('to do')) return 'unstarted'
    if (lowerName.includes('progress') || lowerName.includes('doing') || lowerName.includes('review')) return 'started'
    if (lowerName.includes('done') || lowerName.includes('complete') || lowerName.includes('finished')) return 'completed'
    if (lowerName.includes('cancel') || lowerName.includes('won\'t')) return 'canceled'

    // Fallback: infer from position
    if (position === 0) return 'backlog'
    if (position === totalColumns - 1) return 'completed'
    if (position <= totalColumns / 2) return 'unstarted'
    return 'started'
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

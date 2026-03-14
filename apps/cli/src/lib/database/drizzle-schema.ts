/**
 * Drizzle ORM Schema Definitions
 *
 * This file defines all database tables using Drizzle ORM for type-safe queries.
 * It serves as the single source of truth for the database schema.
 */

import { sqliteTable, text, integer, primaryKey, index, unique } from 'drizzle-orm/sqlite-core'
import { relations, sql } from 'drizzle-orm'

// =============================================================================
// Core Workspace Tables
// =============================================================================

/**
 * Workspace metadata - single row table
 */
export const workspace = sqliteTable('workspace', {
  id: integer('id').primaryKey().$default(() => 1),
  type: text('type', { enum: ['hq', 'workspace'] }).notNull(),
  workspaceName: text('workspace_name').notNull(),
  hasPmo: integer('has_pmo', { mode: 'boolean' }).default(false),
  activeThemeId: text('active_theme_id'),
  createdAt: text('created_at').notNull(),
})

/**
 * Repository management
 */
export const repositories = sqliteTable('repositories', {
  name: text('name').primaryKey(),
  path: text('path').notNull(),
  type: text('type', { enum: ['main', 'dependency'] }).default('main'),
  sourceUrl: text('source_url'),
  action: text('action', { enum: ['clone', 'move', 'link'] }),
  addedAt: text('added_at').notNull(),
})

/**
 * Agent naming themes
 */
export const agentThemes = sqliteTable('agent_themes', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  displayName: text('display_name').notNull(),
  description: text('description'),
  builtin: integer('builtin', { mode: 'boolean' }).default(false),
  createdAt: text('created_at').notNull(),
})

/**
 * Names available within each theme
 */
export const agentThemeNames = sqliteTable('agent_theme_names', {
  themeId: text('theme_id').notNull(),
  name: text('name').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.themeId, table.name] }),
  idxTheme: index('idx_theme_names_theme').on(table.themeId),
}))

/**
 * Agent instances in workspace
 */
export const agents = sqliteTable('agents', {
  name: text('name').primaryKey(),
  type: text('type', { enum: ['persistent', 'ephemeral'] }).notNull().default('persistent'),
  status: text('status', { enum: ['active', 'cleaned'] }).notNull().default('active'),
  baseName: text('base_name'),
  themeId: text('theme_id'),
  worktreePath: text('worktree_path'),
  mountMode: text('mount_mode', { enum: ['worktree', 'clone'] }).notNull().default('worktree'),
  createdAt: text('created_at').notNull(),
  cleanedAt: text('cleaned_at'),
}, (table) => ({
  idxTheme: index('idx_agents_theme').on(table.themeId),
}))

/**
 * Agent-owned worktrees
 */
export const agentWorktrees = sqliteTable('agent_worktrees', {
  agentName: text('agent_name').notNull(),
  repoName: text('repo_name').notNull(),
  worktreePath: text('worktree_path').notNull(),
  branch: text('branch').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.agentName, table.repoName] }),
  idxAgent: index('idx_worktrees_agent').on(table.agentName),
  idxRepo: index('idx_worktrees_repo').on(table.repoName),
}))

/**
 * Workspace-level settings (key-value store)
 */
export const workspaceSettings = sqliteTable('workspace_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

// =============================================================================
// PMO Tables
// =============================================================================

/**
 * Project lifecycle phases (workspace-scoped)
 */
export const pmoPhases = sqliteTable('pmo_phases', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  category: text('category').notNull(),
  position: integer('position').notNull().default(0),
  color: text('color'),
  description: text('description'),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  idxCategory: index('idx_pmo_phases_category').on(table.category),
  idxPosition: index('idx_pmo_phases_position').on(table.category, table.position),
}))

/**
 * Phase templates (preset phase configurations)
 */
export const pmoPhaseTemplates = sqliteTable('pmo_phase_templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description'),
  isBuiltin: integer('is_builtin', { mode: 'boolean' }).notNull().default(false),
  phases: text('phases').notNull(), // JSON array of phase definitions
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
})

/**
 * Shared workflow definitions
 */
export const pmoWorkflows = sqliteTable('pmo_workflows', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description'),
  isBuiltin: integer('is_builtin', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  idxBuiltin: index('idx_pmo_workflows_builtin').on(table.isBuiltin),
}))

/**
 * Workflow statuses (board columns)
 */
export const pmoWorkflowStatuses = sqliteTable('pmo_workflow_statuses', {
  id: text('id').primaryKey(),
  workflowId: text('workflow_id').notNull(),
  name: text('name').notNull(),
  category: text('category').notNull(),
  position: integer('position').notNull().default(0),
  color: text('color'),
  description: text('description'),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  uniqWorkflowName: unique().on(table.workflowId, table.name),
  idxWorkflow: index('idx_pmo_workflow_statuses_workflow').on(table.workflowId),
  idxCategory: index('idx_pmo_workflow_statuses_category').on(table.workflowId, table.category),
  idxPosition: index('idx_pmo_workflow_statuses_position').on(table.workflowId, table.position),
}))

/**
 * Projects
 */
export const pmoProjects = sqliteTable('pmo_projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  template: text('template'),
  description: text('description'),
  status: text('status').notNull().default('active'),
  phaseId: text('phase_id'),
  workflowId: text('workflow_id'),
  isArchived: integer('is_archived', { mode: 'boolean' }).notNull().default(false),
  targetDate: text('target_date'),
  initiativeId: text('initiative_id'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  idxInitiative: index('idx_pmo_projects_initiative').on(table.initiativeId),
  idxStatus: index('idx_pmo_projects_status').on(table.status),
  idxPhase: index('idx_pmo_projects_phase').on(table.phaseId),
  idxWorkflow: index('idx_pmo_projects_workflow').on(table.workflowId),
  idxArchived: index('idx_pmo_projects_archived').on(table.isArchived),
}))

/**
 * Initiatives (high-level groupings)
 */
export const pmoInitiatives = sqliteTable('pmo_initiatives', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  objective: text('objective'),
  keyResults: text('key_results'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
})

/**
 * Specifications
 */
export const pmoSpecs = sqliteTable('pmo_specs', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  status: text('status').default('draft'),
  type: text('type'),
  tags: text('tags'),
  dependsOn: text('depends_on'),
  problem: text('problem'),
  solution: text('solution'),
  decisions: text('decisions'),
  notNow: text('not_now'),
  uiUx: text('ui_ux'),
  acceptanceCriteria: text('acceptance_criteria'),
  openQuestions: text('open_questions'),
  requirementsFunctional: text('requirements_functional'),
  requirementsTechnical: text('requirements_technical'),
  context: text('context'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  idxStatus: index('idx_pmo_specs_status').on(table.status),
  idxType: index('idx_pmo_specs_type').on(table.type),
}))

/**
 * Spec-to-spec dependencies
 */
export const pmoSpecDependencies = sqliteTable('pmo_spec_dependencies', {
  specId: text('spec_id').notNull(),
  dependsOnSpecId: text('depends_on_spec_id').notNull(),
  dependencyType: text('dependency_type').notNull().default('depends_on'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  pk: primaryKey({ columns: [table.specId, table.dependsOnSpecId, table.dependencyType] }),
  idxDependsOn: index('idx_pmo_spec_deps_depends_on').on(table.dependsOnSpecId),
}))

/**
 * Epics
 */
export const pmoEpics = sqliteTable('pmo_epics', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  status: text('status').notNull().default('active'),
  position: integer('position').notNull().default(0),
  filePath: text('file_path'),
  specId: text('spec_id'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  idxProject: index('idx_pmo_epics_project').on(table.projectId),
  idxSpec: index('idx_pmo_epics_spec').on(table.specId),
  idxPosition: index('idx_pmo_epics_position').on(table.projectId, table.position),
}))

/**
 * Epic-to-epic dependencies
 */
export const pmoEpicDependencies = sqliteTable('pmo_epic_dependencies', {
  epicId: text('epic_id').notNull(),
  dependsOnEpicId: text('depends_on_epic_id').notNull(),
  dependencyType: text('dependency_type').notNull().default('blocks'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  pk: primaryKey({ columns: [table.epicId, table.dependsOnEpicId, table.dependencyType] }),
  idxDependsOn: index('idx_pmo_epic_deps_depends_on').on(table.dependsOnEpicId),
}))

/**
 * Project-to-spec associations
 */
export const pmoProjectSpecs = sqliteTable('pmo_project_specs', {
  projectId: text('project_id').notNull(),
  specId: text('spec_id').notNull(),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  pk: primaryKey({ columns: [table.projectId, table.specId] }),
  idxSpec: index('idx_pmo_project_specs_spec').on(table.specId),
  idxProject: index('idx_pmo_project_specs_project').on(table.projectId),
}))

/**
 * Tickets
 */
export const pmoTickets = sqliteTable('pmo_tickets', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().default('default'),
  title: text('title').notNull(),
  description: text('description'),
  priority: text('priority'),
  category: text('category'),
  status: text('status').notNull().default('backlog'),
  statusId: text('status_id'),
  owner: text('owner'),
  assignee: text('assignee'),
  branch: text('branch'),
  specId: text('spec_id'),
  epicId: text('epic_id'),
  labels: text('labels').notNull().default('[]'),
  position: integer('position').notNull().default(0),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
  lastSyncedFromSpec: text('last_synced_from_spec'),
  lastSyncedFromBoard: text('last_synced_from_board'),
}, (table) => ({
  idxProject: index('idx_pmo_tickets_project').on(table.projectId),
  idxStatus: index('idx_pmo_tickets_status').on(table.status),
  idxOwner: index('idx_pmo_tickets_owner').on(table.owner),
  idxAssignee: index('idx_pmo_tickets_assignee').on(table.assignee),
  idxSpec: index('idx_pmo_tickets_spec').on(table.specId),
  idxEpic: index('idx_pmo_tickets_epic').on(table.epicId),
  idxPriority: index('idx_pmo_tickets_priority').on(table.priority),
  idxCategory: index('idx_pmo_tickets_category').on(table.category),
  idxStatusId: index('idx_pmo_tickets_status_id').on(table.statusId),
  idxStatusPosition: index('idx_pmo_tickets_status_position').on(table.statusId, table.position),
}))

/**
 * Board views (saved filter/display configurations)
 */
export const pmoBoardViews = sqliteTable('pmo_board_views', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  filters: text('filters').notNull().default('{}'),
  groupBy: text('group_by'),
  sortBy: text('sort_by'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  uniqProjectName: unique().on(table.projectId, table.name),
  idxProject: index('idx_pmo_board_views_project').on(table.projectId),
  idxDefault: index('idx_pmo_board_views_default').on(table.projectId, table.isDefault),
}))

/**
 * Subtasks
 */
export const pmoSubtasks = sqliteTable('pmo_subtasks', {
  id: text('id').notNull(),
  ticketId: text('ticket_id').notNull(),
  title: text('title').notNull(),
  done: integer('done', { mode: 'boolean' }).default(false),
  position: integer('position').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.ticketId, table.id] }),
  idxTicket: index('idx_pmo_subtasks_ticket').on(table.ticketId),
}))

/**
 * Ticket metadata (key-value)
 */
export const pmoTicketMetadata = sqliteTable('pmo_ticket_metadata', {
  ticketId: text('ticket_id').notNull(),
  key: text('key').notNull(),
  value: text('value'),
}, (table) => ({
  pk: primaryKey({ columns: [table.ticketId, table.key] }),
}))

/**
 * Ticket-to-ticket dependencies
 */
export const pmoTicketDependencies = sqliteTable('pmo_ticket_dependencies', {
  ticketId: text('ticket_id').notNull(),
  dependsOnTicketId: text('depends_on_ticket_id').notNull(),
  dependencyType: text('dependency_type').notNull().default('blocks'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  pk: primaryKey({ columns: [table.ticketId, table.dependsOnTicketId, table.dependencyType] }),
  idxDependsOn: index('idx_pmo_ticket_deps_depends_on').on(table.dependsOnTicketId),
}))

/**
 * Ticket affected paths (scope hints for agents)
 */
export const pmoTicketAffectedPaths = sqliteTable('pmo_ticket_affected_paths', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ticketId: text('ticket_id').notNull(),
  pathPattern: text('path_pattern').notNull(),
  pathType: text('path_type').notNull().default('file'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  idxTicket: index('idx_pmo_ticket_paths_ticket').on(table.ticketId),
}))

/**
 * Ticket acceptance criteria
 */
export const pmoTicketAcceptanceCriteria = sqliteTable('pmo_ticket_acceptance_criteria', {
  id: text('id').notNull(),
  ticketId: text('ticket_id').notNull(),
  criterion: text('criterion').notNull(),
  verifiable: integer('verifiable', { mode: 'boolean' }).default(true),
  verified: integer('verified', { mode: 'boolean' }).default(false),
  verifiedAt: text('verified_at'),
  verifiedBy: text('verified_by'),
  position: integer('position').notNull().default(0),
}, (table) => ({
  pk: primaryKey({ columns: [table.ticketId, table.id] }),
  idxTicket: index('idx_pmo_ticket_criteria_ticket').on(table.ticketId),
}))

/**
 * Ticket-to-spec associations
 */
export const pmoTicketSpecs = sqliteTable('pmo_ticket_specs', {
  ticketId: text('ticket_id').notNull(),
  specId: text('spec_id').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.ticketId, table.specId] }),
  idxSpec: index('idx_pmo_ticket_specs_spec').on(table.specId),
}))

/**
 * Ticket assignments
 */
export const pmoTicketAssignments = sqliteTable('pmo_ticket_assignments', {
  ticketId: text('ticket_id').notNull(),
  agentName: text('agent_name').notNull(),
  assignedAt: text('assigned_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  pk: primaryKey({ columns: [table.ticketId, table.agentName] }),
  idxAgent: index('idx_pmo_assignments_agent').on(table.agentName),
}))

/**
 * Cache metadata
 */
export const pmoCacheMetadata = sqliteTable('pmo_cache_metadata', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

/**
 * PMO settings
 */
export const pmoSettings = sqliteTable('pmo_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

/**
 * Agent work execution tracking
 */
export const pmoAgentWork = sqliteTable('agent_work', {
  id: text('id').primaryKey(),
  ticketId: text('ticket_id').notNull(),
  agentName: text('agent_name').notNull(),
  executor: text('executor').notNull(),
  environment: text('environment').notNull().default('host'),
  displayMode: text('display_mode').notNull().default('terminal'),
  permissionMode: text('permission_mode').notNull().default('safe'),
  status: text('status').notNull().default('starting'),
  branch: text('branch'),
  pid: text('pid'),
  containerId: text('container_id'),
  sessionId: text('session_id'),
  host: text('host'),
  logPath: text('log_path'),
  externalSource: text('external_source'),
  externalKey: text('external_key'),
  externalId: text('external_id'),
  externalUrl: text('external_url'),
  startedAt: text('started_at').default(sql`CURRENT_TIMESTAMP`),
  completedAt: text('completed_at'),
  exitCode: integer('exit_code'),
}, (table) => ({
  idxAgent: index('idx_agent_work_agent').on(table.agentName),
  idxStatus: index('idx_agent_work_status').on(table.status),
  idxTicket: index('idx_agent_work_ticket').on(table.ticketId),
}))

/**
 * Docker containers per agent
 */
export const pmoContainers = sqliteTable('containers', {
  id: text('id').primaryKey(),
  agentName: text('agent_name').notNull(),
  dockerId: text('docker_id').notNull(),
  dockerName: text('docker_name'),
  image: text('image'),
  status: text('status').notNull().default('unknown'),
  currentExecutionId: text('current_execution_id'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  lastSeenAt: text('last_seen_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  idxAgent: index('idx_containers_agent').on(table.agentName),
  idxDockerId: index('idx_containers_docker_id').on(table.dockerId),
  idxStatus: index('idx_containers_status').on(table.status),
}))

/**
 * Provider-agnostic external issue ↔ execution mapping.
 */
export const pmoExternalExecutionMap = sqliteTable('pmo_external_execution_map', {
  provider: text('provider', { enum: ['linear', 'jira', 'asana', 'monday', 'pmo'] }).notNull(),
  externalId: text('external_id').notNull(),
  externalKey: text('external_key'),
  canonicalUrl: text('canonical_url'),
  latestStateSnapshot: text('latest_state_snapshot'),
  lastSyncedAt: text('last_synced_at'),
  lastSpawnedAt: text('last_spawned_at'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  pk: primaryKey({ columns: [table.provider, table.externalId] }),
  idxExternalKey: index('idx_pmo_external_execution_map_external_key').on(table.provider, table.externalKey),
}))

/**
 * Linked execution IDs for external mappings.
 */
export const pmoExternalExecutionLinks = sqliteTable('pmo_external_execution_links', {
  provider: text('provider').notNull(),
  externalId: text('external_id').notNull(),
  executionId: text('execution_id').notNull(),
  linkedAt: text('linked_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  pk: primaryKey({ columns: [table.provider, table.externalId, table.executionId] }),
  idxExecutionId: index('idx_pmo_external_execution_links_execution_id').on(table.executionId),
}))

/**
 * Linked PR URLs for external mappings.
 */
export const pmoExternalExecutionPrs = sqliteTable('pmo_external_execution_prs', {
  provider: text('provider').notNull(),
  externalId: text('external_id').notNull(),
  prUrl: text('pr_url').notNull(),
  linkedAt: text('linked_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  pk: primaryKey({ columns: [table.provider, table.externalId, table.prUrl] }),
  idxPrUrl: index('idx_pmo_external_execution_prs_pr_url').on(table.prUrl),
}))

/**
 * Generic external issue ↔ PMO ticket mapping (replaces provider-specific tables).
 */
export const pmoExternalIssueMap = sqliteTable('pmo_external_issue_map', {
  pmoTicketId: text('pmo_ticket_id').notNull(),
  provider: text('provider', { enum: ['linear', 'jira', 'shortcut', 'trello', 'github'] }).notNull(),
  externalId: text('external_id').notNull(),
  externalKey: text('external_key').notNull(),
  externalUrl: text('external_url').notNull(),
  teamKey: text('team_key').notNull(),
  syncDirection: text('sync_direction', { enum: ['inbound', 'outbound', 'bidirectional'] }).notNull().default('inbound'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  pk: primaryKey({ columns: [table.pmoTicketId, table.provider] }),
  unqProviderExternalId: unique('unq_pmo_external_issue_map_provider_external_id').on(table.provider, table.externalId),
  idxProvider: index('idx_pmo_external_issue_map_provider').on(table.provider),
  idxExternalId: index('idx_pmo_external_issue_map_external_id').on(table.provider, table.externalId),
  idxExternalKey: index('idx_pmo_external_issue_map_external_key_eim').on(table.provider, table.externalKey),
  idxTeamKey: index('idx_pmo_external_issue_map_team_key').on(table.provider, table.teamKey),
}))

/**
 * ID sequence counters
 */
export const pmoIdSequences = sqliteTable('id_sequences', {
  tableName: text('table_name').primaryKey(),
  nextId: integer('next_id').notNull().default(1),
})

/**
 * Work actions (reusable agent prompts)
 */
export const pmoActions = sqliteTable('pmo_actions', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description'),
  prompt: text('prompt').notNull(),
  endPrompt: text('end_prompt'),
  suggestedForCategories: text('suggested_for_categories'),
  defaultMoveToCategory: text('default_move_to_category'),
  modifiesCode: integer('modifies_code', { mode: 'boolean' }).notNull().default(true),
  isBuiltin: integer('is_builtin', { mode: 'boolean' }).notNull().default(false),
  position: integer('position').notNull().default(0),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
})

/**
 * Ticket templates
 */
export const pmoTicketTemplates = sqliteTable('pmo_ticket_templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description'),
  isBuiltin: integer('is_builtin', { mode: 'boolean' }).notNull().default(false),
  titlePattern: text('title_pattern'),
  descriptionTemplate: text('description_template'),
  defaultPriority: text('default_priority'),
  defaultCategory: text('default_category'),
  defaultStatusId: text('default_status_id'),
  defaultAssignee: text('default_assignee'),
  defaultOwner: text('default_owner'),
  defaultLabels: text('default_labels').notNull().default('[]'),
  suggestedSubtasks: text('suggested_subtasks').notNull().default('[]'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  idxBuiltin: index('idx_pmo_ticket_templates_builtin').on(table.isBuiltin),
}))

/**
 * Categories (ticket and status type classifications)
 */
export const pmoCategories = sqliteTable('pmo_categories', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  description: text('description'),
  color: text('color'),
  position: integer('position').notNull().default(0),
  isBuiltin: integer('is_builtin', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  uniqNameType: unique().on(table.name, table.type),
  idxType: index('idx_pmo_categories_type').on(table.type),
}))

/**
 * Label groups
 */
export const pmoLabelGroups = sqliteTable('pmo_label_groups', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description'),
  isExclusive: integer('is_exclusive', { mode: 'boolean' }).notNull().default(false),
  isRequired: integer('is_required', { mode: 'boolean' }).notNull().default(false),
  position: integer('position').notNull().default(0),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
})

/**
 * Labels
 */
export const pmoLabels = sqliteTable('pmo_labels', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  color: text('color'),
  description: text('description'),
  groupId: text('group_id'),
  position: integer('position').notNull().default(0),
  isBuiltin: integer('is_builtin', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  idxGroup: index('idx_pmo_labels_group').on(table.groupId),
}))

/**
 * Ticket-to-label associations
 */
export const pmoTicketLabels = sqliteTable('pmo_ticket_labels', {
  ticketId: text('ticket_id').notNull(),
  labelId: text('label_id').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.ticketId, table.labelId] }),
  idxLabel: index('idx_pmo_ticket_labels_label').on(table.labelId),
}))

/**
 * Roadmaps (named collections of projects)
 */
export const pmoRoadmaps = sqliteTable('pmo_roadmaps', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description'),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  idxDefault: index('idx_pmo_roadmaps_default').on(table.isDefault),
}))

/**
 * Roadmap-to-project associations
 */
export const pmoRoadmapProjects = sqliteTable('pmo_roadmap_projects', {
  roadmapId: text('roadmap_id').notNull(),
  projectId: text('project_id').notNull(),
  position: integer('position').notNull().default(0),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  pk: primaryKey({ columns: [table.roadmapId, table.projectId] }),
  idxRoadmap: index('idx_pmo_roadmap_projects_roadmap').on(table.roadmapId),
  idxProject: index('idx_pmo_roadmap_projects_project').on(table.projectId),
  idxPosition: index('idx_pmo_roadmap_projects_position').on(table.roadmapId, table.position),
}))

// =============================================================================
// Legacy/Deprecated Tables (kept for migration compatibility)
// =============================================================================

/**
 * @deprecated Use pmoWorkflowStatuses instead
 */
export const pmoColumns = sqliteTable('pmo_columns', {
  id: text('id').notNull(),
  projectId: text('project_id').notNull().default('default'),
  name: text('name').notNull(),
  position: integer('position').notNull(),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  pk: primaryKey({ columns: [table.projectId, table.id] }),
}))

/**
 * @deprecated Tickets now use status_id directly
 */
export const pmoBoardTickets = sqliteTable('pmo_board_tickets', {
  projectId: text('project_id').notNull(),
  ticketId: text('ticket_id').notNull(),
  columnId: text('column_id').notNull(),
  position: integer('position').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.projectId, table.ticketId] }),
}))

/**
 * @deprecated Use pmoWorkflowStatuses instead
 */
export const pmoStatuses = sqliteTable('pmo_statuses', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  name: text('name').notNull(),
  category: text('category').notNull(),
  position: integer('position').notNull().default(0),
  color: text('color'),
  description: text('description'),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  uniqProjectName: unique().on(table.projectId, table.name),
}))

// =============================================================================
// Relations
// =============================================================================

export const workspaceRelations = relations(workspace, ({ one }) => ({
  activeTheme: one(agentThemes, {
    fields: [workspace.activeThemeId],
    references: [agentThemes.id],
  }),
}))

export const agentThemesRelations = relations(agentThemes, ({ many }) => ({
  names: many(agentThemeNames),
  agents: many(agents),
}))

export const agentThemeNamesRelations = relations(agentThemeNames, ({ one }) => ({
  theme: one(agentThemes, {
    fields: [agentThemeNames.themeId],
    references: [agentThemes.id],
  }),
}))

export const agentsRelations = relations(agents, ({ one, many }) => ({
  theme: one(agentThemes, {
    fields: [agents.themeId],
    references: [agentThemes.id],
  }),
  worktrees: many(agentWorktrees),
  containers: many(pmoContainers),
}))

export const agentWorktreesRelations = relations(agentWorktrees, ({ one }) => ({
  agent: one(agents, {
    fields: [agentWorktrees.agentName],
    references: [agents.name],
  }),
  repository: one(repositories, {
    fields: [agentWorktrees.repoName],
    references: [repositories.name],
  }),
}))

export const pmoProjectsRelations = relations(pmoProjects, ({ one, many }) => ({
  phase: one(pmoPhases, {
    fields: [pmoProjects.phaseId],
    references: [pmoPhases.id],
  }),
  workflow: one(pmoWorkflows, {
    fields: [pmoProjects.workflowId],
    references: [pmoWorkflows.id],
  }),
  tickets: many(pmoTickets),
  epics: many(pmoEpics),
  boardViews: many(pmoBoardViews),
  projectSpecs: many(pmoProjectSpecs),
  roadmapProjects: many(pmoRoadmapProjects),
}))

export const pmoWorkflowsRelations = relations(pmoWorkflows, ({ many }) => ({
  statuses: many(pmoWorkflowStatuses),
  projects: many(pmoProjects),
}))

export const pmoWorkflowStatusesRelations = relations(pmoWorkflowStatuses, ({ one, many }) => ({
  workflow: one(pmoWorkflows, {
    fields: [pmoWorkflowStatuses.workflowId],
    references: [pmoWorkflows.id],
  }),
  tickets: many(pmoTickets),
}))

export const pmoTicketsRelations = relations(pmoTickets, ({ one, many }) => ({
  project: one(pmoProjects, {
    fields: [pmoTickets.projectId],
    references: [pmoProjects.id],
  }),
  status: one(pmoWorkflowStatuses, {
    fields: [pmoTickets.statusId],
    references: [pmoWorkflowStatuses.id],
  }),
  spec: one(pmoSpecs, {
    fields: [pmoTickets.specId],
    references: [pmoSpecs.id],
  }),
  epic: one(pmoEpics, {
    fields: [pmoTickets.epicId],
    references: [pmoEpics.id],
  }),
  subtasks: many(pmoSubtasks),
  metadata: many(pmoTicketMetadata),
  acceptanceCriteria: many(pmoTicketAcceptanceCriteria),
  ticketSpecs: many(pmoTicketSpecs),
  assignments: many(pmoTicketAssignments),
  affectedPaths: many(pmoTicketAffectedPaths),
  agentWork: many(pmoAgentWork),
}))

export const pmoSubtasksRelations = relations(pmoSubtasks, ({ one }) => ({
  ticket: one(pmoTickets, {
    fields: [pmoSubtasks.ticketId],
    references: [pmoTickets.id],
  }),
}))

export const pmoSpecsRelations = relations(pmoSpecs, ({ many }) => ({
  tickets: many(pmoTickets),
  ticketSpecs: many(pmoTicketSpecs),
  projectSpecs: many(pmoProjectSpecs),
  epics: many(pmoEpics),
}))

export const pmoEpicsRelations = relations(pmoEpics, ({ one, many }) => ({
  project: one(pmoProjects, {
    fields: [pmoEpics.projectId],
    references: [pmoProjects.id],
  }),
  spec: one(pmoSpecs, {
    fields: [pmoEpics.specId],
    references: [pmoSpecs.id],
  }),
  tickets: many(pmoTickets),
}))

export const pmoRoadmapsRelations = relations(pmoRoadmaps, ({ many }) => ({
  roadmapProjects: many(pmoRoadmapProjects),
}))

export const pmoRoadmapProjectsRelations = relations(pmoRoadmapProjects, ({ one }) => ({
  roadmap: one(pmoRoadmaps, {
    fields: [pmoRoadmapProjects.roadmapId],
    references: [pmoRoadmaps.id],
  }),
  project: one(pmoProjects, {
    fields: [pmoRoadmapProjects.projectId],
    references: [pmoProjects.id],
  }),
}))

// =============================================================================
// Type Exports (prefixed with Db to avoid conflicts with domain types)
// =============================================================================

export type DbWorkspace = typeof workspace.$inferSelect
export type NewDbWorkspace = typeof workspace.$inferInsert

export type DbRepository = typeof repositories.$inferSelect
export type NewDbRepository = typeof repositories.$inferInsert

export type DbAgentTheme = typeof agentThemes.$inferSelect
export type NewDbAgentTheme = typeof agentThemes.$inferInsert

export type DbAgentThemeName = typeof agentThemeNames.$inferSelect
export type NewDbAgentThemeName = typeof agentThemeNames.$inferInsert

export type DbAgent = typeof agents.$inferSelect
export type NewDbAgent = typeof agents.$inferInsert

export type DbAgentWorktree = typeof agentWorktrees.$inferSelect
export type NewDbAgentWorktree = typeof agentWorktrees.$inferInsert

export type DbPmoProject = typeof pmoProjects.$inferSelect
export type NewDbPmoProject = typeof pmoProjects.$inferInsert

export type DbPmoWorkflow = typeof pmoWorkflows.$inferSelect
export type NewDbPmoWorkflow = typeof pmoWorkflows.$inferInsert

export type DbPmoWorkflowStatus = typeof pmoWorkflowStatuses.$inferSelect
export type NewDbPmoWorkflowStatus = typeof pmoWorkflowStatuses.$inferInsert

export type DbPmoTicket = typeof pmoTickets.$inferSelect
export type NewDbPmoTicket = typeof pmoTickets.$inferInsert

export type DbPmoSpec = typeof pmoSpecs.$inferSelect
export type NewDbPmoSpec = typeof pmoSpecs.$inferInsert

export type DbPmoEpic = typeof pmoEpics.$inferSelect
export type NewDbPmoEpic = typeof pmoEpics.$inferInsert

export type DbPmoSubtask = typeof pmoSubtasks.$inferSelect
export type NewDbPmoSubtask = typeof pmoSubtasks.$inferInsert

export type DbPmoPhase = typeof pmoPhases.$inferSelect
export type NewDbPmoPhase = typeof pmoPhases.$inferInsert

export type DbPmoAction = typeof pmoActions.$inferSelect
export type NewDbPmoAction = typeof pmoActions.$inferInsert

export type DbPmoTicketTemplate = typeof pmoTicketTemplates.$inferSelect
export type NewDbPmoTicketTemplate = typeof pmoTicketTemplates.$inferInsert

export type DbPmoRoadmap = typeof pmoRoadmaps.$inferSelect
export type NewDbPmoRoadmap = typeof pmoRoadmaps.$inferInsert

export type DbPmoBoardView = typeof pmoBoardViews.$inferSelect
export type NewDbPmoBoardView = typeof pmoBoardViews.$inferInsert

export type DbPmoAgentWorkRecord = typeof pmoAgentWork.$inferSelect
export type NewDbPmoAgentWorkRecord = typeof pmoAgentWork.$inferInsert

export type DbPmoExternalIssueMap = typeof pmoExternalIssueMap.$inferSelect
export type NewDbPmoExternalIssueMap = typeof pmoExternalIssueMap.$inferInsert

export type DbPmoExternalExecutionMap = typeof pmoExternalExecutionMap.$inferSelect
export type NewDbPmoExternalExecutionMap = typeof pmoExternalExecutionMap.$inferInsert

export type DbPmoExternalExecutionLink = typeof pmoExternalExecutionLinks.$inferSelect
export type NewDbPmoExternalExecutionLink = typeof pmoExternalExecutionLinks.$inferInsert

export type DbPmoExternalExecutionPr = typeof pmoExternalExecutionPrs.$inferSelect
export type NewDbPmoExternalExecutionPr = typeof pmoExternalExecutionPrs.$inferInsert

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
  status: text('status', { enum: ['active', 'running', 'completed', 'dead', 'cleaned'] }).notNull().default('active'),
  baseName: text('base_name'),
  themeId: text('theme_id'),
  worktreePath: text('worktree_path'),
  mountMode: text('mount_mode', { enum: ['worktree', 'clone'] }).notNull().default('worktree'),
  createdAt: text('created_at').notNull(),
  cleanedAt: text('cleaned_at'),
}, (table) => ({
  idxTheme: index('idx_agents_theme').on(table.themeId),
  idxStatus: index('idx_agents_status').on(table.status),
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
  lastCommitHash: text('last_commit_hash'),
  commitsAhead: integer('commits_ahead').notNull().default(0),
  isClean: integer('is_clean', { mode: 'boolean' }).notNull().default(true),
  lastChecked: text('last_checked'),
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

/**
 * Media items (videos, audio files with preprocessed assets)
 */
export const mediaItems = sqliteTable('media_items', {
  name: text('name').primaryKey(),
  path: text('path').notNull(),
  sourcePath: text('source_path'),
  mediaType: text('media_type', { enum: ['video', 'audio'] }).notNull().default('video'),
  durationSeconds: integer('duration_seconds'),
  resolution: text('resolution'),
  frameCount: integer('frame_count').notNull().default(0),
  hasTranscript: integer('has_transcript', { mode: 'boolean' }).notNull().default(false),
  frameInterval: integer('frame_interval').notNull().default(30),
  status: text('status', { enum: ['pending', 'processing', 'ready', 'error'] }).notNull().default('pending'),
  errorMessage: text('error_message'),
  addedAt: text('added_at').notNull(),
  processedAt: text('processed_at'),
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
  errorMessage: text('error_message'),
  cleanupPolicy: text('cleanup_policy').notNull().default('on-exit'),
  gcCleanedAt: text('gc_cleaned_at'),
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
 * External issue registry — tracks tickets prlt knows about (provider-keyed).
 * Rekeyed by (provider, external_id) — no longer references local PMO ticket IDs.
 */
export const pmoExternalIssueMap = sqliteTable('pmo_external_issue_map', {
  provider: text('provider').notNull(),
  externalId: text('external_id').notNull(),
  externalKey: text('external_key').notNull(),
  externalUrl: text('external_url').notNull(),
  teamKey: text('team_key').notNull(),
  syncDirection: text('sync_direction', { enum: ['inbound', 'outbound', 'bidirectional'] }).notNull().default('inbound'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  pk: primaryKey({ columns: [table.provider, table.externalId] }),
  idxProvider: index('idx_pmo_external_issue_map_provider').on(table.provider),
  idxExternalKey: index('idx_pmo_external_issue_map_external_key').on(table.provider, table.externalKey),
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
  fromIntent: text('from_intent'),
  toIntent: text('to_intent'),
  validFrom: text('valid_from'),
  executor: text('executor'),
  environment: text('environment'),
  permissionMode: text('permission_mode'),
  timeout: integer('timeout'),
  model: text('model'),
  reviewGate: text('review_gate'),
  networkAllowlist: text('network_allowlist'),
  modifiesCode: integer('modifies_code', { mode: 'boolean' }).notNull().default(true),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  isBuiltin: integer('is_builtin', { mode: 'boolean' }).notNull().default(false),
  position: integer('position').notNull().default(0),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at'),
})

/**
 * Workflow rules (intent-to-action wiring)
 */
export const pmoWorkflowRules = sqliteTable('pmo_workflow_rules', {
  id: text('id').primaryKey(),
  fromIntent: text('from_intent'),
  toIntent: text('to_intent').notNull(),
  actionId: text('action_id').notNull().references(() => pmoActions.id, { onDelete: 'cascade' }),
  trigger: text('trigger').notNull().default('manual'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at'),
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
 * Runtime ticket cache (provider-agnostic)
 */
export const pmoTicketRefs = sqliteTable('ticket_refs', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull().default('pmo'),
  externalId: text('external_id'),
  externalKey: text('external_key'),
  externalUrl: text('external_url'),
  title: text('title').notNull(),
  description: text('description'),
  status: text('status'),
  priority: text('priority'),
  category: text('category'),
  assignee: text('assignee'),
  projectId: text('project_id'),
  cachedAt: text('cached_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  uniqProviderExternal: unique().on(table.provider, table.externalId),
  idxProvider: index('idx_ticket_refs_provider').on(table.provider),
  idxExternalKey: index('idx_ticket_refs_external_key').on(table.provider, table.externalKey),
  idxStatus: index('idx_ticket_refs_status').on(table.status),
  idxProject: index('idx_ticket_refs_project').on(table.projectId),
}))

/**
 * Work lifecycle hooks: configurable event-driven actions
 */
export const pmoWorkHooks = sqliteTable('pmo_work_hooks', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  event: text('event').notNull(),
  actionType: text('action_type').notNull(),
  actionValue: text('action_value').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  description: text('description'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  idxEvent: index('idx_pmo_work_hooks_event').on(table.event),
  idxEnabled: index('idx_pmo_work_hooks_enabled').on(table.enabled),
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

export const pmoProjectsRelations = relations(pmoProjects, ({ one }) => ({
  phase: one(pmoPhases, {
    fields: [pmoProjects.phaseId],
    references: [pmoPhases.id],
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

export type DbPmoPhase = typeof pmoPhases.$inferSelect
export type NewDbPmoPhase = typeof pmoPhases.$inferInsert

export type DbPmoAction = typeof pmoActions.$inferSelect
export type NewDbPmoAction = typeof pmoActions.$inferInsert

export type DbPmoTicketTemplate = typeof pmoTicketTemplates.$inferSelect
export type NewDbPmoTicketTemplate = typeof pmoTicketTemplates.$inferInsert

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

export type DbMediaItem = typeof mediaItems.$inferSelect
export type NewDbMediaItem = typeof mediaItems.$inferInsert

export type DbPmoWorkflowRule = typeof pmoWorkflowRules.$inferSelect
export type NewDbPmoWorkflowRule = typeof pmoWorkflowRules.$inferInsert

export type DbPmoTicketRef = typeof pmoTicketRefs.$inferSelect
export type NewDbPmoTicketRef = typeof pmoTicketRefs.$inferInsert

export type DbPmoWorkHook = typeof pmoWorkHooks.$inferSelect
export type NewDbPmoWorkHook = typeof pmoWorkHooks.$inferInsert

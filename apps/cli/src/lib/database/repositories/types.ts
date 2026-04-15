/**
 * Repository Pattern — Shared Types
 *
 * Type definitions for repository interfaces and their inputs/outputs.
 * All DB access goes through repositories; no direct Drizzle/SQL outside.
 *
 * PRLT-1303: Data access layer — typed repository pattern for all DB operations.
 */

import type { DrizzleDB } from '../drizzle.js'

// =============================================================================
// Base Repository Context
// =============================================================================

/**
 * Injected dependencies for all repositories.
 * Constructor injection enables testing with in-memory databases.
 */
export interface RepositoryContext {
  drizzle: DrizzleDB
}

// =============================================================================
// Agent Types
// =============================================================================

export type AgentType = 'persistent' | 'ephemeral'
export type AgentStatus = 'active' | 'running' | 'completed' | 'dead' | 'cleaned'
export type MountMode = 'worktree' | 'clone'

export interface AgentRecord {
  name: string
  type: AgentType
  status: AgentStatus
  baseName: string | null
  themeId: string | null
  worktreePath: string | null
  mountMode: MountMode
  createdAt: string
  cleanedAt: string | null
}

export interface CreateAgentInput {
  name: string
  type: AgentType
  baseName?: string | null
  themeId?: string | null
  worktreePath?: string | null
  mountMode?: MountMode
}

export interface AgentFilter {
  status?: AgentStatus | AgentStatus[]
  type?: AgentType
  includeCleanedUp?: boolean
}

export interface AgentWorktreeRecord {
  agentName: string
  repoName: string
  worktreePath: string
  branch: string
  createdAt: string
  lastCommitHash: string | null
  commitsAhead: number
  isClean: boolean
  lastChecked: string | null
}

export interface CreateAgentWorktreeInput {
  agentName: string
  repoName: string
  worktreePath: string
  branch: string
}

// =============================================================================
// Session / Execution Types
// =============================================================================

export type ExecutionStatus = 'starting' | 'running' | 'completed' | 'failed' | 'stopped'

export interface ExecutionRecord {
  id: string
  ticketId: string
  agentName: string
  executor: string
  environment: string
  displayMode: string
  permissionMode: string
  cleanupPolicy: string
  status: ExecutionStatus
  branch: string | null
  pid: string | null
  containerId: string | null
  sessionId: string | null
  host: string | null
  logPath: string | null
  externalSource: string | null
  externalKey: string | null
  externalId: string | null
  externalUrl: string | null
  startedAt: string | null
  completedAt: string | null
  exitCode: number | null
  errorMessage: string | null
  gcCleanedAt: string | null
}

export interface CreateExecutionInput {
  id: string
  ticketId: string
  agentName: string
  executor: string
  environment?: string
  displayMode?: string
  permissionMode?: string
  cleanupPolicy?: string
  branch?: string
  pid?: string
  containerId?: string
  sessionId?: string
  host?: string
  logPath?: string
  externalSource?: string
  externalKey?: string
  externalId?: string
  externalUrl?: string
}

export interface ExecutionFilter {
  status?: ExecutionStatus
  agentName?: string
  ticketId?: string
  limit?: number
}

// =============================================================================
// Workflow Types
// =============================================================================

export interface ActionRecord {
  id: string
  name: string
  description: string | null
  prompt: string
  endPrompt: string | null
  fromIntent: string | null
  toIntent: string | null
  executor: string | null
  environment: string | null
  permissionMode: string | null
  timeout: number | null
  model: string | null
  reviewGate: string | null
  networkAllowlist: string | null
  modifiesCode: boolean
  isDefault: boolean
  isBuiltin: boolean
  position: number
  createdAt: string | null
  updatedAt: string | null
}

export interface CreateActionInput {
  id?: string
  name: string
  prompt: string
  description?: string
  endPrompt?: string
  fromIntent?: string
  toIntent?: string
  executor?: string
  environment?: string
  permissionMode?: string
  timeout?: number
  model?: string
  reviewGate?: string
  networkAllowlist?: string
  modifiesCode?: boolean
  isDefault?: boolean
  isBuiltin?: boolean
  position?: number
}

export interface UpdateActionInput {
  name?: string
  description?: string | null
  prompt?: string
  endPrompt?: string | null
  fromIntent?: string | null
  toIntent?: string | null
  executor?: string | null
  environment?: string | null
  permissionMode?: string | null
  timeout?: number | null
  model?: string | null
  reviewGate?: string | null
  networkAllowlist?: string | null
  modifiesCode?: boolean
  isDefault?: boolean
  position?: number
}

export interface ActionFilter {
  isBuiltin?: boolean
  fromIntent?: string
  search?: string
}

export interface WorkflowRuleRecord {
  id: string
  fromIntent: string | null
  toIntent: string
  actionId: string
  trigger: string
  enabled: boolean
  createdAt: string | null
  updatedAt: string | null
}

export interface CreateWorkflowRuleInput {
  id?: string
  fromIntent?: string
  toIntent: string
  actionId: string
  trigger?: string
  enabled?: boolean
}

export interface UpdateWorkflowRuleInput {
  fromIntent?: string | null
  toIntent?: string
  actionId?: string
  trigger?: string
  enabled?: boolean
}

export interface WorkflowRuleFilter {
  toIntent?: string
  fromIntent?: string
  actionId?: string
  trigger?: string
  enabled?: boolean
}

export interface WorkHookRecord {
  id: string
  name: string
  event: string
  actionType: string
  actionValue: string
  enabled: boolean
  description: string | null
  createdAt: string | null
}

// =============================================================================
// Project Types
// =============================================================================

export interface ProjectRecord {
  id: string
  name: string
  template: string | null
  description: string | null
  status: string
  phaseId: string | null
  workflowId: string | null
  isArchived: boolean
  targetDate: string | null
  initiativeId: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface CreateProjectInput {
  id?: string
  name: string
  template?: string
  description?: string
  workflowId?: string
}

export interface UpdateProjectInput {
  name?: string
  description?: string | null
  status?: string
  phaseId?: string | null
  workflowId?: string | null
  isArchived?: boolean
  targetDate?: string | null
  initiativeId?: string | null
}

export interface ProjectFilter {
  isArchived?: boolean
  phaseId?: string
  search?: string
}

// =============================================================================
// PR / External Execution Types
// =============================================================================

export interface ExternalExecutionMapRecord {
  provider: string
  externalId: string
  externalKey: string | null
  canonicalUrl: string | null
  latestStateSnapshot: string | null
  lastSyncedAt: string | null
  lastSpawnedAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface UpsertExternalExecutionInput {
  provider: string
  externalId: string
  externalKey?: string
  canonicalUrl?: string
  latestStateSnapshot?: string
  lastSyncedAt?: string
  lastSpawnedAt?: string
}

export interface ExternalExecutionLinkRecord {
  provider: string
  externalId: string
  executionId: string
  linkedAt: string | null
}

export interface ExternalExecutionPrRecord {
  provider: string
  externalId: string
  prUrl: string
  linkedAt: string | null
}

// =============================================================================
// Ticket Ref Types
// =============================================================================

export interface TicketRefRecord {
  id: string
  provider: string
  externalId: string | null
  externalKey: string | null
  externalUrl: string | null
  title: string
  description: string | null
  status: string | null
  priority: string | null
  category: string | null
  assignee: string | null
  projectId: string | null
  cachedAt: string | null
  updatedAt: string | null
}

export interface UpsertTicketRefInput {
  id: string
  provider?: string
  externalId?: string
  externalKey?: string
  externalUrl?: string
  title: string
  description?: string
  status?: string
  priority?: string
  category?: string
  assignee?: string
  projectId?: string
}

export interface TicketRefFilter {
  provider?: string
  status?: string
  projectId?: string
  externalKey?: string
}

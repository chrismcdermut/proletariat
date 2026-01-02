/**
 * Event-Based Hooks System Types
 *
 * Defines events that can trigger hooks, conditions for filtering,
 * and actions that can be executed when hooks fire.
 */

import { Ticket, TicketStatus, Epic, EpicStatus } from '../pmo/types.js'

// =============================================================================
// Event Types
// =============================================================================

/**
 * All supported event names.
 * These events are emitted by the PMO system when entities change.
 */
export type HookEventName =
  | 'ticket.created'
  | 'ticket.moved'
  | 'ticket.updated'
  | 'ticket.status_changed'
  | 'ticket.deleted'
  | 'ticket.completed'
  | 'epic.created'
  | 'epic.updated'
  | 'epic.status_changed'
  | 'epic.deleted'
  | 'work.started'
  | 'work.completed'

/**
 * Base event payload - all events include these fields
 */
export interface BaseEventPayload {
  /** When the event occurred */
  timestamp: Date
  /** Project ID where the event occurred */
  projectId: string
}

/**
 * Ticket-related event payloads
 */
export interface TicketCreatedPayload extends BaseEventPayload {
  ticket: Ticket
}

export interface TicketMovedPayload extends BaseEventPayload {
  ticket: Ticket
  fromColumn: string
  toColumn: string
}

export interface TicketUpdatedPayload extends BaseEventPayload {
  ticket: Ticket
  changes: Partial<Ticket>
  previousValues: Partial<Ticket>
}

export interface TicketStatusChangedPayload extends BaseEventPayload {
  ticket: Ticket
  fromStatus: TicketStatus | undefined
  toStatus: TicketStatus
}

export interface TicketDeletedPayload extends BaseEventPayload {
  ticketId: string
  ticket: Ticket  // Snapshot before deletion
}

export interface TicketCompletedPayload extends BaseEventPayload {
  ticket: Ticket
}

/**
 * Epic-related event payloads
 */
export interface EpicCreatedPayload extends BaseEventPayload {
  epic: Epic
}

export interface EpicUpdatedPayload extends BaseEventPayload {
  epic: Epic
  changes: Partial<Epic>
  previousValues: Partial<Epic>
}

export interface EpicStatusChangedPayload extends BaseEventPayload {
  epic: Epic
  fromStatus: EpicStatus | undefined
  toStatus: EpicStatus
}

export interface EpicDeletedPayload extends BaseEventPayload {
  epicId: string
  epic: Epic  // Snapshot before deletion
}

/**
 * Work-related event payloads
 */
export interface WorkStartedPayload extends BaseEventPayload {
  ticketId: string
  agentName: string
  executionId: string
}

export interface WorkCompletedPayload extends BaseEventPayload {
  ticketId: string
  agentName: string
  executionId: string
  success: boolean
}

/**
 * Union of all event payloads
 */
export type HookEventPayload =
  | TicketCreatedPayload
  | TicketMovedPayload
  | TicketUpdatedPayload
  | TicketStatusChangedPayload
  | TicketDeletedPayload
  | TicketCompletedPayload
  | EpicCreatedPayload
  | EpicUpdatedPayload
  | EpicStatusChangedPayload
  | EpicDeletedPayload
  | WorkStartedPayload
  | WorkCompletedPayload

/**
 * Map event names to their payload types
 */
export interface HookEventMap {
  'ticket.created': TicketCreatedPayload
  'ticket.moved': TicketMovedPayload
  'ticket.updated': TicketUpdatedPayload
  'ticket.status_changed': TicketStatusChangedPayload
  'ticket.deleted': TicketDeletedPayload
  'ticket.completed': TicketCompletedPayload
  'epic.created': EpicCreatedPayload
  'epic.updated': EpicUpdatedPayload
  'epic.status_changed': EpicStatusChangedPayload
  'epic.deleted': EpicDeletedPayload
  'work.started': WorkStartedPayload
  'work.completed': WorkCompletedPayload
}

// =============================================================================
// Condition Types
// =============================================================================

/**
 * Comparison operators for conditions
 */
export type ConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'matches'  // regex match
  | 'in'       // value is in array
  | 'not_in'   // value is not in array

/**
 * A single condition that must be met for the hook to fire
 */
export interface HookCondition {
  /** Field path to check (e.g., "toColumn", "ticket.priority", "ticket.category") */
  field: string
  /** Comparison operator */
  operator: ConditionOperator
  /** Value(s) to compare against */
  value: string | string[] | number | boolean
}

// =============================================================================
// Action Types
// =============================================================================

/**
 * Types of actions that can be executed by hooks
 */
export type HookActionType = 'spawn_agent' | 'shell' | 'log' | 'notify' | 'webhook'

/**
 * Base action configuration
 */
export interface BaseHookAction {
  type: HookActionType
}

/**
 * Spawn agent action - triggers auto-spawn for tickets
 */
export interface SpawnAgentAction extends BaseHookAction {
  type: 'spawn_agent'
  /** Agent selection strategy */
  strategy?: 'round-robin' | 'least-busy' | 'random'
  /** Specific agent to use (overrides strategy) */
  agent?: string
  /** Maximum number of agents to spawn (per hook execution) */
  limit?: number
  /** Execution environment */
  environment?: 'host' | 'devcontainer' | 'docker'
  /** Display mode */
  displayMode?: 'terminal' | 'tmux' | 'background' | 'foreground'
  /** Skip permission checks */
  skipPermissions?: boolean
  /** Create PR when work is ready */
  createPR?: boolean
}

/**
 * Shell command action - runs a shell command
 */
export interface ShellAction extends BaseHookAction {
  type: 'shell'
  /** Command to execute */
  command: string
  /** Working directory (relative to workspace) */
  cwd?: string
  /** Environment variables */
  env?: Record<string, string>
  /** Timeout in milliseconds */
  timeout?: number
  /** Run in background (don't wait for completion) */
  background?: boolean
}

/**
 * Log action - writes to log output
 */
export interface LogAction extends BaseHookAction {
  type: 'log'
  /** Message template (can use {{field}} placeholders) */
  message: string
  /** Log level */
  level?: 'info' | 'warn' | 'error' | 'debug'
}

/**
 * Notify action - sends notifications (placeholder for future)
 */
export interface NotifyAction extends BaseHookAction {
  type: 'notify'
  /** Notification channel */
  channel: 'slack' | 'email' | 'desktop'
  /** Message template */
  message: string
  /** Additional channel-specific options */
  options?: Record<string, unknown>
}

/**
 * Webhook action - sends HTTP request
 */
export interface WebhookAction extends BaseHookAction {
  type: 'webhook'
  /** URL to send request to */
  url: string
  /** HTTP method */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH'
  /** Request headers */
  headers?: Record<string, string>
  /** Request body template (JSON string with placeholders) */
  body?: string
  /** Timeout in milliseconds */
  timeout?: number
}

/**
 * Union of all action types
 */
export type HookAction =
  | SpawnAgentAction
  | ShellAction
  | LogAction
  | NotifyAction
  | WebhookAction

// =============================================================================
// Hook Definition
// =============================================================================

/**
 * A single hook definition
 */
export interface Hook {
  /** Unique identifier for the hook */
  id: string
  /** Human-readable name */
  name: string
  /** Description of what this hook does */
  description?: string
  /** Event that triggers this hook */
  event: HookEventName
  /** Conditions that must be met (all must match - AND logic) */
  conditions?: HookCondition[]
  /** Actions to execute when conditions are met */
  actions: HookAction[]
  /** Whether the hook is enabled */
  enabled: boolean
  /** Priority (lower = runs first) */
  priority?: number
  /** Source of the hook definition */
  source: 'yaml' | 'database'
  /** Project ID this hook is scoped to (null = all projects) */
  projectId?: string
  /** Creation timestamp */
  createdAt?: Date
  /** Last updated timestamp */
  updatedAt?: Date
}

// =============================================================================
// Hook Configuration (YAML format)
// =============================================================================

/**
 * YAML configuration file structure for .proletariat/hooks.yaml
 */
export interface HooksYamlConfig {
  /** Schema version for future compatibility */
  version?: number
  /** Default settings for all hooks */
  defaults?: {
    /** Default enabled state */
    enabled?: boolean
    /** Default spawn_agent settings */
    spawn_agent?: Partial<SpawnAgentAction>
  }
  /** Hook definitions */
  hooks: HookYamlDefinition[]
}

/**
 * Hook definition as it appears in YAML
 */
export interface HookYamlDefinition {
  name: string
  description?: string
  event: HookEventName
  conditions?: HookCondition[]
  actions: HookAction[]
  enabled?: boolean
  priority?: number
  project?: string  // Project ID scope
}

// =============================================================================
// Hook Execution
// =============================================================================

/**
 * Result of executing a hook action
 */
export interface HookActionResult {
  /** Whether the action succeeded */
  success: boolean
  /** Action that was executed */
  action: HookAction
  /** Error message if failed */
  error?: string
  /** Output/result data from the action */
  output?: unknown
  /** Execution duration in milliseconds */
  duration?: number
}

/**
 * Result of executing a hook
 */
export interface HookExecutionResult {
  /** Hook that was executed */
  hook: Hook
  /** Event that triggered the hook */
  event: HookEventName
  /** Event payload */
  payload: HookEventPayload
  /** Whether all conditions matched */
  conditionsMatched: boolean
  /** Whether the hook was skipped (disabled or conditions not met) */
  skipped: boolean
  /** Results of each action */
  actionResults: HookActionResult[]
  /** Overall success (all actions succeeded) */
  success: boolean
  /** Total execution duration in milliseconds */
  duration: number
  /** Timestamp of execution */
  executedAt: Date
}

/**
 * Hook execution context - passed to action executors
 */
export interface HookExecutionContext {
  /** Event that triggered the hook */
  event: HookEventName
  /** Event payload */
  payload: HookEventPayload
  /** Hook being executed */
  hook: Hook
  /** Workspace path */
  workspacePath: string
  /** PMO path */
  pmoPath: string
  /** Logging function */
  log: (message: string) => void
}

/**
 * Work Lifecycle Hook Types
 *
 * Defines the configuration shape for hooks that fire on work lifecycle events.
 * Hooks are user-configurable actions that run when specific work events occur
 * (e.g., run a shell command when work starts, call a webhook when a PR is created).
 */

import type { RuntimeEventName } from '../../events/events.js'

/**
 * Work lifecycle event names that can trigger hooks.
 * Subset of RuntimeEventName limited to work-relevant events,
 * plus orchestrate daemon events for pipeline automation.
 */
export type HookableEvent = Extract<
  RuntimeEventName,
  | 'work:started'
  | 'work:status_changed'
  | 'work:pr_created'
  | 'work:pr_merged'
  | 'work:completed'
  | 'agent:spawned'
  | 'agent:stopped'
  | 'on_ci_green'
  | 'on_ci_failed'
  | 'on_pr_opened'
  | 'on_pr_merged'
  | 'on_pr_conflicting'
  | 'on_ticket_ready'
  | 'on_agent_spawned'
  | 'on_agent_died'
  | 'on_agent_completed'
  | 'on_agent_idle'
  | 'on_review_approved'
  | 'on_changes_requested'
  | 'on_version_published'
>

/** All hookable event names for validation. */
export const HOOKABLE_EVENTS: HookableEvent[] = [
  'work:started',
  'work:status_changed',
  'work:pr_created',
  'work:pr_merged',
  'work:completed',
  'agent:spawned',
  'agent:stopped',
  'on_ci_green',
  'on_ci_failed',
  'on_pr_opened',
  'on_pr_merged',
  'on_pr_conflicting',
  'on_ticket_ready',
  'on_agent_spawned',
  'on_agent_died',
  'on_agent_completed',
  'on_agent_idle',
  'on_review_approved',
  'on_changes_requested',
  'on_version_published',
]

/**
 * Action types that a hook can execute.
 *
 * - shell: Run a shell command (with event data as env vars)
 * - webhook: POST event data to a URL
 * - log: Write a message to stdout (useful for notifications/debugging)
 * - poke: Send a message to a named session (via tmux, no shell-out)
 * - action: Fire a named pmo_action directly (skip shell indirection)
 * - llm: Send to LLM for judgment/triage
 */
export type HookActionType = 'shell' | 'webhook' | 'log' | 'poke' | 'action' | 'llm'

/** All valid hook action types. */
export const HOOK_ACTION_TYPES: HookActionType[] = ['shell', 'webhook', 'log', 'poke', 'action', 'llm']

/**
 * Automation mode for a hook — determines the decision tier.
 *
 * Tier 1 (automatic, free, instant):
 * - auto: fires immediately, no decision needed
 * - notify: fires immediately but also sends a notification
 *
 * Tier 2 (LLM, costs tokens, has judgment):
 * - llm: routes to registered LLM orchestrator for approve/deny/escalate
 *
 * Tier 3 (human, most expensive, final authority):
 * - human: routes to human via notification (dashboard, Slack, email)
 * - confirm: pauses, waits for interactive approval before executing (legacy alias for human)
 *
 * Disabled:
 * - off: disabled, skipped silently
 */
export type HookMode = 'auto' | 'confirm' | 'notify' | 'llm' | 'human' | 'off'

/** All valid hook modes. */
export const HOOK_MODES: HookMode[] = ['auto', 'confirm', 'notify', 'llm', 'human', 'off']

/**
 * Decision tier for the 3-tier supervision tree.
 *
 * - auto: Tier 1 — deterministic, no decision needed
 * - llm: Tier 2 — LLM orchestrator decides (approve/deny/escalate)
 * - human: Tier 3 — human decides (final authority)
 */
export type DecisionTier = 'auto' | 'llm' | 'human'

/**
 * LLM orchestrator decision for a Tier 2 hook.
 *
 * - approve: execute the hook action
 * - deny: skip the hook action
 * - escalate: route to human (Tier 3) for final decision
 */
export type LlmDecision = 'approve' | 'deny' | 'escalate'

/**
 * Persisted hook configuration stored in the database.
 */
export interface WorkHookConfig {
  /** Unique hook ID (auto-generated UUID) */
  id: string
  /** Human-readable hook name */
  name: string
  /** Event that triggers this hook */
  event: HookableEvent
  /** Type of action to execute */
  actionType: HookActionType
  /** Action payload — shell command, webhook URL, log message template, or poke template */
  actionValue: string
  /** Reference to a named action definition (for action_type='action' or shared definitions) */
  actionRef: string | null
  /** Whether the hook is active */
  enabled: boolean
  /** Optional description */
  description: string | null
  /** When the hook was created */
  createdAt: string
  /** Automation mode (auto/confirm/notify/off) */
  mode: HookMode
  /** Execution priority (lower = higher priority) */
  priority: number
  /** Optional JSON config for built-in actions */
  config: Record<string, unknown> | null
}

/**
 * Row shape from the database (snake_case columns).
 */
export interface WorkHookRow {
  id: string
  name: string
  event: string
  action_type: string
  action_value: string
  action_ref: string | null
  enabled: number
  description: string | null
  created_at: string
  mode: string | null
  priority: number | null
  config: string | null
}

/**
 * Handler function for built-in actions injected into HookManager.
 * Receives event context and optional per-hook config, returns an execution result.
 */
export type HookActionHandler = (
  ctx: Record<string, unknown>,
  config?: Record<string, unknown>,
) => { action: string; success: boolean; error?: string; durationMs: number; skipped?: boolean }

/**
 * Result of executing a single hook.
 */
export interface HookExecutionResult {
  hookId: string
  hookName: string
  /** The resolved action name (built-in action or raw command) */
  action: string
  success: boolean
  error?: string
  /** Duration in ms */
  durationMs: number
  /** True when hook was skipped (mode=off or confirm denied) */
  skipped?: boolean
  /** True when hook is queued for confirmation (Tier 3 / human) */
  awaitingConfirmation?: boolean
  /** True when hook is queued for LLM decision (Tier 2) */
  awaitingLlmDecision?: boolean
  /** True when hook was escalated from LLM to human (Tier 2 → Tier 3) */
  escalatedToHuman?: boolean
  /** The decision tier that handled this hook */
  tier?: DecisionTier
}

// =============================================================================
// Event Payload Schemas
// =============================================================================

/**
 * Typed event payloads — each event carries a known set of fields.
 * Actions can reference these fields in templates: `{ticket_id}`, `{pr_number}`, `{author}`.
 */

export interface PrOpenedPayload {
  pr_number: number
  ticket_id?: string
  branch: string
  author: string
  repo?: string
}

export interface PrMergedPayload {
  pr_number: number
  ticket_id?: string
  branch: string
  merge_sha?: string
}

export interface CiGreenPayload {
  pr_number?: number
  ticket_id?: string
  check_suite_url?: string
}

export interface CiFailedPayload {
  pr_number?: number
  ticket_id?: string
  failed_checks?: string[]
}

export interface AgentCompletedPayload {
  agent_name: string
  ticket_id?: string
  execution_id?: string
  summary?: string
}

export interface AgentDiedPayload {
  agent_name: string
  ticket_id?: string
  execution_id?: string
  exit_code?: number
  error?: string
}

export interface PrCommentPayload {
  pr_number: number
  ticket_id?: string
  comment_id: number
  author: string
  body: string
  file?: string
  line?: number
}

/**
 * Map of event names to their payload field definitions.
 * Used for documentation and template validation.
 */
export const EVENT_PAYLOAD_FIELDS: Record<string, string[]> = {
  on_pr_opened: ['pr_number', 'ticket_id', 'branch', 'author', 'repo'],
  on_pr_merged: ['pr_number', 'ticket_id', 'branch', 'merge_sha'],
  on_ci_green: ['pr_number', 'ticket_id', 'check_suite_url'],
  on_ci_failed: ['pr_number', 'ticket_id', 'failed_checks'],
  on_agent_completed: ['agent_name', 'ticket_id', 'execution_id', 'summary'],
  on_agent_died: ['agent_name', 'ticket_id', 'execution_id', 'exit_code', 'error'],
  on_pr_comment: ['pr_number', 'ticket_id', 'comment_id', 'author', 'body', 'file', 'line'],
  on_agent_spawned: ['agent_name', 'ticket_id', 'execution_id'],
  on_agent_idle: ['agent_name', 'ticket_id', 'execution_id'],
  on_ticket_ready: ['ticket_id'],
  on_pr_conflicting: ['pr_number', 'ticket_id', 'branch'],
  on_review_approved: ['pr_number', 'ticket_id', 'author'],
  on_changes_requested: ['pr_number', 'ticket_id', 'author'],
  on_version_published: ['ticket_id', 'version'],
}

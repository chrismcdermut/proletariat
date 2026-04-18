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
 * - poke: Send a message to a named session (in-process, no shell)
 * - action: Fire a named built-in action directly (skip shell indirection)
 * - llm: Send to LLM for judgment (prompt template in config)
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
  /** Action payload — shell command, webhook URL, or log message template */
  actionValue: string
  /**
   * Reference to a shared action definition by name.
   * Used by action_type='action' to resolve a built-in action directly,
   * and by action_type='poke' to identify the target session.
   * Enables multiple events to point to the same definition without row duplication.
   */
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
 * Typed event payload definitions.
 * Each event carries a known set of fields that actions can reference
 * in templates via {field_name} syntax.
 */
export interface EventPayloadSchemas {
  on_pr_opened: { pr_number: number; ticket_id: string; branch: string; author: string; repo: string }
  on_pr_merged: { pr_number: number; ticket_id: string; branch: string; merge_sha: string }
  on_ci_green: { pr_number: number; ticket_id: string; check_suite_url: string }
  on_ci_failed: { pr_number: number; ticket_id: string; failed_checks: string[] }
  on_agent_completed: { agent_name: string; ticket_id: string; execution_id: string; summary: string }
  on_agent_died: { agent_name: string; ticket_id: string; execution_id: string; exit_code: number; error: string }
  on_pr_comment: { pr_number: number; ticket_id: string; comment_id: string; author: string; body: string; file: string; line: number }
  on_ticket_ready: { ticket_id: string }
  on_agent_spawned: { agent_name: string; ticket_id: string; execution_id: string }
  on_agent_idle: { agent_name: string; ticket_id: string }
  on_review_approved: { pr_number: number; ticket_id: string; reviewer: string }
  on_changes_requested: { pr_number: number; ticket_id: string; reviewer: string }
  on_pr_conflicting: { pr_number: number; ticket_id: string; branch: string }
  on_version_published: { version: string; ticket_id: string }
}

/**
 * Field names available for each event, used for documentation and validation.
 */
export const EVENT_PAYLOAD_FIELDS: Record<string, string[]> = {
  on_pr_opened: ['pr_number', 'ticket_id', 'branch', 'author', 'repo'],
  on_pr_merged: ['pr_number', 'ticket_id', 'branch', 'merge_sha'],
  on_ci_green: ['pr_number', 'ticket_id', 'check_suite_url'],
  on_ci_failed: ['pr_number', 'ticket_id', 'failed_checks'],
  on_agent_completed: ['agent_name', 'ticket_id', 'execution_id', 'summary'],
  on_agent_died: ['agent_name', 'ticket_id', 'execution_id', 'exit_code', 'error'],
  on_pr_comment: ['pr_number', 'ticket_id', 'comment_id', 'author', 'body', 'file', 'line'],
  on_ticket_ready: ['ticket_id'],
  on_agent_spawned: ['agent_name', 'ticket_id', 'execution_id'],
  on_agent_idle: ['agent_name', 'ticket_id'],
  on_review_approved: ['pr_number', 'ticket_id', 'reviewer'],
  on_changes_requested: ['pr_number', 'ticket_id', 'reviewer'],
  on_pr_conflicting: ['pr_number', 'ticket_id', 'branch'],
  on_version_published: ['version', 'ticket_id'],
}

// =============================================================================
// Poke Action Config
// =============================================================================

/**
 * Config schema for action_type='poke'.
 * Stored in the hook's JSON config column.
 */
export interface PokeActionConfig {
  /** Target session name to poke (e.g. 'orchestrator-main') */
  target: string
  /** Message template with {field} placeholders */
  template: string
}

/**
 * Config schema for action_type='llm'.
 * Stored in the hook's JSON config column.
 */
export interface LlmActionConfig {
  /** Prompt template with {field} placeholders */
  prompt: string
}

/**
 * Interpolate {variable} placeholders in a template string with event data.
 * Supports both {field} and {{field}} syntax for backward compatibility.
 */
export function interpolateTemplate(template: string, data: Record<string, unknown>): string {
  let result = template

  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) continue
    const strValue = value instanceof Date
      ? value.toISOString()
      : Array.isArray(value)
        ? value.join(', ')
        : String(value)

    // Replace {key} syntax
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), strValue)
    // Also replace {{key}} syntax for backward compat
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), strValue)
  }

  return result
}

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
  'on_version_published',
]

/**
 * Action types that a hook can execute.
 *
 * - shell: Run a shell command (with event data as env vars)
 * - webhook: POST event data to a URL
 * - log: Write a message to stdout (useful for notifications/debugging)
 */
export type HookActionType = 'shell' | 'webhook' | 'log'

/**
 * Automation mode for a hook.
 *
 * - auto: fires immediately, no human needed
 * - confirm: pauses, waits for approval before executing
 * - notify: fires immediately but also sends a notification
 * - off: disabled, skipped silently
 */
export type HookMode = 'auto' | 'confirm' | 'notify' | 'off'

/** All valid hook modes. */
export const HOOK_MODES: HookMode[] = ['auto', 'confirm', 'notify', 'off']

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
  /** True when hook is queued for confirmation */
  awaitingConfirmation?: boolean
}

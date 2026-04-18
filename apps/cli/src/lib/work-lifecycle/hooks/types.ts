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
 * - action: Call a built-in action handler directly (no shell, in-process)
 */
export type HookActionType = 'shell' | 'webhook' | 'log' | 'action'

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
 * Result shape for built-in action handlers.
 */
export interface HookActionHandlerResult {
  action: string
  success: boolean
  error?: string
  durationMs: number
  skipped?: boolean
}

/**
 * Handler function for built-in actions injected into HookManager.
 * Receives event context and optional per-hook config, returns an execution result.
 * Handlers may be sync or async — callers always await the result.
 */
export type HookActionHandler = (
  ctx: Record<string, unknown>,
  config?: Record<string, unknown>,
) => HookActionHandlerResult | Promise<HookActionHandlerResult>

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

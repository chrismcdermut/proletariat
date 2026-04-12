/**
 * Work Lifecycle Hook Manager
 *
 * The single hook execution system for the entire application.
 * Subscribes to work lifecycle events on the global EventBus and
 * executes matching hook configurations from the database with
 * mode-aware behavior (auto/confirm/notify/llm/human/off).
 *
 * Used by both the interactive CLI (with default auto mode) and
 * the orchestrate daemon (with full mode/callback support).
 *
 * Hooks are fire-and-forget when triggered via EventBus: execution
 * failures are logged but never block the caller or break the event
 * emission chain.
 */

import { execSync } from 'node:child_process'
import type Database from 'better-sqlite3'
import { getEventBus } from '../../events/event-bus.js'
import { WorkHookStorage } from './storage.js'
import { executeHook } from './executor.js'
import {
  HOOKABLE_EVENTS,
  type HookableEvent,
  type HookExecutionResult,
  type HookActionHandler,
  type WorkHookConfig,
  type LlmDecision,
} from './types.js'
import {
  DEFAULT_LLM_TIMEOUT_MS,
  type EscalationContext,
  type EscalationReason,
  type PendingLlmDecision,
  type PendingHumanEscalation,
} from '../../orchestrate/escalation.js'

// =============================================================================
// Options
// =============================================================================

/**
 * Options for creating a HookManager.
 */
export interface HookManagerOptions {
  /** Database connection */
  db: Database.Database
  /** Logger function */
  log?: (msg: string) => void
  /** Callback for confirm-mode hooks (returns true to approve) */
  onConfirm?: (hookName: string, event: string, action: string) => Promise<boolean>
  /** Callback for notifications (notify-mode hooks) */
  onNotify?: (hookName: string, event: string, action: string, result: HookExecutionResult) => void
  /**
   * Callback for LLM-mode hooks (Tier 2).
   * Receives escalation context, returns LLM decision: approve/deny/escalate.
   * If not provided, LLM decisions are queued in pendingLlmDecisions.
   */
  onLlmDecision?: (context: EscalationContext) => Promise<LlmDecision>
  /**
   * Callback for human-mode hooks (Tier 3).
   * Called when a hook needs human approval — either directly (mode=human/confirm)
   * or via escalation from LLM tier.
   * Returns true to approve, false to deny.
   * If not provided, human escalations are queued in pendingHumanEscalations.
   */
  onHumanEscalation?: (context: EscalationContext, reason: EscalationReason) => Promise<boolean>
  /**
   * Timeout in ms for LLM decisions before auto-escalating to human.
   * Defaults to DEFAULT_LLM_TIMEOUT_MS (5 minutes).
   */
  llmTimeoutMs?: number
  /**
   * Built-in action handlers (e.g., merge-pr, spawn-agent).
   * When a hook's action resolves to a key in this map, the handler
   * is called instead of shell/webhook/log execution.
   */
  actionHandlers?: Record<string, HookActionHandler>
}

// =============================================================================
// Pending Confirmation
// =============================================================================

interface PendingConfirmation {
  hookName: string
  event: string
  action: string
  ctx: Record<string, unknown>
  config?: Record<string, unknown>
}

// =============================================================================
// Manager
// =============================================================================

/**
 * HookManager loads hook configs from the database and subscribes to
 * the global EventBus. When a hookable event fires, it finds all
 * enabled hooks for that event and executes them with mode-aware behavior.
 */
export class HookManager {
  private unsubscribers: Array<() => void> = []
  private hookStorage: WorkHookStorage
  private db: Database.Database
  private log: (msg: string) => void
  private onConfirm?: (hookName: string, event: string, action: string) => Promise<boolean>
  private onNotify?: (hookName: string, event: string, action: string, result: HookExecutionResult) => void
  private onLlmDecision?: (context: EscalationContext) => Promise<LlmDecision>
  private onHumanEscalation?: (context: EscalationContext, reason: EscalationReason) => Promise<boolean>
  private llmTimeoutMs: number
  private actionHandlers: Record<string, HookActionHandler>
  private _pendingConfirmations: PendingConfirmation[] = []
  private _pendingLlmDecisions: PendingLlmDecision[] = []
  private _pendingHumanEscalations: PendingHumanEscalation[] = []

  constructor(options: HookManagerOptions) {
    this.db = options.db
    this.hookStorage = new WorkHookStorage(options.db)
    this.log = options.log ?? (() => {})
    this.onConfirm = options.onConfirm
    this.onNotify = options.onNotify
    this.onLlmDecision = options.onLlmDecision
    this.onHumanEscalation = options.onHumanEscalation
    this.llmTimeoutMs = options.llmTimeoutMs ?? DEFAULT_LLM_TIMEOUT_MS
    this.actionHandlers = options.actionHandlers ?? {}
  }

  /**
   * Start listening for hookable events on the global EventBus.
   * For each event, looks up enabled hooks and executes them.
   */
  start(): void {
    const bus = getEventBus()

    for (const eventName of HOOKABLE_EVENTS) {
      this.unsubscribers.push(
        bus.on(eventName, (payload) => {
          void this.handleEvent(eventName, payload as unknown as Record<string, unknown>)
        }),
      )
    }
  }

  /**
   * Stop listening for events and clean up subscriptions.
   */
  stop(): void {
    for (const unsub of this.unsubscribers) {
      unsub()
    }
    this.unsubscribers = []
    this._pendingConfirmations = []
    this._pendingLlmDecisions = []
    this._pendingHumanEscalations = []
  }

  /**
   * Fire an event explicitly (used by orchestrate daemon and `prlt hook fire`).
   * Returns the execution results for all matching hooks.
   */
  async fireEvent(event: string, eventData: Record<string, unknown>): Promise<HookExecutionResult[]> {
    return this.handleEvent(event, eventData)
  }

  /**
   * Get pending confirmations for hooks in confirm mode.
   */
  getPendingConfirmations(): PendingConfirmation[] {
    return [...this._pendingConfirmations]
  }

  /**
   * Approve a pending confirmation and execute it.
   */
  async approveConfirmation(index: number): Promise<HookExecutionResult | null> {
    if (index < 0 || index >= this._pendingConfirmations.length) return null

    const pending = this._pendingConfirmations.splice(index, 1)[0]
    const result = this.executeActionByName(pending.action, pending.ctx, pending.config)

    this.log(`[hooks] Approved: ${pending.hookName} → ${pending.action} (${result.success ? 'success' : 'failed'})`)
    return result
  }

  /**
   * Deny a pending confirmation.
   */
  denyConfirmation(index: number): boolean {
    if (index < 0 || index >= this._pendingConfirmations.length) return false

    const pending = this._pendingConfirmations.splice(index, 1)[0]
    this.log(`[hooks] Denied: ${pending.hookName} → ${pending.action}`)
    return true
  }

  // ===========================================================================
  // LLM Decision Queue (Tier 2)
  // ===========================================================================

  /**
   * Get pending LLM decisions for hooks in llm mode.
   */
  getPendingLlmDecisions(): PendingLlmDecision[] {
    return [...this._pendingLlmDecisions]
  }

  /**
   * Approve a pending LLM decision and execute it.
   */
  async approveLlmDecision(index: number): Promise<HookExecutionResult | null> {
    if (index < 0 || index >= this._pendingLlmDecisions.length) return null

    const pending = this._pendingLlmDecisions.splice(index, 1)[0]
    const result = this.executeActionByName(pending.action, pending.ctx, pending.config)

    this.log(`[hooks] LLM approved: ${pending.hookName} → ${pending.action} (${result.success ? 'success' : 'failed'})`)
    return { ...result, tier: 'llm' }
  }

  /**
   * Deny a pending LLM decision.
   */
  denyLlmDecision(index: number): boolean {
    if (index < 0 || index >= this._pendingLlmDecisions.length) return false

    const pending = this._pendingLlmDecisions.splice(index, 1)[0]
    this.log(`[hooks] LLM denied: ${pending.hookName} → ${pending.action}`)
    return true
  }

  /**
   * Escalate a pending LLM decision to human tier.
   * Removes from LLM queue and adds to human escalation queue.
   */
  escalateLlmDecision(index: number): boolean {
    if (index < 0 || index >= this._pendingLlmDecisions.length) return false

    const pending = this._pendingLlmDecisions.splice(index, 1)[0]
    this._pendingHumanEscalations.push({
      hookName: pending.hookName,
      event: pending.event,
      action: pending.action,
      ctx: pending.ctx,
      config: pending.config,
      queuedAt: Date.now(),
      reason: 'llm_escalate',
    })
    this.log(`[hooks] LLM escalated to human: ${pending.hookName} → ${pending.action}`)
    return true
  }

  /**
   * Check for timed-out LLM decisions and auto-escalate them to human tier.
   * Returns the number of decisions that were escalated.
   */
  escalateTimedOutLlmDecisions(): number {
    const now = Date.now()
    let escalated = 0
    // Iterate in reverse to safely splice
    for (let i = this._pendingLlmDecisions.length - 1; i >= 0; i--) {
      const decision = this._pendingLlmDecisions[i]
      if ((now - decision.queuedAt) >= decision.timeoutMs) {
        this._pendingLlmDecisions.splice(i, 1)
        this._pendingHumanEscalations.push({
          hookName: decision.hookName,
          event: decision.event,
          action: decision.action,
          ctx: decision.ctx,
          config: decision.config,
          queuedAt: decision.queuedAt,
          reason: 'llm_timeout',
        })
        this.log(`[hooks] LLM timeout → escalated to human: ${decision.hookName} → ${decision.action}`)
        escalated++
      }
    }
    return escalated
  }

  // ===========================================================================
  // Human Escalation Queue (Tier 3)
  // ===========================================================================

  /**
   * Get pending human escalations.
   */
  getPendingHumanEscalations(): PendingHumanEscalation[] {
    return [...this._pendingHumanEscalations]
  }

  /**
   * Approve a pending human escalation and execute it.
   */
  async approveHumanEscalation(index: number): Promise<HookExecutionResult | null> {
    if (index < 0 || index >= this._pendingHumanEscalations.length) return null

    const pending = this._pendingHumanEscalations.splice(index, 1)[0]
    const result = this.executeActionByName(pending.action, pending.ctx, pending.config)

    this.log(`[hooks] Human approved: ${pending.hookName} → ${pending.action} (${result.success ? 'success' : 'failed'})`)
    return { ...result, tier: 'human' }
  }

  /**
   * Deny a pending human escalation.
   */
  denyHumanEscalation(index: number): boolean {
    if (index < 0 || index >= this._pendingHumanEscalations.length) return false

    const pending = this._pendingHumanEscalations.splice(index, 1)[0]
    this.log(`[hooks] Human denied: ${pending.hookName} → ${pending.action}`)
    return true
  }

  // ===========================================================================
  // Testable Utilities (public for PRLT-1223 test suite)
  // ===========================================================================

  /**
   * Build a context object from raw event data.
   * Normalizes common field names for built-in action handlers.
   *
   * Public so it can be tested in isolation.
   */
  static buildContext(eventName: string, data: Record<string, unknown>): Record<string, unknown> {
    return {
      event: eventName,
      ticket: (data.ticketId ?? data.workItemId ?? data.ticket) as string | undefined,
      pr: (data.prNumber ?? data.pr) as number | undefined,
      branch: data.branch as string | undefined,
      agent: (data.agentName ?? data.agent ?? data.sessionId) as string | undefined,
      container: data.containerId as string | undefined,
      executionId: data.executionId as string | undefined,
      prUrl: data.prUrl as string | undefined,
      projectId: data.projectId as string | undefined,
      ...data,
    }
  }

  /**
   * Resolve the action name from a hook config and a set of known action handlers.
   *
   * - If the action_value contains `--action <name>`, extracts the name
   * - If the action_value is a known built-in action, uses it directly
   * - Otherwise uses the raw action_value (shell command)
   *
   * Public so it can be tested in isolation.
   */
  static resolveActionName(hook: WorkHookConfig, knownActions: Record<string, unknown> = {}): string {
    // If the action_value contains --action, extract the action name
    const actionMatch = hook.actionValue.match(/--action\s+(\S+)/)
    if (actionMatch) return actionMatch[1]

    // If it's a known built-in action name directly
    if (knownActions[hook.actionValue]) return hook.actionValue

    // Otherwise it's a raw shell command — use the action_value as-is
    return hook.actionValue
  }

  // ===========================================================================
  // Private
  // ===========================================================================

  /**
   * Handle an event by finding and executing all matching enabled hooks.
   * Supports mode-aware execution: auto, confirm, notify, llm, human, off.
   */
  private async handleEvent(eventName: string, eventData: Record<string, unknown>): Promise<HookExecutionResult[]> {
    const results: HookExecutionResult[] = []

    try {
      const hooks = this.hookStorage.list({ event: eventName as HookableEvent, enabled: true })
      if (hooks.length === 0) return results

      // Build context from the payload
      const ctx = HookManager.buildContext(eventName, eventData)

      for (const hook of hooks) {
        const mode = hook.mode || 'auto'
        const actionName = HookManager.resolveActionName(hook, this.actionHandlers)

        // --- off: skip silently ---
        if (mode === 'off') {
          results.push({
            hookId: hook.id,
            hookName: hook.name,
            action: actionName,
            success: true,
            durationMs: 0,
            skipped: true,
          })
          continue
        }

        // --- llm: route to LLM orchestrator (Tier 2) ---
        if (mode === 'llm') {
          const escalationCtx: EscalationContext = {
            hookName: hook.name,
            event: eventName,
            action: actionName,
            ctx,
            config: hook.config ?? undefined,
          }

          if (this.onLlmDecision) {
            const decision = await this.onLlmDecision(escalationCtx)

            if (decision === 'deny') {
              this.log(`[hooks] LLM denied: ${hook.name} → ${actionName}`)
              results.push({
                hookId: hook.id,
                hookName: hook.name,
                action: actionName,
                success: true,
                durationMs: 0,
                skipped: true,
                tier: 'llm',
              })
              continue
            }

            if (decision === 'escalate') {
              // LLM escalated to human tier
              this.log(`[hooks] LLM escalated to human: ${hook.name} → ${actionName}`)

              if (this.onHumanEscalation) {
                const humanApproved = await this.onHumanEscalation(escalationCtx, 'llm_escalate')
                if (!humanApproved) {
                  results.push({
                    hookId: hook.id,
                    hookName: hook.name,
                    action: actionName,
                    success: true,
                    durationMs: 0,
                    skipped: true,
                    escalatedToHuman: true,
                    tier: 'human',
                  })
                  continue
                }
                // Human approved — fall through to execution
                const result = this.executeHookAction(hook, eventName, eventData, ctx)
                results.push({ ...result, escalatedToHuman: true, tier: 'human' })
                this.log(`[hooks] ${hook.name} → ${actionName}: ${result.success ? 'success' : `failed: ${result.error}`} (${result.durationMs}ms) [escalated to human]`)
                continue
              } else {
                // No human handler — queue for human approval
                this._pendingHumanEscalations.push({
                  ...escalationCtx,
                  queuedAt: Date.now(),
                  reason: 'llm_escalate',
                })
                results.push({
                  hookId: hook.id,
                  hookName: hook.name,
                  action: actionName,
                  success: true,
                  durationMs: 0,
                  escalatedToHuman: true,
                  awaitingConfirmation: true,
                  tier: 'human',
                })
                continue
              }
            }

            // decision === 'approve' — fall through to execution
          } else {
            // No LLM handler — queue for later LLM decision
            this._pendingLlmDecisions.push({
              ...escalationCtx,
              queuedAt: Date.now(),
              timeoutMs: this.llmTimeoutMs,
            })
            this.log(`[hooks] Queued for LLM decision: ${hook.name} → ${actionName}`)
            results.push({
              hookId: hook.id,
              hookName: hook.name,
              action: actionName,
              success: true,
              durationMs: 0,
              awaitingLlmDecision: true,
              tier: 'llm',
            })
            continue
          }
        }

        // --- human: route to human (Tier 3) ---
        if (mode === 'human') {
          const escalationCtx: EscalationContext = {
            hookName: hook.name,
            event: eventName,
            action: actionName,
            ctx,
            config: hook.config ?? undefined,
          }

          if (this.onHumanEscalation) {
            const approved = await this.onHumanEscalation(escalationCtx, 'direct')
            if (!approved) {
              this.log(`[hooks] Human denied: ${hook.name} → ${actionName}`)
              results.push({
                hookId: hook.id,
                hookName: hook.name,
                action: actionName,
                success: true,
                durationMs: 0,
                skipped: true,
                tier: 'human',
              })
              continue
            }
            // Approved — fall through to execution
          } else {
            // No human handler — queue for later approval
            this._pendingHumanEscalations.push({
              ...escalationCtx,
              queuedAt: Date.now(),
              reason: 'direct',
            })
            this.log(`[hooks] Queued for human approval: ${hook.name} → ${actionName}`)
            results.push({
              hookId: hook.id,
              hookName: hook.name,
              action: actionName,
              success: true,
              durationMs: 0,
              awaitingConfirmation: true,
              tier: 'human',
            })
            continue
          }
        }

        // --- confirm: require approval (legacy alias for human) ---
        if (mode === 'confirm') {
          if (this.onConfirm) {
            const approved = await this.onConfirm(hook.name, eventName, actionName)
            if (!approved) {
              this.log(`[hooks] Skipped (not confirmed): ${hook.name} → ${actionName}`)
              results.push({
                hookId: hook.id,
                hookName: hook.name,
                action: actionName,
                success: true,
                durationMs: 0,
                skipped: true,
                tier: 'human',
              })
              continue
            }
            // Approved — fall through to execution
          } else if (this.onHumanEscalation) {
            // Use human escalation callback as fallback for confirm mode
            const escalationCtx: EscalationContext = {
              hookName: hook.name,
              event: eventName,
              action: actionName,
              ctx,
              config: hook.config ?? undefined,
            }
            const approved = await this.onHumanEscalation(escalationCtx, 'direct')
            if (!approved) {
              this.log(`[hooks] Human denied (confirm mode): ${hook.name} → ${actionName}`)
              results.push({
                hookId: hook.id,
                hookName: hook.name,
                action: actionName,
                success: true,
                durationMs: 0,
                skipped: true,
                tier: 'human',
              })
              continue
            }
            // Approved — fall through to execution
          } else {
            // No confirm handler — queue for later approval
            this._pendingConfirmations.push({
              hookName: hook.name,
              event: eventName,
              action: actionName,
              ctx,
              config: hook.config ?? undefined,
            })
            this.log(`[hooks] Queued for confirmation: ${hook.name} → ${actionName}`)
            results.push({
              hookId: hook.id,
              hookName: hook.name,
              action: actionName,
              success: true,
              durationMs: 0,
              awaitingConfirmation: true,
              tier: 'human',
            })
            continue
          }
        }

        // --- auto / notify / confirmed / llm-approved / human-approved: execute ---
        const result = this.executeHookAction(hook, eventName, eventData, ctx)
        results.push(result)

        this.log(
          `[hooks] ${hook.name} → ${actionName}: ${result.success ? 'success' : `failed: ${result.error}`} (${result.durationMs}ms)`,
        )

        // For notify mode, also fire the notification callback
        if (mode === 'notify' && this.onNotify) {
          this.onNotify(hook.name, eventName, actionName, result)
        }
      }
    } catch (err) {
      this.log(`[hooks] Error handling event ${eventName}: ${err instanceof Error ? err.message : String(err)}`)
    }

    return results
  }

  /**
   * Execute a hook action — either via a built-in handler or the standard executor.
   */
  private executeHookAction(
    hook: WorkHookConfig,
    eventName: string,
    eventData: Record<string, unknown>,
    ctx: Record<string, unknown>,
  ): HookExecutionResult {
    const actionName = HookManager.resolveActionName(hook, this.actionHandlers)

    // Try built-in action handler first
    if (this.actionHandlers[actionName]) {
      const handlerResult = this.actionHandlers[actionName](ctx, hook.config ?? undefined)
      return {
        hookId: hook.id,
        hookName: hook.name,
        action: handlerResult.action,
        success: handlerResult.success,
        error: handlerResult.error,
        durationMs: handlerResult.durationMs,
        skipped: handlerResult.skipped,
      }
    }

    // For shell/webhook/log hooks, use the standard executor
    const result = executeHook(hook, eventName, eventData)
    return {
      ...result,
      action: actionName,
    }
  }

  /**
   * Execute an action by name (used for approved confirmations).
   */
  private executeActionByName(
    actionName: string,
    ctx: Record<string, unknown>,
    config?: Record<string, unknown>,
  ): HookExecutionResult {
    // Try built-in action handler first
    if (this.actionHandlers[actionName]) {
      const handlerResult = this.actionHandlers[actionName](ctx, config)
      return {
        hookId: '',
        hookName: '',
        action: handlerResult.action,
        success: handlerResult.success,
        error: handlerResult.error,
        durationMs: handlerResult.durationMs,
        skipped: handlerResult.skipped,
      }
    }

    // Fallback to shell execution
    const start = Date.now()
    try {
      const env = {
        ...process.env,
        PRLT_HOOK_EVENT: (ctx.event as string) ?? '',
        PRLT_HOOK_TICKET: (ctx.ticket as string) ?? '',
        PRLT_HOOK_PR: ctx.pr ? String(ctx.pr) : '',
        PRLT_HOOK_BRANCH: (ctx.branch as string) ?? '',
        PRLT_HOOK_AGENT: (ctx.agent as string) ?? '',
      }
      execSync(actionName, { env, timeout: 30_000, stdio: 'pipe' })
      return { hookId: '', hookName: '', action: actionName, success: true, durationMs: Date.now() - start }
    } catch (err) {
      return {
        hookId: '', hookName: '', action: actionName, success: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      }
    }
  }
}

// =============================================================================
// Singleton
// =============================================================================

let _manager: HookManager | undefined

/**
 * Initialize and start the hook manager.
 * Safe to call multiple times — subsequent calls are no-ops.
 *
 * When called with just a db (interactive CLI), hooks default to auto mode.
 * Pass additional options for mode-aware execution (orchestrate daemon).
 */
export function initHookManager(db: Database.Database, options?: Omit<HookManagerOptions, 'db'>): HookManager {
  if (!_manager) {
    _manager = new HookManager({ db, ...options })
    _manager.start()
  }
  return _manager
}

/**
 * Stop the hook manager (primarily for testing).
 */
export function stopHookManager(): void {
  if (_manager) {
    _manager.stop()
    _manager = undefined
  }
}

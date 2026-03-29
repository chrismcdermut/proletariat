/**
 * Work Lifecycle Hook Manager
 *
 * The single hook execution system for the entire application.
 * Subscribes to work lifecycle events on the global EventBus and
 * executes matching hook configurations from the database with
 * mode-aware behavior (auto/confirm/notify/off).
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
  type HookMode,
  type HookExecutionResult,
  type HookActionHandler,
  type WorkHookConfig,
} from './types.js'

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
  private actionHandlers: Record<string, HookActionHandler>
  private _pendingConfirmations: PendingConfirmation[] = []

  constructor(options: HookManagerOptions) {
    this.db = options.db
    this.hookStorage = new WorkHookStorage(options.db)
    this.log = options.log ?? (() => {})
    this.onConfirm = options.onConfirm
    this.onNotify = options.onNotify
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
  // Private
  // ===========================================================================

  /**
   * Handle an event by finding and executing all matching enabled hooks.
   * Supports mode-aware execution: auto, confirm, notify, off.
   */
  private async handleEvent(eventName: string, eventData: Record<string, unknown>): Promise<HookExecutionResult[]> {
    const results: HookExecutionResult[] = []

    try {
      const hooks = this.hookStorage.list({ event: eventName as HookableEvent, enabled: true })
      if (hooks.length === 0) return results

      // Build context from the payload
      const ctx = this.buildContext(eventName, eventData)

      for (const hook of hooks) {
        const mode = hook.mode || 'auto'
        const actionName = this.resolveActionName(hook)

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

        // --- confirm: require approval ---
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
            })
            continue
          }
        }

        // --- auto / notify / confirmed: execute ---
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
   * Build a context object from raw event data.
   * Normalizes common field names for built-in action handlers.
   */
  private buildContext(eventName: string, data: Record<string, unknown>): Record<string, unknown> {
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
   * Resolve the action name from a hook config.
   * Built-in actions are referenced by name; shell hooks use the raw command.
   */
  private resolveActionName(hook: WorkHookConfig): string {
    // If the action_value contains --action, extract the action name
    const actionMatch = hook.actionValue.match(/--action\s+(\S+)/)
    if (actionMatch) return actionMatch[1]

    // If it's a known built-in action name directly
    if (this.actionHandlers[hook.actionValue]) return hook.actionValue

    // Otherwise it's a raw shell command — use the action_value as-is
    return hook.actionValue
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
    const actionName = this.resolveActionName(hook)

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

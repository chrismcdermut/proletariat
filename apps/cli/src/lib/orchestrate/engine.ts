/**
 * Orchestrate Engine
 *
 * The core daemon loop that:
 * 1. Loads hook configuration from DB (synced from YAML/presets/CLI)
 * 2. Subscribes to EventBus events
 * 3. Executes matching hooks with mode-aware behavior
 * 4. Optionally polls external sources for events
 *
 * The engine extends the existing HookManager with mode support
 * and built-in action execution.
 */

import { execSync } from 'node:child_process'
import type Database from 'better-sqlite3'
import { getEventBus } from '../events/event-bus.js'
import { WorkHookStorage } from '../work-lifecycle/hooks/storage.js'
import { executeBuiltinAction, ACTION_HANDLERS } from './actions.js'
import type {
  OrchestrateEvent,
  OrchestrateEventContext,
  OrchestrateActionResult,
  HookMode,
} from './types.js'
import { ORCHESTRATE_EVENTS } from './types.js'

// =============================================================================
// Extended Hook Row (includes mode, priority, config)
// =============================================================================

interface ExtendedHookRow {
  id: string
  name: string
  event: string
  action_type: string
  action_value: string
  enabled: number
  description: string | null
  mode: string | null
  priority: number | null
  config: string | null
}

// =============================================================================
// Engine
// =============================================================================

export interface OrchestrateEngineOptions {
  /** Database connection */
  db: Database.Database
  /** Logger function */
  log?: (msg: string) => void
  /** Callback for confirm-mode hooks (returns true to approve) */
  onConfirm?: (hookName: string, event: string, action: string) => Promise<boolean>
  /** Callback for notifications */
  onNotify?: (hookName: string, event: string, action: string, result: OrchestrateActionResult) => void
}

export class OrchestrateEngine {
  private db: Database.Database
  private hookStorage: WorkHookStorage
  private unsubscribers: Array<() => void> = []
  private log: (msg: string) => void
  private onConfirm?: (hookName: string, event: string, action: string) => Promise<boolean>
  private onNotify?: (hookName: string, event: string, action: string, result: OrchestrateActionResult) => void
  private running = false
  private pendingConfirmations: Array<{
    hookName: string
    event: string
    action: string
    ctx: OrchestrateEventContext
    config?: Record<string, unknown>
  }> = []

  constructor(options: OrchestrateEngineOptions) {
    this.db = options.db
    this.hookStorage = new WorkHookStorage(options.db)
    this.log = options.log ?? (() => {})
    this.onConfirm = options.onConfirm
    this.onNotify = options.onNotify
  }

  /**
   * Start the orchestrate engine — subscribe to all orchestrate events.
   */
  start(): void {
    if (this.running) return
    this.running = true

    const bus = getEventBus()

    // Subscribe to standard RuntimeEventMap events
    const standardEvents: Array<keyof import('../events/events.js').RuntimeEventMap> = [
      'work:started',
      'work:status_changed',
      'work:pr_created',
      'work:pr_merged',
      'work:pr_closed',
      'work:completed',
      'agent:spawned',
      'agent:stopped',
    ]

    for (const eventName of standardEvents) {
      this.unsubscribers.push(
        bus.on(eventName, (payload) => {
          void this.handleEvent(eventName, payload as unknown as Record<string, unknown>)
        }),
      )
    }

    this.log('[orchestrate] Engine started, listening for events')
  }

  /**
   * Stop the engine and clean up subscriptions.
   */
  stop(): void {
    this.running = false
    for (const unsub of this.unsubscribers) {
      unsub()
    }
    this.unsubscribers = []
    this.pendingConfirmations = []
    this.log('[orchestrate] Engine stopped')
  }

  /**
   * Fire an event manually (used by `prlt hook fire`).
   * This is the entry point for external event sources (GitHub Actions, polling, etc.).
   */
  async fireEvent(event: string, ctx: OrchestrateEventContext): Promise<OrchestrateActionResult[]> {
    return this.handleEvent(event, ctx as Record<string, unknown>)
  }

  /**
   * Get pending confirmations for hooks in confirm mode.
   */
  getPendingConfirmations(): typeof this.pendingConfirmations {
    return [...this.pendingConfirmations]
  }

  /**
   * Approve a pending confirmation and execute it.
   */
  async approveConfirmation(index: number): Promise<OrchestrateActionResult | null> {
    if (index < 0 || index >= this.pendingConfirmations.length) return null

    const pending = this.pendingConfirmations.splice(index, 1)[0]
    const result = executeBuiltinAction(pending.action, pending.ctx, pending.config)

    this.log(`[orchestrate] Approved: ${pending.hookName} → ${pending.action} (${result.success ? 'success' : 'failed'})`)
    return result
  }

  /**
   * Deny a pending confirmation.
   */
  denyConfirmation(index: number): boolean {
    if (index < 0 || index >= this.pendingConfirmations.length) return false

    const pending = this.pendingConfirmations.splice(index, 1)[0]
    this.log(`[orchestrate] Denied: ${pending.hookName} → ${pending.action}`)
    return true
  }

  // ===========================================================================
  // Private
  // ===========================================================================

  /**
   * Handle an event by finding and executing matching hooks.
   */
  private async handleEvent(eventName: string, eventData: Record<string, unknown>): Promise<OrchestrateActionResult[]> {
    const results: OrchestrateActionResult[] = []

    try {
      // Query hooks matching this event, ordered by priority
      const hooks = this.getHooksForEvent(eventName)
      if (hooks.length === 0) return results

      // Build event context from the payload
      const ctx = this.buildContext(eventName, eventData)

      for (const hook of hooks) {
        const mode = (hook.mode || 'auto') as HookMode
        const config = hook.config ? JSON.parse(hook.config) as Record<string, unknown> : undefined

        // Determine action — either a built-in action name or the raw action_value
        const actionName = this.resolveActionName(hook)

        if (mode === 'off') {
          results.push({ action: actionName, success: true, durationMs: 0, skipped: true })
          continue
        }

        if (mode === 'confirm') {
          // Queue for confirmation
          if (this.onConfirm) {
            const approved = await this.onConfirm(hook.name, eventName, actionName)
            if (!approved) {
              this.log(`[orchestrate] Skipped (not confirmed): ${hook.name} → ${actionName}`)
              results.push({ action: actionName, success: true, durationMs: 0, skipped: true })
              continue
            }
          } else {
            // No confirm handler — queue for later approval
            this.pendingConfirmations.push({
              hookName: hook.name,
              event: eventName,
              action: actionName,
              ctx,
              config,
            })
            this.log(`[orchestrate] Queued for confirmation: ${hook.name} → ${actionName}`)
            results.push({ action: actionName, success: true, durationMs: 0, awaitingConfirmation: true })
            continue
          }
        }

        // Execute the action
        const result = this.executeAction(actionName, ctx, config)
        results.push(result)

        this.log(
          `[orchestrate] ${hook.name} → ${actionName}: ${result.success ? 'success' : `failed: ${result.error}`} (${result.durationMs}ms)`
        )

        // For notify mode, also fire the notification callback
        if (mode === 'notify' && this.onNotify) {
          this.onNotify(hook.name, eventName, actionName, result)
        }
      }
    } catch (err) {
      this.log(`[orchestrate] Error handling event ${eventName}: ${err instanceof Error ? err.message : String(err)}`)
    }

    return results
  }

  /**
   * Get hooks for a given event from the database, ordered by priority.
   */
  private getHooksForEvent(eventName: string): ExtendedHookRow[] {
    try {
      return this.db.prepare(`
        SELECT id, name, event, action_type, action_value, enabled, description, mode, priority, config
        FROM pmo_work_hooks
        WHERE event = ? AND enabled = 1
        ORDER BY priority ASC, created_at ASC
      `).all(eventName) as ExtendedHookRow[]
    } catch {
      // Fallback without mode/priority columns (pre-migration)
      try {
        const basic = this.db.prepare(`
          SELECT id, name, event, action_type, action_value, enabled, description
          FROM pmo_work_hooks
          WHERE event = ? AND enabled = 1
          ORDER BY created_at ASC
        `).all(eventName) as ExtendedHookRow[]
        return basic
      } catch {
        return []
      }
    }
  }

  /**
   * Build an OrchestrateEventContext from raw event data.
   */
  private buildContext(eventName: string, data: Record<string, unknown>): OrchestrateEventContext {
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
   * Resolve the action name from a hook row.
   * Built-in actions are referenced by name; shell hooks use the raw command.
   */
  private resolveActionName(hook: ExtendedHookRow): string {
    // If the action_value starts with "prlt hook fire", extract the --action value
    const actionMatch = hook.action_value.match(/--action\s+(\S+)/)
    if (actionMatch) return actionMatch[1]

    // If it's a known built-in action name directly
    if (ACTION_HANDLERS[hook.action_value]) return hook.action_value

    // Otherwise it's a raw shell command — use the action_value as-is
    return hook.action_value
  }

  /**
   * Execute an action — either built-in or shell fallback.
   */
  private executeAction(
    actionName: string,
    ctx: OrchestrateEventContext,
    config?: Record<string, unknown>,
  ): OrchestrateActionResult {
    // Try built-in action first
    if (ACTION_HANDLERS[actionName]) {
      return executeBuiltinAction(actionName, ctx, config)
    }

    // Fallback to shell execution
    const start = Date.now()
    try {
      const env = {
        ...process.env,
        PRLT_HOOK_EVENT: ctx.event,
        PRLT_HOOK_TICKET: ctx.ticket ?? '',
        PRLT_HOOK_PR: ctx.pr ? String(ctx.pr) : '',
        PRLT_HOOK_BRANCH: ctx.branch ?? '',
        PRLT_HOOK_AGENT: ctx.agent ?? '',
      }
      execSync(actionName, { env, timeout: 30_000, stdio: 'pipe' })
      return { action: actionName, success: true, durationMs: Date.now() - start }
    } catch (err) {
      return {
        action: actionName,
        success: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      }
    }
  }
}

// =============================================================================
// Singleton
// =============================================================================

let _engine: OrchestrateEngine | undefined

/**
 * Initialize and start the orchestrate engine.
 * Safe to call multiple times.
 */
export function initOrchestrateEngine(options: OrchestrateEngineOptions): OrchestrateEngine {
  if (!_engine) {
    _engine = new OrchestrateEngine(options)
    _engine.start()
  }
  return _engine
}

/**
 * Get the running orchestrate engine instance.
 */
export function getOrchestrateEngine(): OrchestrateEngine | undefined {
  return _engine
}

/**
 * Stop the orchestrate engine.
 */
export function stopOrchestrateEngine(): void {
  if (_engine) {
    _engine.stop()
    _engine = undefined
  }
}

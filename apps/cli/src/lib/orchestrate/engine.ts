/**
 * Orchestrate Engine
 *
 * Thin orchestration layer that configures a HookManager with mode-aware
 * execution, built-in action handlers, and confirmation routing.
 *
 * The engine itself handles:
 * - Configuring HookManager with the correct callbacks and action handlers
 * - Exposing the OrchestrateActionResult API expected by callers
 * - Start/stop lifecycle management
 *
 * All hook matching, mode checking, and execution is delegated to HookManager.
 */

import type Database from 'better-sqlite3'
import { HookManager } from '../work-lifecycle/hooks/manager.js'
import type { HookExecutionResult, HookActionHandler } from '../work-lifecycle/hooks/types.js'
import { ACTION_HANDLERS } from './actions.js'
import {
  NotificationManager,
  initNotificationManager,
  stopNotificationManager,
} from '../notifications/index.js'
import type {
  OrchestrateActionResult,
} from './types.js'

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
  private manager: HookManager
  private notificationManager: NotificationManager
  private running = false

  constructor(options: OrchestrateEngineOptions) {
    // Map OrchestrateActionResult-based onNotify to HookExecutionResult-based onNotify
    const onNotify = options.onNotify
      ? (hookName: string, event: string, action: string, result: HookExecutionResult) => {
          options.onNotify!(hookName, event, action, toActionResult(result))
        }
      : undefined

    this.manager = new HookManager({
      db: options.db,
      log: options.log,
      onConfirm: options.onConfirm,
      onNotify,
      actionHandlers: ACTION_HANDLERS as Record<string, HookActionHandler>,
    })

    // Initialize the notification manager so it subscribes to events
    this.notificationManager = initNotificationManager({
      db: options.db,
      log: options.log,
    })
  }

  /**
   * Start the orchestrate engine — delegates to HookManager and NotificationManager.
   */
  start(): void {
    if (this.running) return
    this.running = true
    this.manager.start()
    void this.notificationManager.start()
  }

  /**
   * Stop the engine and clean up subscriptions.
   */
  stop(): void {
    this.running = false
    this.manager.stop()
    this.notificationManager.stop()
    stopNotificationManager()
  }

  /**
   * Fire an event manually (used by `prlt hook fire`).
   * This is the entry point for external event sources (GitHub Actions, polling, etc.).
   */
  async fireEvent(event: string, ctx: Record<string, unknown>): Promise<OrchestrateActionResult[]> {
    const results = await this.manager.fireEvent(event, ctx)
    return results.map(toActionResult)
  }

  /**
   * Get pending confirmations for hooks in confirm mode.
   */
  getPendingConfirmations(): Array<{
    hookName: string
    event: string
    action: string
    ctx: Record<string, unknown>
    config?: Record<string, unknown>
  }> {
    return this.manager.getPendingConfirmations()
  }

  /**
   * Approve a pending confirmation and execute it.
   */
  async approveConfirmation(index: number): Promise<OrchestrateActionResult | null> {
    const result = await this.manager.approveConfirmation(index)
    return result ? toActionResult(result) : null
  }

  /**
   * Deny a pending confirmation.
   */
  denyConfirmation(index: number): boolean {
    return this.manager.denyConfirmation(index)
  }
}

// =============================================================================
// Result Mapping
// =============================================================================

/**
 * Convert a HookExecutionResult to an OrchestrateActionResult.
 */
function toActionResult(result: HookExecutionResult): OrchestrateActionResult {
  return {
    action: result.action,
    success: result.success,
    error: result.error,
    durationMs: result.durationMs,
    skipped: result.skipped,
    awaitingConfirmation: result.awaitingConfirmation,
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

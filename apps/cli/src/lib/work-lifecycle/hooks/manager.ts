/**
 * Work Lifecycle Hook Manager
 *
 * Subscribes to work lifecycle events on the global EventBus and
 * executes matching hook configurations from the database.
 *
 * Hooks are fire-and-forget: execution failures are logged but never
 * block the caller or break the event emission chain.
 */

import type { SqliteDatabase } from '../../database/sqlite.js'
import { getEventBus } from '../../events/event-bus.js'
import { WorkHookStorage } from './storage.js'
import { executeHook } from './executor.js'
import { HOOKABLE_EVENTS, type HookableEvent } from './types.js'

/**
 * HookManager loads hook configs from the database and subscribes to
 * the global EventBus. When a hookable event fires, it finds all
 * enabled hooks for that event and executes them.
 */
export class HookManager {
  private unsubscribers: Array<() => void> = []
  private hookStorage: WorkHookStorage

  constructor(db: SqliteDatabase) {
    this.hookStorage = new WorkHookStorage(db)
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
          this.handleEvent(eventName, payload as unknown as Record<string, unknown>)
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
  }

  /**
   * Handle a hookable event by executing all matching enabled hooks.
   * Hook failures are swallowed to avoid breaking the event chain.
   */
  private handleEvent(eventName: HookableEvent, eventData: Record<string, unknown>): void {
    try {
      const hooks = this.hookStorage.list({ event: eventName, enabled: true })
      if (hooks.length === 0) return

      for (const hook of hooks) {
        try {
          executeHook(hook, eventName, eventData)
        } catch {
          // Hook execution errors are non-fatal
        }
      }
    } catch {
      // Storage errors are non-fatal
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
 */
export function initHookManager(db: SqliteDatabase): HookManager {
  if (!_manager) {
    _manager = new HookManager(db)
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

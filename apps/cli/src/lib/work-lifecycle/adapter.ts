/**
 * Work Lifecycle Adapter
 *
 * The adapter layer is the central event hub for all providers.
 * All providers (PMO, Linear, Jira, Shortcut, Asana) are equal peers —
 * any state change through any provider emits events here.
 *
 * The adapter handles two event flows:
 *
 * 1. Provider-specific → domain: Translates ticket:* events (emitted by
 *    EventEmittingProvider after any provider operation) into work:*
 *    domain events. This enables backward-compatible ticket:* consumers
 *    (workflow rules, hooks) to coexist with provider-agnostic work:*
 *    consumers (outbound sync).
 *
 * 2. Direct domain events: work:* events emitted directly by
 *    EventEmittingProvider are already provider-agnostic, so no
 *    translation is needed — they flow straight to outbound sync.
 *
 * This architecture replaces the old model where PMO storage was the
 * sole event source. Now events fire regardless of which provider
 * initiated the change.
 */

import type { WorkEventSource } from './events.js'

/**
 * WorkLifecycleAdapter is the event hub for all provider state changes.
 *
 * In the new architecture, EventEmittingProvider wraps each provider and
 * emits both ticket:* (backward compat) and work:* (domain) events.
 * The adapter layer no longer needs to translate between them — that
 * responsibility moved to EventEmittingProvider.
 *
 * The adapter now serves as the coordination point and can be extended
 * to register additional event sources (webhooks, polling, etc.).
 */
export class WorkLifecycleAdapter {
  private unsubscribers: Array<() => void> = []
  private registeredSources: Set<WorkEventSource> = new Set()

  /**
   * Register a provider as an event source.
   * This is informational — tracks which providers are active in the system.
   */
  registerSource(source: WorkEventSource): void {
    this.registeredSources.add(source)
  }

  /**
   * Get all registered event sources.
   */
  getRegisteredSources(): ReadonlySet<WorkEventSource> {
    return this.registeredSources
  }

  /**
   * Start the adapter — sets up any cross-cutting event coordination.
   *
   * In the current architecture, EventEmittingProvider handles all event
   * emission directly. The adapter provides extensibility for future
   * cross-cutting concerns (event logging, metrics, deduplication).
   */
  start(): void {
    // PMO is always a registered source (default provider)
    this.registerSource('pmo')
  }

  /**
   * Stop the adapter and unsubscribe from events.
   */
  stop(): void {
    for (const unsub of this.unsubscribers) {
      unsub()
    }
    this.unsubscribers = []
    this.registeredSources.clear()
  }
}

// =============================================================================
// Singleton
// =============================================================================

let _adapter: WorkLifecycleAdapter | undefined

/**
 * Initialize the work-lifecycle adapter layer.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function initWorkLifecycleAdapter(): WorkLifecycleAdapter {
  if (!_adapter) {
    _adapter = new WorkLifecycleAdapter()
    _adapter.start()
  }
  return _adapter
}

/**
 * Stop the work-lifecycle adapter (primarily for testing).
 */
export function stopWorkLifecycleAdapter(): void {
  if (_adapter) {
    _adapter.stop()
    _adapter = undefined
  }
}

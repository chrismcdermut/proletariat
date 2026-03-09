/**
 * EventBus — Typed event emitter for the execution runtime.
 *
 * Provides a type-safe publish/subscribe mechanism for runtime events.
 * Uses a simple listener map instead of Node's EventEmitter for full
 * type safety on both emit() and on() without casting.
 */

import type { RuntimeEventMap, RuntimeEventName } from './events.js'

/** Listener function type for a specific event. */
export type EventListener<K extends RuntimeEventName> = (
  payload: RuntimeEventMap[K],
) => void

/**
 * Typed event bus for runtime events.
 *
 * Usage:
 * ```ts
 * const bus = new EventBus()
 * const unsub = bus.on('agent:spawned', (event) => {
 *   console.log(`Agent ${event.sessionId} spawned`)
 * })
 * bus.emit('agent:spawned', { sessionId: '...', ... })
 * unsub() // unsubscribe
 * ```
 */
export class EventBus {
  private listeners = new Map<RuntimeEventName, Set<EventListener<any>>>()

  /**
   * Subscribe to an event.
   * Returns an unsubscribe function.
   */
  on<K extends RuntimeEventName>(
    event: K,
    listener: EventListener<K>,
  ): () => void {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(listener)

    return () => {
      set!.delete(listener)
      if (set!.size === 0) {
        this.listeners.delete(event)
      }
    }
  }

  /**
   * Subscribe to an event for a single emission only.
   * Returns an unsubscribe function (in case you want to cancel early).
   */
  once<K extends RuntimeEventName>(
    event: K,
    listener: EventListener<K>,
  ): () => void {
    const unsub = this.on(event, (payload) => {
      unsub()
      listener(payload)
    })
    return unsub
  }

  /**
   * Emit an event to all subscribed listeners.
   * Listeners are called synchronously in subscription order.
   */
  emit<K extends RuntimeEventName>(
    event: K,
    payload: RuntimeEventMap[K],
  ): void {
    const set = this.listeners.get(event)
    if (!set) return
    for (const listener of set) {
      try {
        listener(payload)
      } catch {
        // Listeners should not throw, but don't let one bad listener
        // break the emission chain.
      }
    }
  }

  /** Remove all listeners for a specific event, or all events if no name given. */
  removeAllListeners(event?: RuntimeEventName): void {
    if (event) {
      this.listeners.delete(event)
    } else {
      this.listeners.clear()
    }
  }

  /** Get the number of listeners for a specific event. */
  listenerCount(event: RuntimeEventName): number {
    return this.listeners.get(event)?.size ?? 0
  }
}

// =============================================================================
// Singleton
// =============================================================================

let _defaultBus: EventBus | undefined

/**
 * Get the global default EventBus instance.
 * Creates one on first access. Use this for application-wide event routing.
 */
export function getEventBus(): EventBus {
  if (!_defaultBus) {
    _defaultBus = new EventBus()
  }
  return _defaultBus
}

/**
 * Reset the global EventBus (primarily for testing).
 */
export function resetEventBus(): void {
  if (_defaultBus) {
    _defaultBus.removeAllListeners()
  }
  _defaultBus = undefined
}

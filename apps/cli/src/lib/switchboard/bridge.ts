/**
 * Switchboard–EventBus Bridge
 *
 * Connects the in-process EventBus to the cross-process switchboard.
 * When enabled, selected EventBus events are published as switchboard
 * event messages, enabling cross-process event propagation.
 *
 * The EventBus is NOT replaced — it remains the primary in-process
 * event mechanism. The bridge simply forwards events to the switchboard
 * for consumers in other processes.
 *
 * See: PRLT-1371
 */

import { type EventBus, getEventBus } from '../events/event-bus.js'
import type { RuntimeEventName } from '../events/events.js'
import { SwitchboardClient } from './client.js'

// =============================================================================
// Types
// =============================================================================

export interface SwitchboardBridgeOptions {
  /** The switchboard client to publish through. */
  client: SwitchboardClient
  /** EventBus instance to bridge from (defaults to global). */
  eventBus?: EventBus
  /** Events to bridge (defaults to all runtime events). */
  events?: RuntimeEventName[]
  /** Logger function. */
  log?: (msg: string) => void
}

/** Default set of events worth bridging cross-process. */
const DEFAULT_BRIDGED_EVENTS: RuntimeEventName[] = [
  'agent:spawned',
  'agent:status_change',
  'agent:poked',
  'agent:stopped',
  'agent:error',
  'work:started',
  'work:status_changed',
  'work:pr_created',
  'work:pr_merged',
  'work:pr_closed',
  'work:completed',
]

// =============================================================================
// SwitchboardBridge
// =============================================================================

export class SwitchboardBridge {
  private client: SwitchboardClient
  private eventBus: EventBus
  private events: RuntimeEventName[]
  private log: (msg: string) => void
  private unsubscribers: (() => void)[] = []
  private active = false

  constructor(options: SwitchboardBridgeOptions) {
    this.client = options.client
    this.eventBus = options.eventBus ?? getEventBus()
    this.events = options.events ?? DEFAULT_BRIDGED_EVENTS
    this.log = options.log ?? (() => {})
  }

  /**
   * Start bridging EventBus events to the switchboard.
   * Subscribes to each configured event and publishes to switchboard on emit.
   */
  start(): void {
    if (this.active) return
    this.active = true

    for (const eventName of this.events) {
      const unsub = this.eventBus.on(eventName, (payload: unknown) => {
        try {
          this.client.publish(eventName, eventName, payload)
        } catch {
          // Bridge errors are non-fatal — don't break the EventBus emission chain
        }
      })
      this.unsubscribers.push(unsub)
    }

    this.log(`switchboard bridge started — bridging ${this.events.length} events`)
  }

  /**
   * Stop bridging. Unsubscribes from all EventBus events.
   */
  stop(): void {
    for (const unsub of this.unsubscribers) {
      unsub()
    }
    this.unsubscribers = []
    this.active = false
    this.log('switchboard bridge stopped')
  }

  /**
   * Whether the bridge is currently active.
   */
  get isActive(): boolean {
    return this.active
  }

  /**
   * The list of events being bridged.
   */
  get bridgedEvents(): RuntimeEventName[] {
    return [...this.events]
  }
}

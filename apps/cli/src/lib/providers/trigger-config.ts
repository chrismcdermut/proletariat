/**
 * Provider Trigger Configuration
 *
 * Configurable triggers that map work lifecycle events to automatic
 * column/status transitions. When a trigger event fires, the system
 * automatically moves the affected ticket to the configured target status.
 *
 * Supported trigger events:
 * - agent_started: An agent begins working on a ticket
 * - pr_created: A pull request is created or linked
 * - pr_merged: A pull request is merged
 * - tests_passed: Tests pass for the work item
 * - work_completed: Work on the item is marked complete
 *
 * Triggers can be scoped per provider (or '*' for all providers)
 * and per project (or null for all projects).
 *
 * Example:
 *   trigger_event: 'pr_created', target_status: 'Review'
 *   → When a PR is created, move the ticket to "Review"
 *
 *   trigger_event: 'pr_merged', target_status: 'Done'
 *   → When a PR is merged, move the ticket to "Done"
 */

import type Database from 'better-sqlite3'
import { getEventBus } from '../events/event-bus.js'
import type { TicketProviderName } from './types.js'

/**
 * Valid trigger event names that can be configured.
 */
export type TriggerEvent =
  | 'agent_started'
  | 'pr_created'
  | 'pr_merged'
  | 'tests_passed'
  | 'work_completed'

export const TRIGGER_EVENTS: readonly TriggerEvent[] = [
  'agent_started',
  'pr_created',
  'pr_merged',
  'tests_passed',
  'work_completed',
]

export interface TriggerConfig {
  id?: number
  provider: string
  triggerEvent: TriggerEvent
  targetStatus: string
  projectId: string | null
  enabled: boolean
}

/**
 * ProviderTriggerStore — stub implementation (PRLT-1299).
 * The pmo_provider_triggers table has been dropped.
 * All methods return empty/no-op to avoid breaking callers.
 */
export class ProviderTriggerStore {
  constructor(_db: Database.Database) {}

  getTriggersForEvent(
    _triggerEvent: TriggerEvent,
    _provider?: string,
    _projectId?: string | null,
  ): TriggerConfig[] {
    return []
  }

  listTriggers(): TriggerConfig[] {
    return []
  }

  upsertTrigger(_config: TriggerConfig): void {
    // No-op: table removed (PRLT-1299)
  }

  removeTrigger(_id: number): void {
    // No-op: table removed (PRLT-1299)
  }

  setEnabled(_id: number, _enabled: boolean): void {
    // No-op: table removed (PRLT-1299)
  }
}

/**
 * TriggerHandler subscribes to work-lifecycle events on the EventBus
 * and automatically transitions tickets based on configured triggers.
 */
export class TriggerHandler {
  private unsubscribers: Array<() => void> = []
  private store: ProviderTriggerStore
  private moveTicket: (ticketId: string, projectId: string, targetStatus: string) => Promise<void>

  constructor(
    db: Database.Database,
    moveTicket: (ticketId: string, projectId: string, targetStatus: string) => Promise<void>,
  ) {
    this.store = new ProviderTriggerStore(db)
    this.moveTicket = moveTicket
  }

  /**
   * Start listening for work-lifecycle events and applying triggers.
   */
  start(): void {
    const bus = getEventBus()

    // agent_started trigger: fires on work:started events
    this.unsubscribers.push(
      bus.on('work:started', (event) => {
        void this.applyTrigger('agent_started', event.source, event.workItemId, event.projectId ?? null)
      }),
    )

    // pr_created trigger: fires on work:pr_created events
    this.unsubscribers.push(
      bus.on('work:pr_created', (event) => {
        void this.applyTrigger('pr_created', event.source, event.workItemId, event.projectId ?? null)
      }),
    )

    // pr_merged trigger: fires on work:pr_merged events
    this.unsubscribers.push(
      bus.on('work:pr_merged', (event) => {
        void this.applyTrigger('pr_merged', event.source, event.workItemId, event.projectId ?? null)
      }),
    )

    // work_completed trigger: fires on work:completed events
    this.unsubscribers.push(
      bus.on('work:completed', (event) => {
        void this.applyTrigger('work_completed', event.source, event.workItemId, event.projectId ?? null)
      }),
    )
  }

  /**
   * Stop listening for events.
   */
  stop(): void {
    for (const unsub of this.unsubscribers) {
      unsub()
    }
    this.unsubscribers = []
  }

  /**
   * Apply a trigger: look up configured triggers for the event
   * and move the ticket to the target status if a match is found.
   */
  private async applyTrigger(
    triggerEvent: TriggerEvent,
    source: string,
    workItemId: string,
    projectId: string | null,
  ): Promise<void> {
    const triggers = this.store.getTriggersForEvent(triggerEvent, source, projectId)

    if (triggers.length === 0) return

    // Use the most specific trigger (provider-specific + project-specific first)
    const trigger = triggers[0]

    try {
      await this.moveTicket(workItemId, projectId ?? '', trigger.targetStatus)
    } catch {
      // Trigger application is non-fatal
    }
  }
}

// =============================================================================
// Singleton
// =============================================================================

let _handler: TriggerHandler | undefined

/**
 * Initialize the trigger handler.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function initTriggerHandler(
  db: Database.Database,
  moveTicket: (ticketId: string, projectId: string, targetStatus: string) => Promise<void>,
): TriggerHandler {
  if (!_handler) {
    _handler = new TriggerHandler(db, moveTicket)
    _handler.start()
  }
  return _handler
}

/**
 * Stop the trigger handler (primarily for testing).
 */
export function stopTriggerHandler(): void {
  if (_handler) {
    _handler.stop()
    _handler = undefined
  }
}

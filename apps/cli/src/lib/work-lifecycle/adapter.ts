/**
 * Work Lifecycle Adapter
 *
 * Bridges provider-specific events to work-lifecycle domain events.
 * PMO ticket events are translated into provider-agnostic work events,
 * making PMO just another event source rather than the central hub.
 *
 * Additional adapters can be registered to translate events from
 * other providers (GitHub, Linear inbound webhooks, etc.).
 */

import { getEventBus } from '../events/event-bus.js'
import type { TicketStatusChangedEvent, TicketPRLinkedEvent } from '../events/events.js'

/**
 * WorkLifecycleAdapter subscribes to provider-specific events and
 * re-emits them as work-lifecycle domain events on the same EventBus.
 */
export class WorkLifecycleAdapter {
  private unsubscribers: Array<() => void> = []

  /**
   * Start the PMO adapter — translates ticket:* events to work:* events.
   */
  startPMOAdapter(): void {
    const bus = getEventBus()

    this.unsubscribers.push(
      bus.on('ticket:status_changed', (event: TicketStatusChangedEvent) => {
        // Always emit the generic status change
        bus.emit('work:status_changed', {
          workItemId: event.ticketId,
          source: 'pmo',
          projectId: event.projectId,
          previousStatus: event.previousStatusName ?? null,
          previousCategory: event.previousStatusCategory ?? null,
          newStatus: event.newStatusName ?? null,
          newCategory: event.newStatusCategory ?? null,
          timestamp: event.timestamp,
        })

        // Emit work:started when entering the 'started' category
        if (
          event.newStatusCategory === 'started' &&
          event.previousStatusCategory !== 'started'
        ) {
          bus.emit('work:started', {
            workItemId: event.ticketId,
            source: 'pmo',
            projectId: event.projectId,
            status: event.newStatusName ?? null,
            timestamp: event.timestamp,
          })
        }

        // Emit work:completed when entering the 'completed' category
        if (
          event.newStatusCategory === 'completed' &&
          event.previousStatusCategory !== 'completed'
        ) {
          bus.emit('work:completed', {
            workItemId: event.ticketId,
            source: 'pmo',
            projectId: event.projectId,
            status: event.newStatusName ?? null,
            timestamp: event.timestamp,
          })
        }
      }),
    )

    this.unsubscribers.push(
      bus.on('ticket:pr_linked', (event: TicketPRLinkedEvent) => {
        bus.emit('work:pr_created', {
          workItemId: event.ticketId,
          source: 'pmo',
          projectId: event.projectId,
          prUrl: event.prUrl,
          prTitle: event.prTitle ?? null,
          timestamp: event.timestamp,
        })
      }),
    )
  }

  /**
   * Stop all adapters and unsubscribe from events.
   */
  stop(): void {
    for (const unsub of this.unsubscribers) {
      unsub()
    }
    this.unsubscribers = []
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
    _adapter.startPMOAdapter()
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

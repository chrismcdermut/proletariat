/**
 * Event-Emitting Provider Decorator
 *
 * Wraps any TicketProvider and emits work-lifecycle domain events
 * after successful operations. This moves event emission from the
 * PMO storage layer to the adapter/provider layer, making all
 * providers (PMO, Linear, Jira, Shortcut, Asana) equal peers.
 *
 * The event bus becomes the central hub — any provider that makes
 * a state change emits events here, and other providers listen and sync.
 *
 * Pattern: same decorator approach as EventEmittingRunner.
 */

import type { StateCategory, TicketFilter, CreateTicketInput } from '../pmo/types.js'
import { getEventBus } from '../events/event-bus.js'
import type {
  TicketProvider,
  TicketProviderName,
  ProviderMoveResult,
  ProviderDeleteResult,
  ProviderListResult,
  ProviderCreateResult,
  ProviderGetResult,
  ProviderUpdateResult,
  ProviderCommentResult,
} from './types.js'

/**
 * Context needed by EventEmittingProvider to resolve status details
 * for event emission. Typically backed by SQLite storage.
 */
export interface StatusResolver {
  /**
   * Resolve a status ID to its name and category.
   * Used when emitting status change events after moveTicket().
   */
  resolveStatusByName(
    projectId: string,
    statusName: string,
  ): { id: string; name: string; category: StateCategory } | null

  /**
   * Resolve a ticket's current status details.
   * Used to capture the "previous" status before a move.
   */
  getTicketStatus(
    ticketId: string,
  ): { statusId: string | null; statusName: string | null; statusCategory: StateCategory | null } | null
}

/**
 * EventEmittingProvider wraps a TicketProvider and emits
 * work-lifecycle domain events after successful operations.
 *
 * Events emitted:
 * - work:status_changed — after moveTicket() succeeds
 * - work:started — when status category transitions to 'started'
 * - work:completed — when status category transitions to 'completed'
 * - work:pr_created — when a ticket is updated with a PR URL
 *
 * Also emits ticket:status_changed and ticket:pr_linked for backward
 * compatibility with workflow rules and hooks.
 */
export class EventEmittingProvider implements TicketProvider {
  readonly name: TicketProviderName

  constructor(
    private inner: TicketProvider,
    private statusResolver: StatusResolver | null,
    private projectId: string,
  ) {
    this.name = inner.name
  }

  async moveTicket(ticketId: string, newState: string): Promise<ProviderMoveResult> {
    // Capture previous status before the move
    const previous = this.statusResolver?.getTicketStatus(ticketId) ?? null

    const result = await this.inner.moveTicket(ticketId, newState)

    if (result.success) {
      // Resolve the new status
      const newStatus = this.statusResolver?.resolveStatusByName(this.projectId, newState) ?? null
      const source = this.name

      const bus = getEventBus()

      // Emit provider-specific event (backward compat with workflow rules, hooks)
      bus.emit('ticket:status_changed', {
        ticketId,
        projectId: this.projectId,
        previousStatusId: previous?.statusId ?? null,
        previousStatusName: previous?.statusName ?? null,
        previousStatusCategory: previous?.statusCategory ?? null,
        newStatusId: newStatus?.id ?? newState,
        newStatusName: newStatus?.name ?? newState,
        newStatusCategory: newStatus?.category ?? null,
        timestamp: new Date(),
      })

      // Emit provider-agnostic domain event
      bus.emit('work:status_changed', {
        workItemId: ticketId,
        source,
        projectId: this.projectId,
        previousStatus: previous?.statusName ?? null,
        previousCategory: previous?.statusCategory ?? null,
        newStatus: newStatus?.name ?? newState,
        newCategory: newStatus?.category ?? null,
        timestamp: new Date(),
      })

      // Emit work:started when entering the 'started' category
      if (
        newStatus?.category === 'started' &&
        previous?.statusCategory !== 'started'
      ) {
        bus.emit('work:started', {
          workItemId: ticketId,
          source,
          projectId: this.projectId,
          status: newStatus.name,
          timestamp: new Date(),
        })
      }

      // Emit work:completed when entering the 'completed' category
      if (
        newStatus?.category === 'completed' &&
        previous?.statusCategory !== 'completed'
      ) {
        bus.emit('work:completed', {
          workItemId: ticketId,
          source,
          projectId: this.projectId,
          status: newStatus.name,
          timestamp: new Date(),
        })
      }
    }

    return result
  }

  async deleteTicket(ticketId: string): Promise<ProviderDeleteResult> {
    return this.inner.deleteTicket(ticketId)
  }

  async listTickets(projectId?: string, filter?: TicketFilter): Promise<ProviderListResult> {
    return this.inner.listTickets(projectId, filter)
  }

  async createTicket(projectId: string, input: CreateTicketInput): Promise<ProviderCreateResult> {
    const result = await this.inner.createTicket(projectId, input)

    // If a PR URL was included in the creation metadata, emit pr_created
    if (result.success && result.ticket && input.metadata?.['pr_url']) {
      const bus = getEventBus()

      bus.emit('ticket:pr_linked', {
        ticketId: result.ticket.id,
        projectId,
        prUrl: input.metadata['pr_url'],
        prTitle: input.metadata['pr_title'] ?? null,
        timestamp: new Date(),
      })

      bus.emit('work:pr_created', {
        workItemId: result.ticket.id,
        source: this.name,
        projectId,
        prUrl: input.metadata['pr_url'],
        prTitle: input.metadata['pr_title'] ?? null,
        timestamp: new Date(),
      })
    }

    return result
  }

  async getTicket(ticketId: string): Promise<ProviderGetResult> {
    return this.inner.getTicket(ticketId)
  }

  async updateTicket(ticketId: string, changes: Record<string, unknown>): Promise<ProviderUpdateResult> {
    return this.inner.updateTicket(ticketId, changes)
  }

  async addComment(ticketId: string, body: string): Promise<ProviderCommentResult> {
    return this.inner.addComment(ticketId, body)
  }
}

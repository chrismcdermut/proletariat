/**
 * Ticket Provider Interface
 *
 * Unified interface for moving tickets across providers.
 * Whether the ticket lives in local PMO, Linear, Jira, or another system,
 * the same `moveTicket(ticketId, newState)` call routes to the right backend.
 *
 * The local PMO is just the default provider for users without integrations,
 * not a cache layer.
 */

import type { StateCategory } from '../pmo/types.js'

/**
 * Supported provider names for ticket operations.
 */
export type TicketProviderName = 'pmo' | 'linear' | 'jira' | 'asana' | 'shortcut' | 'trello'

/**
 * Result of a provider moveTicket operation.
 */
export interface ProviderMoveResult {
  /** Whether the move succeeded */
  success: boolean
  /** The provider that handled the move */
  provider: TicketProviderName
  /** Error message if the move failed */
  error?: string
}

/**
 * Ticket provider interface — same contract for all backends.
 *
 * Implementations:
 * - PMOTicketProvider: writes to local SQLite (emits ticket:status_changed)
 * - LinearTicketProvider: calls Linear API, then updates local PMO
 */
export interface TicketProvider {
  /** Which provider this is */
  readonly name: TicketProviderName

  /**
   * Move a ticket to a new state.
   *
   * @param ticketId - The PMO ticket ID (e.g., "TKT-142")
   * @param newState - The target state name (e.g., "Review")
   * @returns Result of the move operation
   */
  moveTicket(ticketId: string, newState: string): Promise<ProviderMoveResult>
}

/**
 * Context needed to resolve and create a ticket provider.
 */
export interface ProviderContext {
  /** Ticket's external source (from metadata), e.g., 'linear' */
  externalSource?: string | null
  /** Ticket's external ID in the source system */
  externalId?: string | null
  /** Ticket's project ID in the PMO */
  projectId?: string | null
  /** Ticket's current status category */
  statusCategory?: StateCategory | null
}

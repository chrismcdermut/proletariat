/**
 * Ticket Provider Interface
 *
 * Unified interface for all ticket operations across providers.
 * Whether the ticket lives in local PMO, Linear, Jira, or another system,
 * the same provider interface routes to the right backend.
 *
 * The local PMO is just the default provider for users without integrations,
 * not a cache layer.
 */

import type { StateCategory, Ticket, TicketFilter, CreateTicketInput } from '../pmo/types.js'

/**
 * Supported provider names for ticket operations.
 */
export type TicketProviderName = 'pmo' | 'linear' | 'jira' | 'asana' | 'shortcut' | 'trello' | 'clickup'

/**
 * Generic result of a provider operation.
 */
export interface ProviderResult {
  /** Whether the operation succeeded */
  success: boolean
  /** The provider that handled the operation */
  provider: TicketProviderName
  /** Error message if the operation failed */
  error?: string
}

/**
 * Result of a provider moveTicket operation.
 */
export interface ProviderMoveResult extends ProviderResult {}

/**
 * Result of a provider deleteTicket operation.
 */
export interface ProviderDeleteResult extends ProviderResult {}

/**
 * Result of a provider listTickets operation.
 */
export interface ProviderListResult extends ProviderResult {
  /** Tickets returned by the provider */
  tickets: Ticket[]
}

/**
 * Result of a provider createTicket operation.
 */
export interface ProviderCreateResult extends ProviderResult {
  /** The created ticket */
  ticket?: Ticket
}

/**
 * Result of a provider getTicket operation.
 */
export interface ProviderGetResult extends ProviderResult {
  /** The retrieved ticket */
  ticket?: Ticket | null
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

  /**
   * Delete a ticket.
   *
   * @param ticketId - The PMO ticket ID (e.g., "TKT-142")
   * @returns Result of the delete operation
   */
  deleteTicket(ticketId: string): Promise<ProviderDeleteResult>

  /**
   * List tickets, optionally filtered.
   *
   * @param projectId - Optional project scope
   * @param filter - Optional filters (column, priority, search, etc.)
   * @returns Result with tickets array
   */
  listTickets(projectId?: string, filter?: TicketFilter): Promise<ProviderListResult>

  /**
   * Create a ticket.
   *
   * @param projectId - The project to create the ticket in
   * @param input - Ticket creation input
   * @returns Result with the created ticket
   */
  createTicket(projectId: string, input: CreateTicketInput): Promise<ProviderCreateResult>

  /**
   * Get a single ticket by ID.
   *
   * @param ticketId - The ticket ID
   * @returns Result with the ticket (or null if not found)
   */
  getTicket(ticketId: string): Promise<ProviderGetResult>
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

/**
 * Storage interface required by providers.
 * SQLiteStorage satisfies this interface.
 */
export interface ProviderStorage {
  getTicket: (id: string) => Promise<Ticket | null>
  getProjectBoard: (projectId: string) => Promise<{
    columns: Array<{ name: string }>
  } | null>
  moveTicket: (projectId: string, ticketId: string, columnName: string, position?: number) => Promise<Ticket>
  deleteTicket: (id: string) => Promise<void>
  listTickets: (projectId: string | undefined, filter?: TicketFilter) => Promise<Ticket[]>
  createTicket: (projectId: string, input: CreateTicketInput) => Promise<Ticket>
  getDatabase: () => import('better-sqlite3').Database
}

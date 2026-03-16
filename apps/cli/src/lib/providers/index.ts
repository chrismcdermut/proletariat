/**
 * Ticket Providers — public API.
 *
 * Unified provider interface for moving tickets across backends.
 * provider.moveTicket(ticketId, newState) — same interface whether
 * Linear, Jira, or local PMO.
 */

export type {
  TicketProvider,
  TicketProviderName,
  ProviderMoveResult,
  ProviderContext,
} from './types.js'

export { PMOTicketProvider } from './pmo-provider.js'
export { LinearTicketProvider } from './linear-provider.js'
export { resolveTicketProvider } from './resolver.js'

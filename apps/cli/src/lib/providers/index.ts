/**
 * Ticket Providers — public API.
 *
 * Unified provider interface for all ticket operations across backends.
 * provider.moveTicket(), .listTickets(), .createTicket(), .deleteTicket()
 * — same interface whether Linear, Jira, or local PMO.
 */

export type {
  TicketProvider,
  TicketProviderName,
  ProviderResult,
  ProviderMoveResult,
  ProviderDeleteResult,
  ProviderListResult,
  ProviderCreateResult,
  ProviderGetResult,
  ProviderContext,
  ProviderStorage,
} from './types.js'

export { PMOTicketProvider } from './pmo-provider.js'
export { LinearTicketProvider } from './linear-provider.js'
export { resolveTicketProvider, resolveProjectProvider } from './resolver.js'

/**
 * Ticket Provider Resolver
 *
 * Determines which provider should handle a ticket move based on the
 * ticket's external source metadata. If the ticket was imported from
 * Linear and Linear is configured, use the Linear provider to write
 * directly to the source of truth.
 *
 * Resolution rules:
 * - external_source = 'linear' + configured + mapping exists
 *   + syncDirection is 'inbound' or 'bidirectional' → Linear is source of truth
 *   → Use LinearTicketProvider
 * - Otherwise → PMOTicketProvider (default, local-only)
 */

import type Database from 'better-sqlite3'
import type { PostExecutionStorage } from '../work-lifecycle/post-execution.js'
import { isLinearConfigured } from '../linear/config.js'
import { LinearMapper } from '../linear/mapper.js'
import type { TicketProvider } from './types.js'
import { PMOTicketProvider } from './pmo-provider.js'
import { LinearTicketProvider } from './linear-provider.js'

/**
 * Resolve the correct provider for a given ticket.
 *
 * @param ticketId - The PMO ticket ID
 * @param projectId - The PMO project ID
 * @param db - Database handle for config/mapping lookups
 * @param storage - PMO storage for fallback and local sync
 * @param metadata - Ticket metadata (contains external_source, etc.)
 * @returns The appropriate TicketProvider for this ticket
 */
export function resolveTicketProvider(
  ticketId: string,
  projectId: string,
  db: Database.Database,
  storage: PostExecutionStorage,
  metadata?: Record<string, string> | null,
): TicketProvider {
  const externalSource = metadata?.external_source

  // Check Linear
  if (externalSource === 'linear' && isLinearConfigured(db)) {
    const mapper = new LinearMapper(db)
    const mapping = mapper.getByTicketId(ticketId)

    if (mapping) {
      // Only use Linear provider when Linear is the source of truth:
      // - 'inbound' = ticket was imported from Linear → Linear is source of truth
      // - 'bidirectional' = both directions synced → write to Linear directly
      // - 'outbound' = ticket was created in PMO and pushed to Linear → PMO is source of truth
      if (mapping.syncDirection !== 'outbound') {
        return new LinearTicketProvider(db, storage, projectId, null)
      }
    }
  }

  // Default: local PMO
  return new PMOTicketProvider(storage, projectId)
}

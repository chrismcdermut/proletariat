/**
 * Ticket Provider Resolver
 *
 * Determines which provider should handle a ticket move based on the
 * ticket's external source metadata. If the ticket was imported from
 * Linear and Linear is configured, use the Linear provider.
 * Otherwise, fall back to the local PMO provider.
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
 * Resolution logic:
 * 1. Check ticket metadata for external_source
 * 2. If 'linear' and Linear is configured and has a valid mapping → LinearTicketProvider
 * 3. Otherwise → PMOTicketProvider (default)
 *
 * @param ticketId - The PMO ticket ID
 * @param projectId - The PMO project ID
 * @param db - Database handle for config/mapping lookups
 * @param storage - PMO storage for fallback and local sync
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
    // Verify we have a mapping for this ticket
    const mapper = new LinearMapper(db)
    const mapping = mapper.getByTicketId(ticketId)

    if (mapping) {
      const statusCategory = null // Will be resolved by the provider
      return new LinearTicketProvider(db, storage, projectId, statusCategory)
    }
  }

  // Default: local PMO
  return new PMOTicketProvider(storage, projectId)
}

/**
 * Ticket Provider Resolver
 *
 * Determines which provider should handle ticket operations based on the
 * ticket's external source metadata or workspace configuration.
 *
 * Two resolution modes:
 * 1. Ticket-level: resolveTicketProvider() — for operations on a specific ticket
 *    (move, delete). Uses the ticket's metadata to find the source of truth.
 *
 * 2. Project-level: resolveProjectProvider() — for operations that aren't
 *    ticket-specific (list, create). Uses workspace config to determine
 *    the active provider.
 */

import type Database from 'better-sqlite3'
import { isLinearConfigured } from '../linear/config.js'
import { LinearMapper } from '../linear/mapper.js'
import type { TicketProvider, ProviderStorage } from './types.js'
import { PMOTicketProvider } from './pmo-provider.js'
import { LinearTicketProvider } from './linear-provider.js'

/**
 * Resolve the correct provider for a given ticket.
 *
 * Uses the ticket's metadata to determine the source of truth:
 * - external_source = 'linear' + configured + inbound/bidirectional → Linear
 * - Otherwise → PMO
 *
 * @param ticketId - The PMO ticket ID
 * @param projectId - The PMO project ID
 * @param db - Database handle for config/mapping lookups
 * @param storage - Storage for fallback and local sync
 * @param metadata - Ticket metadata (contains external_source, etc.)
 * @returns The appropriate TicketProvider for this ticket
 */
export function resolveTicketProvider(
  ticketId: string,
  projectId: string,
  db: Database.Database,
  storage: ProviderStorage,
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

/**
 * Resolve the correct provider for project-level operations (list, create).
 *
 * Unlike resolveTicketProvider, this doesn't require a specific ticket.
 * It checks workspace configuration to determine the active provider.
 *
 * @param db - Database handle for config lookups
 * @param storage - Storage instance
 * @param projectId - The PMO project ID
 * @param source - Optional source hint ('pmo', 'linear', or 'auto')
 * @returns The appropriate TicketProvider
 */
export function resolveProjectProvider(
  db: Database.Database,
  storage: ProviderStorage,
  projectId: string,
  source?: string,
): TicketProvider {
  if (source === 'pmo') {
    return new PMOTicketProvider(storage, projectId)
  }

  if (source === 'linear') {
    return new LinearTicketProvider(db, storage, projectId, null)
  }

  // auto: use Linear when it's configured in the workspace
  try {
    if (isLinearConfigured(db)) {
      return new LinearTicketProvider(db, storage, projectId, null)
    }
  } catch {
    // workspace_settings table may not exist in older/test databases
  }

  return new PMOTicketProvider(storage, projectId)
}

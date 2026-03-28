/**
 * Ticket Provider Resolver
 *
 * Determines which provider should handle ticket operations based on the
 * ticket's external source metadata or workspace configuration.
 *
 * All resolved providers are wrapped with EventEmittingProvider, making
 * the adapter layer the central event hub. Every provider (PMO, Linear,
 * Jira, Shortcut, Asana) is an equal peer that emits events through
 * the same mechanism.
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
import { isClickUpConfigured } from '../clickup/config.js'
import { isGitHubConfigured } from '../github/config.js'
import { isJiraConfigured } from '../jira/config.js'
import { LinearMapper } from '../linear/mapper.js'
import { isTrelloConfigured } from '../trello/config.js'
import { TrelloMapper } from '../trello/mapper.js'
import { isNotionConfigured } from '../notion/config.js'
import { NotionMapper } from '../notion/mapper.js'
import type { StateCategory } from '../pmo/types.js'
import type { TicketProvider, ProviderStorage } from './types.js'
import { PMOTicketProvider } from './pmo-provider.js'
import { LinearTicketProvider } from './linear-provider.js'
import { ClickUpTicketProvider } from './clickup-provider.js'
import { TrelloTicketProvider } from './trello-provider.js'
import { GitHubIssuesTicketProvider } from './github-provider.js'
import { JiraTicketProvider } from './jira-provider.js'
import { NotionTicketProvider } from './notion-provider.js'
import { EventEmittingProvider, type StatusResolver } from './event-emitting-provider.js'

/**
 * Create a StatusResolver backed by the database.
 * Used by EventEmittingProvider to resolve status names/categories
 * for event emission.
 */
function createDbStatusResolver(db: Database.Database, storage: ProviderStorage): StatusResolver {
  return {
    resolveStatusByName(projectId: string, statusName: string) {
      try {
        const row = db.prepare(`
          SELECT ws.id, ws.name, ws.category
          FROM pmo_workflow_statuses ws
          JOIN pmo_projects p ON p.workflow_id = ws.workflow_id
          WHERE p.id = ? AND LOWER(ws.name) = LOWER(?)
        `).get(projectId, statusName) as { id: string; name: string; category: string } | undefined

        if (row) {
          return { id: row.id, name: row.name, category: row.category as StateCategory }
        }

        // Fallback: search by status ID
        const byId = db.prepare(`
          SELECT id, name, category FROM pmo_workflow_statuses WHERE id = ?
        `).get(statusName) as { id: string; name: string; category: string } | undefined

        if (byId) {
          return { id: byId.id, name: byId.name, category: byId.category as StateCategory }
        }
      } catch {
        // Non-fatal: status resolution is best-effort
      }
      return null
    },

    getTicketStatus(ticketId: string) {
      try {
        const row = db.prepare(`
          SELECT t.status_id, ws.name, ws.category
          FROM pmo_tickets t
          LEFT JOIN pmo_workflow_statuses ws ON t.status_id = ws.id
          WHERE t.id = ?
        `).get(ticketId) as { status_id: string | null; name: string | null; category: string | null } | undefined

        if (row) {
          return {
            statusId: row.status_id,
            statusName: row.name,
            statusCategory: (row.category as StateCategory) ?? null,
          }
        }
      } catch {
        // Non-fatal: status resolution is best-effort
      }
      return null
    },
  }
}

/**
 * Wrap a provider with EventEmittingProvider for event emission.
 */
function wrapWithEvents(
  provider: TicketProvider,
  db: Database.Database,
  storage: ProviderStorage,
  projectId: string,
): TicketProvider {
  const resolver = createDbStatusResolver(db, storage)
  return new EventEmittingProvider(provider, resolver, projectId)
}

/**
 * Resolve the correct provider for a given ticket.
 *
 * Uses the ticket's metadata to determine the source of truth:
 * - external_source = 'linear' + configured + outbound/bidirectional → Linear
 * - Otherwise → PMO
 *
 * The resolved provider is wrapped with EventEmittingProvider so that
 * events are emitted at the adapter layer, not the storage layer.
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
      // Use Linear provider when we need to write back to Linear:
      // - 'outbound' = ticket came from Linear (via work start) → write back status changes
      // - 'bidirectional' = both directions synced → write to Linear directly
      // - 'inbound' = bulk import from Linear → read-only, no write-back
      if (mapping.syncDirection === 'outbound' || mapping.syncDirection === 'bidirectional') {
        const inner = new LinearTicketProvider(db, storage, projectId, null)
        return wrapWithEvents(inner, db, storage, projectId)
      }
    } else if (metadata?.external_key || metadata?.external_id) {
      // PRLT-1167: External-only ticket (no PMO mirror, no LinearMapper mapping).
      // When metadata contains external_key/external_id, resolve to Linear provider
      // so post-execution transitions write back to Linear directly.
      const inner = new LinearTicketProvider(db, storage, projectId, null)
      return wrapWithEvents(inner, db, storage, projectId)
    }
  }

  // Check ClickUp
  if (externalSource === 'clickup' && isClickUpConfigured(db)) {
    const inner = new ClickUpTicketProvider(db, storage, projectId)
    return wrapWithEvents(inner, db, storage, projectId)
  }

  // Check Jira
  if (externalSource === 'jira' && isJiraConfigured(db)) {
    const inner = new JiraTicketProvider(db, storage, projectId)
    return wrapWithEvents(inner, db, storage, projectId)
  }

  // Check Trello
  if (externalSource === 'trello' && isTrelloConfigured(db)) {
    const mapper = new TrelloMapper(db)
    const mapping = mapper.getByTicketId(ticketId)

    if (mapping) {
      const inner = new TrelloTicketProvider(db, storage, projectId, null)
      return wrapWithEvents(inner, db, storage, projectId)
    } else if (metadata?.external_key || metadata?.external_id) {
      // PRLT-1167: External-only ticket — resolve to Trello provider directly
      const inner = new TrelloTicketProvider(db, storage, projectId, null)
      return wrapWithEvents(inner, db, storage, projectId)
    }
  }

  // Check GitHub Issues
  if (externalSource === 'github' && isGitHubConfigured(db)) {
    const inner = new GitHubIssuesTicketProvider(db, storage, projectId)
    return wrapWithEvents(inner, db, storage, projectId)
  }

  // Check Notion
  if (externalSource === 'notion' && isNotionConfigured(db)) {
    const mapper = new NotionMapper(db)
    const mapping = mapper.getByTicketId(ticketId)

    if (mapping) {
      const inner = new NotionTicketProvider(db, storage, projectId)
      return wrapWithEvents(inner, db, storage, projectId)
    }
  }

  // Default: local PMO
  const inner = new PMOTicketProvider(storage, projectId)
  return wrapWithEvents(inner, db, storage, projectId)
}

/**
 * Resolve the correct provider for project-level operations (list, create).
 *
 * Unlike resolveTicketProvider, this doesn't require a specific ticket.
 * It checks workspace configuration to determine the active provider.
 *
 * The resolved provider is wrapped with EventEmittingProvider so that
 * events are emitted at the adapter layer, not the storage layer.
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
    const inner = new PMOTicketProvider(storage, projectId)
    return wrapWithEvents(inner, db, storage, projectId)
  }

  if (source === 'linear') {
    const inner = new LinearTicketProvider(db, storage, projectId, null)
    return wrapWithEvents(inner, db, storage, projectId)
  }

  if (source === 'clickup') {
    const inner = new ClickUpTicketProvider(db, storage, projectId)
    return wrapWithEvents(inner, db, storage, projectId)
  }

  if (source === 'trello') {
    const inner = new TrelloTicketProvider(db, storage, projectId, null)
    return wrapWithEvents(inner, db, storage, projectId)
  }

  if (source === 'github') {
    const inner = new GitHubIssuesTicketProvider(db, storage, projectId)
    return wrapWithEvents(inner, db, storage, projectId)
  }

  if (source === 'jira') {
    const inner = new JiraTicketProvider(db, storage, projectId)
    return wrapWithEvents(inner, db, storage, projectId)
  }

  if (source === 'notion') {
    const inner = new NotionTicketProvider(db, storage, projectId)
    return wrapWithEvents(inner, db, storage, projectId)
  }

  // auto: use Linear when it's configured in the workspace
  try {
    if (isLinearConfigured(db)) {
      const inner = new LinearTicketProvider(db, storage, projectId, null)
      return wrapWithEvents(inner, db, storage, projectId)
    }
  } catch {
    // workspace_settings table may not exist in older/test databases
  }

  const inner = new PMOTicketProvider(storage, projectId)
  return wrapWithEvents(inner, db, storage, projectId)
}

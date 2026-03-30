/**
 * Ticket Provider Resolver
 *
 * Determines which provider should handle ticket operations based on
 * the ticket's metadata or workspace configuration.
 *
 * Provider routing uses ticket metadata (external_source, external_key)
 * passed in by the caller. No local mapping table lookups are needed
 * for routing decisions.
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
import { isTrelloConfigured } from '../trello/config.js'
import { isAsanaConfigured } from '../asana/config.js'
import type { StateCategory } from '../pmo/types.js'
import type { TicketProvider, ProviderStorage } from './types.js'
import { PMOTicketProvider } from './pmo-provider.js'
import { LinearTicketProvider } from './linear-provider.js'
import { ClickUpTicketProvider } from './clickup-provider.js'
import { TrelloTicketProvider } from './trello-provider.js'
import { GitHubIssuesTicketProvider } from './github-provider.js'
import { JiraTicketProvider } from './jira-provider.js'
import { AsanaTicketProvider } from './asana-provider.js'
import { EventEmittingProvider, type StatusResolver } from './event-emitting-provider.js'

/**
 * Create a StatusResolver backed by the database.
 * Uses workflow_statuses for status name resolution (config data).
 * Uses ticket_refs for current ticket status lookup (runtime cache).
 */
function createDbStatusResolver(db: Database.Database): StatusResolver {
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
      // Use ticket_refs for status lookup (lightweight runtime cache)
      try {
        const row = db.prepare(`
          SELECT status FROM ticket_refs
          WHERE id = ? OR external_key = ? OR external_id = ?
        `).get(ticketId, ticketId, ticketId) as { status: string | null } | undefined

        if (row?.status) {
          return {
            statusId: null,
            statusName: row.status,
            statusCategory: null,
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
  projectId: string,
): TicketProvider {
  const resolver = createDbStatusResolver(db)
  return new EventEmittingProvider(provider, resolver, projectId)
}

/**
 * Resolve the correct provider for a given ticket.
 *
 * Uses the ticket's metadata to determine the source of truth:
 * - external_source = 'linear' + configured → Linear
 * - external_source = 'clickup' + configured → ClickUp
 * - etc.
 * - Otherwise → PMO
 *
 * @param ticketId - The ticket ID (may be external key like PRLT-123)
 * @param projectId - The project ID
 * @param db - Database handle for config lookups
 * @param storage - Storage for non-Linear providers (optional, may be null)
 * @param metadata - Ticket metadata (contains external_source, etc.)
 * @returns The appropriate TicketProvider for this ticket
 */
export function resolveTicketProvider(
  ticketId: string,
  projectId: string,
  db: Database.Database,
  storage: ProviderStorage | null,
  metadata?: Record<string, string> | null,
): TicketProvider {
  const externalSource = metadata?.external_source

  // Check Linear — queries Linear API directly, no local mirror
  if (externalSource === 'linear' && isLinearConfigured(db)) {
    const inner = new LinearTicketProvider(db, projectId, ticketId)
    return wrapWithEvents(inner, db, projectId)
  }

  // For tickets with external_key/external_id but no explicit source,
  // check if Linear is configured and use it (PRLT-1167 external-only tickets)
  if (!externalSource && (metadata?.external_key || metadata?.external_id) && isLinearConfigured(db)) {
    const inner = new LinearTicketProvider(db, projectId, ticketId)
    return wrapWithEvents(inner, db, projectId)
  }

  // Check ClickUp
  if (externalSource === 'clickup' && isClickUpConfigured(db) && storage) {
    const inner = new ClickUpTicketProvider(db, storage, projectId)
    return wrapWithEvents(inner, db, projectId)
  }

  // Check Jira
  if (externalSource === 'jira' && isJiraConfigured(db) && storage) {
    const inner = new JiraTicketProvider(db, storage, projectId)
    return wrapWithEvents(inner, db, projectId)
  }

  // Check Trello
  if (externalSource === 'trello' && isTrelloConfigured(db) && storage) {
    const inner = new TrelloTicketProvider(db, storage, projectId, null)
    return wrapWithEvents(inner, db, projectId)
  }

  // Check GitHub Issues
  if (externalSource === 'github' && isGitHubConfigured(db) && storage) {
    const inner = new GitHubIssuesTicketProvider(db, storage, projectId)
    return wrapWithEvents(inner, db, projectId)
  }

  // Check Asana
  if (externalSource === 'asana' && isAsanaConfigured(db) && storage) {
    const inner = new AsanaTicketProvider(db, storage, projectId)
    return wrapWithEvents(inner, db, projectId)
  }

  // Default: local PMO (only if storage is available)
  if (storage) {
    const inner = new PMOTicketProvider(storage, projectId)
    return wrapWithEvents(inner, db, projectId)
  }

  // Last resort: Linear if configured, otherwise error
  if (isLinearConfigured(db)) {
    const inner = new LinearTicketProvider(db, projectId, ticketId)
    return wrapWithEvents(inner, db, projectId)
  }

  // Return a no-op PMO provider that will fail gracefully
  const inner = new PMOTicketProvider(storage!, projectId)
  return wrapWithEvents(inner, db, projectId)
}

/**
 * Resolve the correct provider for project-level operations (list, create).
 *
 * Unlike resolveTicketProvider, this doesn't require a specific ticket.
 * It checks workspace configuration to determine the active provider.
 *
 * @param db - Database handle for config lookups
 * @param storage - Storage instance (optional, may be null for Linear-only)
 * @param projectId - The project ID
 * @param source - Optional source hint ('pmo', 'linear', or 'auto')
 * @returns The appropriate TicketProvider
 */
export function resolveProjectProvider(
  db: Database.Database,
  storage: ProviderStorage | null,
  projectId: string,
  source?: string,
): TicketProvider {
  if (source === 'pmo' && storage) {
    const inner = new PMOTicketProvider(storage, projectId)
    return wrapWithEvents(inner, db, projectId)
  }

  if (source === 'linear') {
    const inner = new LinearTicketProvider(db, projectId, null)
    return wrapWithEvents(inner, db, projectId)
  }

  if (source === 'clickup' && storage) {
    const inner = new ClickUpTicketProvider(db, storage, projectId)
    return wrapWithEvents(inner, db, projectId)
  }

  if (source === 'trello' && storage) {
    const inner = new TrelloTicketProvider(db, storage, projectId, null)
    return wrapWithEvents(inner, db, projectId)
  }

  if (source === 'github' && storage) {
    const inner = new GitHubIssuesTicketProvider(db, storage, projectId)
    return wrapWithEvents(inner, db, projectId)
  }

  if (source === 'jira' && storage) {
    const inner = new JiraTicketProvider(db, storage, projectId)
    return wrapWithEvents(inner, db, projectId)
  }

  if (source === 'asana' && storage) {
    const inner = new AsanaTicketProvider(db, storage, projectId)
    return wrapWithEvents(inner, db, projectId)
  }

  // auto: use Linear when it's configured in the workspace
  try {
    if (isLinearConfigured(db)) {
      const inner = new LinearTicketProvider(db, projectId, null)
      return wrapWithEvents(inner, db, projectId)
    }
  } catch {
    // workspace_settings table may not exist in older/test databases
  }

  if (storage) {
    const inner = new PMOTicketProvider(storage, projectId)
    return wrapWithEvents(inner, db, projectId)
  }

  // Last resort: return Linear provider if available
  const inner = new LinearTicketProvider(db, projectId, null)
  return wrapWithEvents(inner, db, projectId)
}

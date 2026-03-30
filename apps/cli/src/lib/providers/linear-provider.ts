/**
 * Linear Ticket Provider
 *
 * Reads and writes ticket data directly from/to the Linear API.
 * No local PMO mirror — Linear is the single source of truth for
 * tickets that originate from Linear.
 */

import type Database from 'better-sqlite3'
import { LinearClient } from '../linear/client.js'
import { getLinearApiKey, resolveLinearTeamKey } from '../linear/config.js'
import { findMatchingLinearState } from '../external-issues/outbound-sync.js'
import { listLinearIssues, getLinearIssueByIdentifier } from '../external-issues/linear.js'
import { PMO_PRIORITY_TO_LINEAR, LINEAR_PRIORITY_TO_PMO } from '../linear/types.js'
import type { Ticket, TicketFilter, CreateTicketInput, UpdateTicketInput } from '../pmo/types.js'
import type {
  TicketProvider,
  ProviderMoveResult,
  ProviderDeleteResult,
  ProviderListResult,
  ProviderCreateResult,
  ProviderGetResult,
  ProviderUpdateResult,
  ProviderAssignResult,
} from './types.js'

export class LinearTicketProvider implements TicketProvider {
  readonly name = 'linear' as const

  constructor(
    private db: Database.Database,
    private projectId: string,
    private ticketId: string | null,
  ) {}

  private getApiKeyOrFail(): string {
    const apiKey = getLinearApiKey(this.db)
    if (!apiKey) throw new Error('Linear API key not configured')
    return apiKey
  }

  async moveTicket(ticketId: string, newState: string): Promise<ProviderMoveResult> {
    const apiKey = getLinearApiKey(this.db)
    if (!apiKey) {
      return { success: false, provider: 'linear', error: 'Linear API key not configured' }
    }

    // Resolve the Linear issue ID from ticket metadata in ticket_refs
    const linearIssueId = this.resolveLinearIssueId(ticketId)
    const teamKey = this.resolveTeamKey(ticketId)

    if (!linearIssueId || !teamKey) {
      return { success: false, provider: 'linear', error: `No Linear issue ID found for ticket ${ticketId}` }
    }

    const client = new LinearClient(apiKey)

    let team: { id: string; key: string; name: string } | null
    try {
      team = await client.getTeamByKey(teamKey)
    } catch (error) {
      return {
        success: false,
        provider: 'linear',
        error: `Failed to get Linear team: ${error instanceof Error ? error.message : String(error)}`,
      }
    }

    if (!team) {
      return { success: false, provider: 'linear', error: `Linear team not found: ${teamKey}` }
    }

    let states: Array<{ id: string; name: string; type: string }>
    try {
      states = await client.listStates(team.id)
    } catch (error) {
      return {
        success: false,
        provider: 'linear',
        error: `Failed to list Linear states: ${error instanceof Error ? error.message : String(error)}`,
      }
    }

    const categoryType = mapPMOStateToLinearType(newState)
    const matchingState = findMatchingLinearState(states, newState, categoryType)

    if (!matchingState) {
      return {
        success: false,
        provider: 'linear',
        error: `No matching Linear state for "${newState}" (category: ${categoryType})`,
      }
    }

    try {
      await client.updateIssueState(linearIssueId, matchingState.id)
    } catch (error) {
      return {
        success: false,
        provider: 'linear',
        error: `Failed to update Linear issue: ${error instanceof Error ? error.message : String(error)}`,
      }
    }

    // Update ticket_refs cache with new status
    try {
      this.db.prepare(`
        UPDATE ticket_refs SET status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? OR external_id = ?
      `).run(matchingState.name, ticketId, linearIssueId)
    } catch {
      // Non-fatal: ticket_refs is a cache
    }

    // Post a comment about the status change
    try {
      await client.addComment(
        linearIssueId,
        `Status updated to **${newState}** (via prlt)`,
      )
    } catch {
      // Non-fatal: comment is informational
    }

    return { success: true, provider: 'linear' }
  }

  async deleteTicket(ticketId: string): Promise<ProviderDeleteResult> {
    let apiKey: string
    try {
      apiKey = this.getApiKeyOrFail()
    } catch {
      return { success: false, provider: 'linear', error: 'Linear API key not configured' }
    }

    const linearIssueId = this.resolveLinearIssueId(ticketId)

    if (linearIssueId) {
      const client = new LinearClient(apiKey)
      try {
        await client.archiveIssue(linearIssueId)
      } catch (error) {
        return {
          success: false,
          provider: 'linear',
          error: `Failed to archive Linear issue: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
    }

    // Remove from ticket_refs cache
    try {
      this.db.prepare('DELETE FROM ticket_refs WHERE id = ? OR external_id = ?').run(ticketId, linearIssueId)
    } catch {
      // Non-fatal
    }

    return { success: true, provider: 'linear' }
  }

  async listTickets(projectId?: string, filter?: TicketFilter): Promise<ProviderListResult> {
    let apiKey: string
    try {
      apiKey = this.getApiKeyOrFail()
    } catch {
      return { success: false, provider: 'linear', tickets: [], error: 'Linear API key not configured' }
    }

    const team = resolveLinearTeamKey(this.db)

    try {
      const envelopes = await listLinearIssues({ apiKey, team: team ?? undefined }, { limit: 50 })

      let tickets: Ticket[] = envelopes.map(envelope => ({
        id: envelope.source.externalKey,
        title: envelope.title,
        description: envelope.description || undefined,
        priority: envelope.priority || undefined,
        category: envelope.category || undefined,
        projectId: envelope.projectKey,
        projectName: envelope.projectKey,
        statusId: envelope.status,
        statusName: envelope.status,
        owner: envelope.assignee || undefined,
        assignee: envelope.assignee || undefined,
        subtasks: [],
        labels: envelope.labels,
        metadata: {
          external_source: envelope.source.name,
          external_key: envelope.source.externalKey,
          external_id: envelope.source.externalId,
          external_url: envelope.source.url,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      }))

      // Apply client-side filters
      if (filter?.priority) {
        tickets = tickets.filter(t => t.priority === filter.priority)
      }
      if (filter?.column) {
        tickets = tickets.filter(t => t.statusName === filter.column)
      }
      if (filter?.category) {
        tickets = tickets.filter(t => t.category === filter.category)
      }
      if (filter?.search) {
        const term = filter.search.toLowerCase()
        tickets = tickets.filter(t =>
          t.title.toLowerCase().includes(term) ||
          (t.description || '').toLowerCase().includes(term),
        )
      }
      if (filter?.label) {
        const label = filter.label.toLowerCase()
        tickets = tickets.filter(t => t.labels.some(l => l.toLowerCase() === label))
      }

      return { success: true, provider: 'linear', tickets }
    } catch (error) {
      return {
        success: false,
        provider: 'linear',
        tickets: [],
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async createTicket(projectId: string, input: CreateTicketInput): Promise<ProviderCreateResult> {
    let apiKey: string
    try {
      apiKey = this.getApiKeyOrFail()
    } catch {
      return { success: false, provider: 'linear', error: 'Linear API key not configured' }
    }

    const client = new LinearClient(apiKey)
    const teamKeyOverride = input.metadata?.['linear.team']
    const teamKey = resolveLinearTeamKey(this.db, teamKeyOverride)

    if (!teamKey) {
      return { success: false, provider: 'linear', error: 'Linear team key is required. Run "prlt linear connect" to configure, or pass --team.' }
    }

    const team = await client.getTeamByKey(teamKey)
    if (!team) {
      return { success: false, provider: 'linear', error: `Linear team "${teamKey}" not found.` }
    }

    try {
      const linearPriority = input.priority ? PMO_PRIORITY_TO_LINEAR[input.priority] : undefined

      let labelIds: string[] | undefined
      if (input.labels && input.labels.length > 0) {
        try {
          const availableLabels = await client.listLabels(team.id)
          labelIds = input.labels
            .map(name => availableLabels.find(l => l.name.toLowerCase() === name.toLowerCase())?.id)
            .filter((id): id is string => !!id)
          if (labelIds.length === 0) labelIds = undefined
        } catch {
          // Non-fatal: label resolution is best-effort
        }
      }

      const issue = await client.createIssue({
        teamId: team.id,
        title: input.title,
        description: input.description,
        priority: linearPriority,
        labelIds,
      })

      // Return a ticket shaped from the Linear API response — no local PMO mirror
      const ticket: Ticket = {
        id: issue.identifier,
        title: issue.title,
        description: input.description || undefined,
        priority: input.priority || LINEAR_PRIORITY_TO_PMO[issue.priority] || undefined,
        category: input.category || undefined,
        projectId: team.key,
        projectName: team.key,
        statusId: issue.state.name,
        statusName: issue.state.name,
        owner: undefined,
        assignee: undefined,
        subtasks: [],
        labels: input.labels || [],
        metadata: {
          external_source: 'linear',
          external_id: issue.id,
          external_key: issue.identifier,
          external_url: issue.url,
          'linear.issue_id': issue.id,
          'linear.identifier': issue.identifier,
          'linear.url': issue.url,
          'linear.team': issue.team.key,
          'linear.state': issue.state.name,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      // Cache in ticket_refs for runtime lookups
      try {
        this.db.prepare(`
          INSERT OR REPLACE INTO ticket_refs
            (id, provider, external_id, external_key, external_url, title, description, status, priority, category, project_id, cached_at, updated_at)
          VALUES (?, 'linear', ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).run(
          issue.identifier,
          issue.id,
          issue.identifier,
          issue.url,
          issue.title,
          input.description || null,
          issue.state.name,
          input.priority || null,
          input.category || null,
          team.key,
        )
      } catch {
        // Non-fatal: ticket_refs is a cache
      }

      return { success: true, provider: 'linear', ticket }
    } catch (error) {
      return {
        success: false,
        provider: 'linear',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async getTicket(ticketId: string): Promise<ProviderGetResult> {
    // Query Linear API directly for live data
    let apiKey: string
    try {
      apiKey = this.getApiKeyOrFail()
    } catch {
      return { success: false, provider: 'linear', error: 'Linear API key not configured' }
    }

    try {
      // Try to get by identifier (e.g., PRLT-123)
      const envelope = await getLinearIssueByIdentifier({ apiKey }, ticketId)

      if (!envelope) {
        // Fall back to ticket_refs cache if API doesn't find it
        const cached = this.getTicketFromCache(ticketId)
        if (cached) {
          return { success: true, provider: 'linear', ticket: cached }
        }
        return { success: true, provider: 'linear', ticket: null }
      }

      const ticket: Ticket = {
        id: envelope.source.externalKey,
        title: envelope.title,
        description: envelope.description || undefined,
        priority: envelope.priority || undefined,
        category: envelope.category || undefined,
        projectId: envelope.projectKey,
        projectName: envelope.projectKey,
        statusId: envelope.status,
        statusName: envelope.status,
        owner: envelope.assignee || undefined,
        assignee: envelope.assignee || undefined,
        subtasks: [],
        labels: envelope.labels,
        metadata: {
          external_source: envelope.source.name,
          external_key: envelope.source.externalKey,
          external_id: envelope.source.externalId,
          external_url: envelope.source.url,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      return { success: true, provider: 'linear', ticket }
    } catch (error) {
      // Fall back to ticket_refs cache on API errors
      const cached = this.getTicketFromCache(ticketId)
      if (cached) {
        return { success: true, provider: 'linear', ticket: cached }
      }
      return {
        success: false,
        provider: 'linear',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async updateTicket(ticketId: string, input: UpdateTicketInput): Promise<ProviderUpdateResult> {
    let apiKey: string
    try {
      apiKey = this.getApiKeyOrFail()
    } catch {
      return { success: false, provider: 'linear', error: 'Linear API key not configured' }
    }

    const linearIssueId = this.resolveLinearIssueId(ticketId)

    if (linearIssueId) {
      const linearInput: { title?: string; description?: string; priority?: number } = {}
      if (input.title !== undefined) linearInput.title = input.title
      if (input.description !== undefined) linearInput.description = input.description ?? undefined
      if (input.priority !== undefined) {
        linearInput.priority = input.priority ? PMO_PRIORITY_TO_LINEAR[input.priority] : undefined
      }

      if (Object.keys(linearInput).length > 0) {
        const client = new LinearClient(apiKey)
        try {
          await client.updateIssue(linearIssueId, linearInput)
        } catch (error) {
          return {
            success: false,
            provider: 'linear',
            error: `Failed to update Linear issue: ${error instanceof Error ? error.message : String(error)}`,
          }
        }
      }
    }

    // Update ticket_refs cache
    try {
      const setClauses: string[] = ['updated_at = CURRENT_TIMESTAMP']
      const params: unknown[] = []
      if (input.title !== undefined) { setClauses.push('title = ?'); params.push(input.title) }
      if (input.description !== undefined) { setClauses.push('description = ?'); params.push(input.description) }
      if (input.priority !== undefined) { setClauses.push('priority = ?'); params.push(input.priority) }
      if ('assignee' in input) { setClauses.push('assignee = ?'); params.push((input as Record<string, unknown>).assignee) }
      params.push(ticketId, linearIssueId)
      this.db.prepare(`UPDATE ticket_refs SET ${setClauses.join(', ')} WHERE id = ? OR external_id = ?`).run(...params)
    } catch {
      // Non-fatal
    }

    // Return the updated ticket by fetching it live
    return this.getTicket(ticketId) as Promise<ProviderUpdateResult>
  }

  async assignTicket(ticketId: string, assignee: string): Promise<ProviderAssignResult> {
    let apiKey: string
    try {
      apiKey = this.getApiKeyOrFail()
    } catch {
      return { success: false, provider: 'linear', error: 'Linear API key not configured' }
    }

    const linearIssueId = this.resolveLinearIssueId(ticketId)

    if (linearIssueId) {
      const client = new LinearClient(apiKey)
      try {
        await client.assignIssue(linearIssueId, assignee)
      } catch {
        // Non-fatal: assignee may not be a valid Linear email
      }
    }

    // Update ticket_refs cache
    try {
      this.db.prepare('UPDATE ticket_refs SET assignee = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? OR external_id = ?')
        .run(assignee, ticketId, linearIssueId)
    } catch {
      // Non-fatal
    }

    return { success: true, provider: 'linear' }
  }

  /**
   * Resolve the Linear issue UUID from ticket_refs or agent_work metadata.
   * Checks multiple sources since the ticket ID may be the external key (PRLT-123)
   * or the internal ref ID.
   */
  private resolveLinearIssueId(ticketId: string): string | null {
    try {
      // Check ticket_refs first
      const ref = this.db.prepare(
        `SELECT external_id FROM ticket_refs WHERE id = ? OR external_key = ? OR external_id = ?`,
      ).get(ticketId, ticketId, ticketId) as { external_id: string | null } | undefined

      if (ref?.external_id) return ref.external_id

      // Check agent_work metadata
      const work = this.db.prepare(
        `SELECT ticket_metadata FROM agent_work WHERE ticket_id = ?`,
      ).get(ticketId) as { ticket_metadata: string | null } | undefined

      if (work?.ticket_metadata) {
        try {
          const meta = JSON.parse(work.ticket_metadata)
          if (meta.external_id) return meta.external_id
          if (meta['linear.issue_id']) return meta['linear.issue_id']
        } catch {
          // Invalid JSON
        }
      }
    } catch {
      // Table may not exist in test environments
    }
    return null
  }

  /**
   * Resolve the Linear team key from ticket_refs or workspace config.
   */
  private resolveTeamKey(ticketId: string): string | null {
    // Try to extract from ticket ID (e.g., PRLT-123 → PRLT)
    const match = ticketId.match(/^([A-Z]+)-\d+$/)
    if (match) return match[1]

    // Fall back to workspace default
    return resolveLinearTeamKey(this.db)
  }

  /**
   * Get a ticket from the ticket_refs cache.
   */
  private getTicketFromCache(ticketId: string): Ticket | null {
    try {
      const row = this.db.prepare(
        `SELECT * FROM ticket_refs WHERE id = ? OR external_key = ? OR external_id = ?`,
      ).get(ticketId, ticketId, ticketId) as Record<string, unknown> | undefined

      if (!row) return null

      return {
        id: String(row.id ?? row.external_key ?? ticketId),
        title: String(row.title ?? ''),
        description: row.description ? String(row.description) : undefined,
        priority: row.priority ? String(row.priority) : undefined,
        category: row.category ? String(row.category) : undefined,
        projectId: row.project_id ? String(row.project_id) : '',
        projectName: row.project_id ? String(row.project_id) : '',
        statusId: row.status ? String(row.status) : 'unknown',
        statusName: row.status ? String(row.status) : undefined,
        owner: row.assignee ? String(row.assignee) : undefined,
        assignee: row.assignee ? String(row.assignee) : undefined,
        subtasks: [],
        labels: [],
        metadata: {
          external_source: 'linear',
          external_key: row.external_key ? String(row.external_key) : '',
          external_id: row.external_id ? String(row.external_id) : '',
          external_url: row.external_url ? String(row.external_url) : '',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    } catch {
      return null
    }
  }
}

/**
 * Map a PMO status name to the most likely Linear state type.
 * Used as a fallback when exact name matching fails.
 */
function mapPMOStateToLinearType(stateName: string): string {
  const lower = stateName.toLowerCase()
  if (lower.includes('review') || lower.includes('in progress') || lower.includes('started')) {
    return 'started'
  }
  if (lower.includes('done') || lower.includes('complete') || lower.includes('merged')) {
    return 'completed'
  }
  if (lower.includes('backlog')) {
    return 'backlog'
  }
  if (lower.includes('cancel')) {
    return 'canceled'
  }
  if (lower.includes('triage')) {
    return 'triage'
  }
  return 'started'
}

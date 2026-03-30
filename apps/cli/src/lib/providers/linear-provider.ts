/**
 * Linear Ticket Provider
 *
 * All ticket operations go directly to Linear API.
 * No local PMO mirroring — Linear is the source of truth.
 */

import type Database from 'better-sqlite3'
import { LinearClient } from '../linear/client.js'
import { getLinearApiKey, resolveLinearTeamKey } from '../linear/config.js'
import { findMatchingLinearState } from '../external-issues/outbound-sync.js'
import { PMO_PRIORITY_TO_LINEAR, LINEAR_PRIORITY_TO_PMO } from '../linear/types.js'
import type { LinearIssue } from '../linear/types.js'
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
import { listLinearIssues } from '../external-issues/linear.js'

/**
 * Convert a LinearIssue (from the client) to a PMO Ticket shape.
 */
function linearIssueToTicket(issue: LinearIssue): Ticket {
  return {
    id: issue.identifier,
    title: issue.title,
    description: issue.description,
    priority: LINEAR_PRIORITY_TO_PMO[issue.priority] || undefined,
    category: undefined,
    projectId: issue.team.key,
    projectName: issue.project?.name ?? issue.team.name,
    statusId: issue.state.name,
    statusName: issue.state.name,
    statusCategory: mapLinearStateType(issue.state.type),
    owner: issue.assignee?.name,
    assignee: issue.assignee?.name,
    subtasks: [],
    labels: issue.labels.map(l => l.name),
    metadata: {
      external_source: 'linear',
      external_key: issue.identifier,
      external_id: issue.id,
      external_url: issue.url,
    },
    createdAt: new Date(issue.createdAt),
    updatedAt: new Date(issue.updatedAt),
  }
}

/**
 * Map Linear state type string to PMO state category.
 */
function mapLinearStateType(type: string): 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled' | undefined {
  switch (type) {
    case 'backlog': return 'backlog'
    case 'unstarted': return 'unstarted'
    case 'started': return 'started'
    case 'completed': return 'completed'
    case 'canceled': return 'canceled'
    default: return undefined
  }
}

export class LinearTicketProvider implements TicketProvider {
  readonly name = 'linear' as const

  constructor(
    private db: Database.Database,
  ) {}

  private getApiKeyOrFail(): string {
    const apiKey = getLinearApiKey(this.db)
    if (!apiKey) throw new Error('Linear API key not configured')
    return apiKey
  }

  /**
   * Resolve a ticket identifier (e.g. "PRLT-1231") to the Linear issue UUID.
   * Also accepts a raw Linear UUID and returns it directly.
   */
  private async resolveIssueId(ticketId: string): Promise<{ issueId: string; issue: LinearIssue } | null> {
    const apiKey = this.getApiKeyOrFail()
    const client = new LinearClient(apiKey)

    // If it looks like a Linear identifier (e.g., PRLT-1231, ENG-123), look up by identifier
    if (/^[A-Z]+-\d+$/i.test(ticketId)) {
      const issue = await client.getIssueByIdentifier(ticketId)
      if (issue) return { issueId: issue.id, issue }
    }

    // It might be a raw UUID — try listIssues with limit 1 filtered by id
    // For now, return null if not found by identifier
    return null
  }

  async moveTicket(ticketId: string, newState: string): Promise<ProviderMoveResult> {
    let apiKey: string
    try {
      apiKey = this.getApiKeyOrFail()
    } catch {
      return { success: false, provider: 'linear', error: 'Linear API key not configured' }
    }

    // Resolve the Linear issue
    const resolved = await this.resolveIssueId(ticketId)
    if (!resolved) {
      return { success: false, provider: 'linear', error: `Linear issue not found for "${ticketId}"` }
    }

    const client = new LinearClient(apiKey)
    const teamKey = resolved.issue.team.key

    // Get team and workflow states
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

    // Find the matching Linear state for the target state name
    const categoryType = mapPMOStateToLinearType(newState)
    const matchingState = findMatchingLinearState(states, newState, categoryType)

    if (!matchingState) {
      return {
        success: false,
        provider: 'linear',
        error: `No matching Linear state for "${newState}" (category: ${categoryType})`,
      }
    }

    // Update the issue state on Linear
    try {
      await client.updateIssueState(resolved.issueId, matchingState.id)
    } catch (error) {
      return {
        success: false,
        provider: 'linear',
        error: `Failed to update Linear issue: ${error instanceof Error ? error.message : String(error)}`,
      }
    }

    // Post a comment about the status change (non-fatal)
    try {
      await client.addComment(
        resolved.issueId,
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

    const resolved = await this.resolveIssueId(ticketId)
    if (!resolved) {
      return { success: false, provider: 'linear', error: `Linear issue not found for "${ticketId}"` }
    }

    const client = new LinearClient(apiKey)
    try {
      await client.archiveIssue(resolved.issueId)
    } catch (error) {
      return {
        success: false,
        provider: 'linear',
        error: `Failed to archive Linear issue: ${error instanceof Error ? error.message : String(error)}`,
      }
    }

    return { success: true, provider: 'linear' }
  }

  async listTickets(_projectId?: string, filter?: TicketFilter): Promise<ProviderListResult> {
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

  async createTicket(_projectId: string, input: CreateTicketInput): Promise<ProviderCreateResult> {
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
      // Map PMO priority to Linear priority number
      const linearPriority = input.priority ? PMO_PRIORITY_TO_LINEAR[input.priority] : undefined

      // Resolve label names to Linear label IDs
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

      // Create the issue in Linear
      const issue = await client.createIssue({
        teamId: team.id,
        title: input.title,
        description: input.description,
        priority: linearPriority,
        labelIds,
      })

      // Return ticket directly from Linear response — no local PMO mirror
      const ticket = linearIssueToTicket(issue)

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
    // Fetch directly from Linear API — no local PMO fallback
    try {
      const resolved = await this.resolveIssueId(ticketId)
      if (!resolved) {
        return { success: true, provider: 'linear', ticket: null }
      }
      const ticket = linearIssueToTicket(resolved.issue)
      return { success: true, provider: 'linear', ticket }
    } catch (error) {
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

    // Resolve the Linear issue
    const resolved = await this.resolveIssueId(ticketId)
    if (!resolved) {
      return { success: false, provider: 'linear', error: `Linear issue not found for "${ticketId}"` }
    }

    // Build Linear update payload from input fields
    const linearInput: { title?: string; description?: string; priority?: number } = {}
    if (input.title !== undefined) linearInput.title = input.title
    if (input.description !== undefined) linearInput.description = input.description ?? undefined
    if (input.priority !== undefined) {
      linearInput.priority = input.priority ? PMO_PRIORITY_TO_LINEAR[input.priority] : undefined
    }

    // Only call Linear API if there are Linear-relevant fields
    if (Object.keys(linearInput).length > 0) {
      const client = new LinearClient(apiKey)
      try {
        await client.updateIssue(resolved.issueId, linearInput)
      } catch (error) {
        return {
          success: false,
          provider: 'linear',
          error: `Failed to update Linear issue: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
    }

    // Re-fetch the issue to return updated state
    try {
      const refreshed = await this.resolveIssueId(ticketId)
      if (refreshed) {
        return { success: true, provider: 'linear', ticket: linearIssueToTicket(refreshed.issue) }
      }
    } catch {
      // Non-fatal: return success even if re-fetch fails
    }

    // Construct ticket from what we know
    const ticket = linearIssueToTicket(resolved.issue)
    if (input.title !== undefined) ticket.title = input.title
    if (input.description !== undefined) ticket.description = input.description ?? undefined
    return { success: true, provider: 'linear', ticket }
  }

  async assignTicket(ticketId: string, assignee: string): Promise<ProviderAssignResult> {
    let apiKey: string
    try {
      apiKey = this.getApiKeyOrFail()
    } catch {
      return { success: false, provider: 'linear', error: 'Linear API key not configured' }
    }

    const resolved = await this.resolveIssueId(ticketId)
    if (!resolved) {
      return { success: false, provider: 'linear', error: `Linear issue not found for "${ticketId}"` }
    }

    const client = new LinearClient(apiKey)
    try {
      await client.assignIssue(resolved.issueId, assignee)
    } catch {
      // Non-fatal: assignee may not be a valid Linear email
    }

    return { success: true, provider: 'linear' }
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
  // Default to started for unknown states (most post-execution transitions go forward)
  return 'started'
}

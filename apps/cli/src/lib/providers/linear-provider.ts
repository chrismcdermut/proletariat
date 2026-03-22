/**
 * Linear Ticket Provider
 *
 * Writes ticket operations directly to Linear via API,
 * then updates local PMO to keep it in sync.
 *
 * Emits work:status_changed with source='linear' so the outbound sync
 * handler skips Linear (avoiding double-write).
 */

import type Database from 'better-sqlite3'
import { LinearClient } from '../linear/client.js'
import { LinearMapper } from '../linear/mapper.js'
import { getLinearApiKey, loadLinearConfig } from '../linear/config.js'
import { findMatchingLinearState } from '../external-issues/outbound-sync.js'
import { listLinearIssues } from '../external-issues/linear.js'
import { PMO_PRIORITY_TO_LINEAR, LINEAR_PRIORITY_TO_PMO } from '../linear/types.js'
import type { Ticket, TicketFilter, CreateTicketInput } from '../pmo/types.js'
import type {
  TicketProvider,
  ProviderMoveResult,
  ProviderDeleteResult,
  ProviderListResult,
  ProviderCreateResult,
  ProviderGetResult,
  ProviderUpdateResult,
  ProviderCommentResult,
  ProviderStorage,
} from './types.js'

export class LinearTicketProvider implements TicketProvider {
  readonly name = 'linear' as const

  constructor(
    private db: Database.Database,
    private storage: ProviderStorage,
    private projectId: string,
    private ticketStatusCategory: string | null,
  ) {}

  private getApiKeyOrFail(): string {
    const apiKey = getLinearApiKey(this.db)
    if (!apiKey) throw new Error('Linear API key not configured')
    return apiKey
  }

  async moveTicket(ticketId: string, newState: string): Promise<ProviderMoveResult> {
    // 1. Get Linear API key
    const apiKey = getLinearApiKey(this.db)
    if (!apiKey) {
      return { success: false, provider: 'linear', error: 'Linear API key not configured' }
    }

    // 2. Look up Linear mapping for this PMO ticket
    const mapper = new LinearMapper(this.db)
    const mapping = mapper.getByTicketId(ticketId)
    if (!mapping) {
      return { success: false, provider: 'linear', error: `No Linear mapping for ticket ${ticketId}` }
    }

    // 3. Get Linear team's workflow states
    const client = new LinearClient(apiKey)

    let team: { id: string; key: string; name: string } | null
    try {
      team = await client.getTeamByKey(mapping.linearTeamKey)
    } catch (error) {
      return {
        success: false,
        provider: 'linear',
        error: `Failed to get Linear team: ${error instanceof Error ? error.message : String(error)}`,
      }
    }

    if (!team) {
      return { success: false, provider: 'linear', error: `Linear team not found: ${mapping.linearTeamKey}` }
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

    // 4. Find the matching Linear state for the target PMO state
    // Map PMO status category to Linear state type for category matching
    const categoryType = mapPMOStateToLinearType(newState)
    const matchingState = findMatchingLinearState(states, newState, categoryType)

    if (!matchingState) {
      return {
        success: false,
        provider: 'linear',
        error: `No matching Linear state for "${newState}" (category: ${categoryType})`,
      }
    }

    // 5. Update the issue state on Linear
    try {
      await client.updateIssueState(mapping.linearIssueId, matchingState.id)
    } catch (error) {
      return {
        success: false,
        provider: 'linear',
        error: `Failed to update Linear issue: ${error instanceof Error ? error.message : String(error)}`,
      }
    }

    // 6. Also update local PMO to keep it in sync
    try {
      await this.storage.moveTicket(this.projectId, ticketId, newState)
    } catch {
      // Non-fatal: Linear is the source of truth, local PMO is best-effort
    }

    // 7. Post a comment about the status change
    try {
      await client.addComment(
        mapping.linearIssueId,
        `Status updated to **${newState}** (via prlt post-execution transition)`,
      )
    } catch {
      // Non-fatal: comment is informational
    }

    // 8. Update sync timestamp
    try {
      mapper.updateSyncTimestamp(ticketId)
    } catch {
      // Non-fatal
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

    // Look up Linear mapping
    const mapper = new LinearMapper(this.db)
    const mapping = mapper.getByTicketId(ticketId)

    if (mapping) {
      // Archive the issue in Linear
      const client = new LinearClient(apiKey)
      try {
        await client.archiveIssue(mapping.linearIssueId)
      } catch (error) {
        return {
          success: false,
          provider: 'linear',
          error: `Failed to archive Linear issue: ${error instanceof Error ? error.message : String(error)}`,
        }
      }

      // Remove the mapping
      try {
        mapper.deleteMapping(ticketId)
      } catch {
        // Non-fatal
      }
    }

    // Also delete the local PMO mirror
    try {
      await this.storage.deleteTicket(ticketId)
    } catch {
      // Non-fatal if Linear archive succeeded
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

    const linearConfig = loadLinearConfig(this.db)
    const team = linearConfig?.defaultTeamKey || process.env.PRLT_LINEAR_TEAM

    try {
      const envelopes = await listLinearIssues({ apiKey, team }, { limit: 50 })

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
    const linearConfig = loadLinearConfig(this.db)
    const teamKey = linearConfig?.defaultTeamKey || process.env.PRLT_LINEAR_TEAM

    if (!teamKey) {
      return { success: false, provider: 'linear', error: 'Linear team key is required. Set PRLT_LINEAR_TEAM.' }
    }

    const team = await client.getTeamByKey(teamKey)
    if (!team) {
      return { success: false, provider: 'linear', error: `Linear team "${teamKey}" not found.` }
    }

    try {
      // Map PMO priority to Linear priority number
      const linearPriority = input.priority ? PMO_PRIORITY_TO_LINEAR[input.priority] : undefined

      // Create the issue in Linear
      const issue = await client.createIssue({
        teamId: team.id,
        title: input.title,
        description: input.description,
        priority: linearPriority,
      })

      // Create local PMO mirror ticket
      const mirrorDescription = [
        input.description || '',
        '',
        '---',
        `_Created in Linear: [${issue.identifier}](${issue.url})_`,
      ].join('\n').trim()

      const mirrorPriority = input.priority || LINEAR_PRIORITY_TO_PMO[issue.priority] || undefined

      const pmoTicket = await this.storage.createTicket(projectId, {
        ...input,
        title: issue.title,
        description: mirrorDescription,
        priority: mirrorPriority,
        metadata: {
          ...input.metadata,
          'external_source': 'linear',
          'external_id': issue.id,
          'external_key': issue.identifier,
          'external_url': issue.url,
          'linear.issue_id': issue.id,
          'linear.identifier': issue.identifier,
          'linear.url': issue.url,
          'linear.team': issue.team.key,
          'linear.state': issue.state.name,
        },
      })

      // Create mapping record for sync operations
      const mapper = new LinearMapper(this.db)
      mapper.createMapping({
        pmoTicketId: pmoTicket.id,
        linearIssueId: issue.id,
        linearIdentifier: issue.identifier,
        linearTeamKey: issue.team.key,
        linearUrl: issue.url,
        syncDirection: 'outbound',
        createdAt: new Date(),
      })

      return { success: true, provider: 'linear', ticket: pmoTicket }
    } catch (error) {
      return {
        success: false,
        provider: 'linear',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async getTicket(ticketId: string): Promise<ProviderGetResult> {
    // For getTicket, use local PMO since we maintain mirrors
    // This avoids unnecessary API calls for reads
    try {
      const ticket = await this.storage.getTicket(ticketId)
      return { success: true, provider: 'linear', ticket }
    } catch (error) {
      return {
        success: false,
        provider: 'linear',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async updateTicket(ticketId: string, changes: Record<string, unknown>): Promise<ProviderUpdateResult> {
    // Update local PMO mirror
    try {
      const ticket = await this.storage.updateTicket(ticketId, changes)
      return { success: true, provider: 'linear', ticket }
    } catch (error) {
      return {
        success: false,
        provider: 'linear',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async addComment(ticketId: string, body: string): Promise<ProviderCommentResult> {
    let apiKey: string
    try {
      apiKey = this.getApiKeyOrFail()
    } catch {
      return { success: false, provider: 'linear', error: 'Linear API key not configured' }
    }

    const mapper = new LinearMapper(this.db)
    const mapping = mapper.getByTicketId(ticketId)
    if (!mapping) {
      return { success: false, provider: 'linear', error: `No Linear mapping for ticket ${ticketId}` }
    }

    try {
      const client = new LinearClient(apiKey)
      await client.addComment(mapping.linearIssueId, body)
      return { success: true, provider: 'linear' }
    } catch (error) {
      return {
        success: false,
        provider: 'linear',
        error: error instanceof Error ? error.message : String(error),
      }
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
  // Default to started for unknown states (most post-execution transitions go forward)
  return 'started'
}

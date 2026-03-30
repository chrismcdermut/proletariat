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
import { getLinearApiKey, resolveLinearTeamKey } from '../linear/config.js'
import { findMatchingLinearState } from '../external-issues/outbound-sync.js'
import { listLinearIssues } from '../external-issues/linear.js'
import { PMO_PRIORITY_TO_LINEAR, LINEAR_PRIORITY_TO_PMO, LINEAR_STATE_TO_PMO_CATEGORY } from '../linear/types.js'
import type { Ticket, TicketFilter, CreateTicketInput, UpdateTicketInput } from '../pmo/types.js'
import type { NormalizedIssueEnvelope } from '../external-issues/types.js'
import type {
  TicketProvider,
  ProviderMoveResult,
  ProviderDeleteResult,
  ProviderListResult,
  ProviderCreateResult,
  ProviderGetResult,
  ProviderUpdateResult,
  ProviderAssignResult,
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

    const team = resolveLinearTeamKey(this.db)

    try {
      const envelopes = await listLinearIssues({ apiKey, team: team ?? undefined }, { limit: 50 })

      // Sync fetched Linear tickets into local PMO (best-effort, non-blocking)
      try {
        await this.syncEnvelopesToLocalPMO(envelopes, projectId || this.projectId)
      } catch {
        // Non-fatal: sync failure doesn't block list
      }

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

  /**
   * Sync fetched Linear issue envelopes into the local PMO database.
   * Creates or updates pmo_tickets and pmo_external_issue_map entries.
   * Best-effort: sync failures never block the list operation.
   */
  private async syncEnvelopesToLocalPMO(envelopes: NormalizedIssueEnvelope[], targetProjectId: string): Promise<void> {
    try {
      // Resolve the target project — need a valid PMO project for ticket creation
      const resolvedProjectId = this.resolveTargetProject(targetProjectId)
      if (!resolvedProjectId) return

      // Get workflow statuses for status mapping
      const statuses = this.getWorkflowStatuses(resolvedProjectId)

      const mapper = new LinearMapper(this.db)

      for (const envelope of envelopes) {
        try {
          const externalId = envelope.source.externalId
          const externalKey = envelope.source.externalKey
          const raw = envelope.source.raw as Record<string, unknown>
          const stateType = (raw.state as Record<string, unknown> | undefined)?.type as string | undefined
          const teamKey = (raw.team as Record<string, unknown> | undefined)?.key as string | undefined

          // Map Linear state type to PMO status category
          const pmoCategory = stateType ? (LINEAR_STATE_TO_PMO_CATEGORY[stateType] ?? 'backlog') : 'backlog'
          const matchingStatus = statuses.find(s => s.category === pmoCategory)
          const fallbackStatus = statuses.find(s => s.isDefault) ?? statuses[0]
          const targetStatus = matchingStatus ?? fallbackStatus

          // Check if already mapped
          const existing = mapper.getByLinearId(externalId)

          if (existing) {
            // Update the existing PMO ticket with latest Linear data
            try {
              await this.storage.updateTicket(existing.pmoTicketId, {
                title: envelope.title,
                description: envelope.description || undefined,
                priority: envelope.priority || undefined,
                assignee: envelope.assignee || undefined,
                statusId: targetStatus?.id,
                statusName: targetStatus?.name ?? envelope.status,
                metadata: {
                  'external_source': 'linear',
                  'external_key': externalKey,
                  'external_id': externalId,
                  'external_url': envelope.source.url,
                  'linear.issue_id': externalId,
                  'linear.identifier': externalKey,
                  'linear.url': envelope.source.url,
                  'linear.state': envelope.status,
                },
              } as Partial<Ticket>)
            } catch {
              // Non-fatal: update failure doesn't block list
            }

            // Update sync timestamp
            try {
              mapper.updateSyncTimestamp(existing.pmoTicketId)
            } catch {
              // Non-fatal
            }
          } else {
            // Create a new PMO ticket and mapping
            try {
              const ticket = await this.storage.createTicket(resolvedProjectId, {
                title: envelope.title,
                description: envelope.description || undefined,
                priority: envelope.priority || undefined,
                statusId: targetStatus?.id,
                assignee: envelope.assignee || undefined,
                labels: envelope.labels,
                metadata: {
                  'external_source': 'linear',
                  'external_key': externalKey,
                  'external_id': externalId,
                  'external_url': envelope.source.url,
                  'linear.issue_id': externalId,
                  'linear.identifier': externalKey,
                  'linear.url': envelope.source.url,
                  'linear.team': teamKey ?? externalKey.split('-')[0],
                  'linear.state': envelope.status,
                },
              })

              mapper.createMapping({
                pmoTicketId: ticket.id,
                linearIssueId: externalId,
                linearIdentifier: externalKey,
                linearTeamKey: teamKey ?? externalKey.split('-')[0],
                linearUrl: envelope.source.url,
                syncDirection: 'inbound',
                createdAt: new Date(),
              })
            } catch {
              // Non-fatal: creation failure doesn't block list
            }
          }
        } catch {
          // Non-fatal: individual envelope sync failure doesn't block others
        }
      }
    } catch {
      // Non-fatal: entire sync failure doesn't block the list operation
    }
  }

  /**
   * Resolve the target project ID for syncing. Falls back to first available project.
   */
  private resolveTargetProject(projectId: string): string | null {
    if (projectId) return projectId

    // Try to find the first non-archived project
    try {
      const row = this.db.prepare(
        `SELECT id FROM pmo_projects WHERE is_archived = 0 ORDER BY created_at ASC LIMIT 1`,
      ).get() as { id: string } | undefined
      return row?.id ?? null
    } catch {
      return null
    }
  }

  /**
   * Get workflow statuses for a project from the database.
   */
  private getWorkflowStatuses(projectId: string): Array<{ id: string; name: string; category: string; isDefault: boolean }> {
    try {
      const rows = this.db.prepare(`
        SELECT ws.id, ws.name, ws.category, ws.is_default
        FROM pmo_workflow_statuses ws
        JOIN pmo_projects p ON p.workflow_id = ws.workflow_id
        WHERE p.id = ?
        ORDER BY ws.position ASC
      `).all(projectId) as Array<{ id: string; name: string; category: string; is_default: number }>

      return rows.map(r => ({
        id: r.id,
        name: r.name,
        category: r.category,
        isDefault: r.is_default === 1,
      }))
    } catch {
      return []
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

  async updateTicket(ticketId: string, input: UpdateTicketInput): Promise<ProviderUpdateResult> {
    let apiKey: string
    try {
      apiKey = this.getApiKeyOrFail()
    } catch {
      return { success: false, provider: 'linear', error: 'Linear API key not configured' }
    }

    // Look up Linear mapping for this PMO ticket
    const mapper = new LinearMapper(this.db)
    const mapping = mapper.getByTicketId(ticketId)

    if (mapping) {
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
          await client.updateIssue(mapping.linearIssueId, linearInput)
        } catch (error) {
          return {
            success: false,
            provider: 'linear',
            error: `Failed to update Linear issue: ${error instanceof Error ? error.message : String(error)}`,
          }
        }
      }

      // Update sync timestamp
      try {
        mapper.updateSyncTimestamp(ticketId)
      } catch {
        // Non-fatal
      }
    }

    // Also update local PMO mirror
    try {
      const ticket = await this.storage.updateTicket(ticketId, input as Partial<Ticket>)
      return { success: true, provider: 'linear', ticket }
    } catch (error) {
      return {
        success: false,
        provider: 'linear',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async assignTicket(ticketId: string, assignee: string): Promise<ProviderAssignResult> {
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
      const client = new LinearClient(apiKey)
      try {
        // Try to assign by email in Linear (best-effort — assignee may be a local name)
        await client.assignIssue(mapping.linearIssueId, assignee)
      } catch {
        // Non-fatal: assignee may not be a valid Linear email
      }
    }

    // Update local PMO mirror
    try {
      await this.storage.updateTicket(ticketId, { assignee } as Partial<Ticket>)
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

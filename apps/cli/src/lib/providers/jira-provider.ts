/**
 * Jira Ticket Provider
 *
 * Writes ticket operations directly to Jira via REST API,
 * then updates local PMO to keep it in sync.
 *
 * Follows the same pattern as ClickUpTicketProvider:
 * - Write to Jira first (source of truth)
 * - Update local PMO as best-effort mirror
 * - Use ticket metadata for Jira issue key lookups (no separate mapper table)
 *
 * Supports both Jira Cloud (API v3) and Server (API v2).
 */

import type Database from 'better-sqlite3'
import { JiraClient } from '../jira/client.js'
import { getJiraApiToken, loadJiraConfig } from '../jira/config.js'
import {
  PMO_PRIORITY_TO_JIRA,
  JIRA_PRIORITY_TO_PMO,
  JIRA_STATUS_CATEGORY_TO_PMO,
} from '../jira/types.js'
import type { JiraIssue } from '../jira/types.js'
import type { Ticket, TicketFilter, CreateTicketInput, UpdateTicketInput } from '../pmo/types.js'
import type {
  TicketProvider,
  TicketProviderName,
  ProviderMoveResult,
  ProviderDeleteResult,
  ProviderListResult,
  ProviderCreateResult,
  ProviderGetResult,
  ProviderUpdateResult,
  ProviderAssignResult,
  ProviderStorage,
} from './types.js'

export class JiraTicketProvider implements TicketProvider {
  readonly name: TicketProviderName = 'jira'

  constructor(
    private db: Database.Database,
    private storage: ProviderStorage,
    private projectId: string,
  ) {}

  private getClientOrFail(): JiraClient {
    const config = loadJiraConfig(this.db)
    if (!config) throw new Error('Jira is not configured')
    return new JiraClient({
      baseUrl: config.baseUrl,
      email: config.email,
      apiToken: config.apiToken,
    })
  }

  async moveTicket(ticketId: string, newState: string): Promise<ProviderMoveResult> {
    let client: JiraClient
    try {
      client = this.getClientOrFail()
    } catch {
      return { success: false, provider: 'jira', error: 'Jira is not configured' }
    }

    // Look up Jira issue key from ticket metadata
    const ticket = await this.storage.getTicket(ticketId)
    if (!ticket) {
      return { success: false, provider: 'jira', error: `Ticket ${ticketId} not found` }
    }

    const jiraIssueKey = ticket.metadata?.['jira.issue_key']
    if (!jiraIssueKey) {
      return { success: false, provider: 'jira', error: `No Jira mapping for ticket ${ticketId}` }
    }

    // Jira requires transitions, not direct status updates.
    // Get available transitions and find one that matches the target state.
    try {
      const transitions = await client.getTransitions(jiraIssueKey)
      const match = transitions.find(t =>
        t.to.name.toLowerCase() === newState.toLowerCase()
        || t.name.toLowerCase() === newState.toLowerCase(),
      )

      if (!match) {
        const available = transitions.map(t => t.to.name).join(', ')
        return {
          success: false,
          provider: 'jira',
          error: `No Jira transition to "${newState}" for ${jiraIssueKey}. Available: ${available}`,
        }
      }

      await client.transitionIssue(jiraIssueKey, match.id)
    } catch (error) {
      return {
        success: false,
        provider: 'jira',
        error: `Failed to transition Jira issue: ${error instanceof Error ? error.message : String(error)}`,
      }
    }

    // Also update local PMO to keep it in sync
    try {
      await this.storage.moveTicket(this.projectId, ticketId, newState)
    } catch {
      // Non-fatal: Jira is the source of truth
    }

    // Post a comment about the status change
    try {
      await client.addComment(
        jiraIssueKey,
        `Status updated to ${newState} (via prlt)`,
      )
    } catch {
      // Non-fatal: comment is informational
    }

    return { success: true, provider: 'jira' }
  }

  async deleteTicket(ticketId: string): Promise<ProviderDeleteResult> {
    let client: JiraClient
    try {
      client = this.getClientOrFail()
    } catch {
      return { success: false, provider: 'jira', error: 'Jira is not configured' }
    }

    // Look up Jira issue key from ticket metadata
    const ticket = await this.storage.getTicket(ticketId)
    const jiraIssueKey = ticket?.metadata?.['jira.issue_key']

    if (jiraIssueKey) {
      try {
        await client.deleteIssue(jiraIssueKey)
      } catch (error) {
        return {
          success: false,
          provider: 'jira',
          error: `Failed to delete Jira issue: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
    }

    // Also delete the local PMO mirror
    try {
      await this.storage.deleteTicket(ticketId)
    } catch {
      // Non-fatal if Jira delete succeeded
    }

    return { success: true, provider: 'jira' }
  }

  async listTickets(_projectId?: string, filter?: TicketFilter): Promise<ProviderListResult> {
    let client: JiraClient
    try {
      client = this.getClientOrFail()
    } catch {
      return { success: false, provider: 'jira', tickets: [], error: 'Jira is not configured' }
    }

    const jiraConfig = loadJiraConfig(this.db)
    const projectKey = jiraConfig?.projectKey || process.env.PRLT_JIRA_PROJECT || process.env.JIRA_PROJECT_KEY

    if (!projectKey) {
      return { success: false, provider: 'jira', tickets: [], error: 'Jira project key is required. Set PRLT_JIRA_PROJECT.' }
    }

    try {
      // Build JQL query
      const jqlParts = [`project = "${projectKey}"`]
      if (filter?.column) {
        jqlParts.push(`status = "${filter.column}"`)
      }
      if (filter?.search) {
        jqlParts.push(`(summary ~ "${filter.search}" OR description ~ "${filter.search}")`)
      }
      if (filter?.label) {
        jqlParts.push(`labels = "${filter.label}"`)
      }
      const jql = jqlParts.join(' AND ') + ' ORDER BY updated DESC'

      const result = await client.searchIssues(jql, { maxResults: 50 })

      let tickets: Ticket[] = result.issues.map(issue => jiraIssueToTicket(issue, client))

      // Apply client-side filters that JQL can't handle precisely
      if (filter?.priority) {
        tickets = tickets.filter(t => t.priority === filter.priority)
      }
      if (filter?.category) {
        tickets = tickets.filter(t => t.category === filter.category)
      }

      return { success: true, provider: 'jira', tickets }
    } catch (error) {
      return {
        success: false,
        provider: 'jira',
        tickets: [],
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async createTicket(projectId: string, input: CreateTicketInput): Promise<ProviderCreateResult> {
    let client: JiraClient
    try {
      client = this.getClientOrFail()
    } catch {
      return { success: false, provider: 'jira', error: 'Jira is not configured' }
    }

    const jiraConfig = loadJiraConfig(this.db)
    const projectKey = jiraConfig?.projectKey || process.env.PRLT_JIRA_PROJECT || process.env.JIRA_PROJECT_KEY

    if (!projectKey) {
      return { success: false, provider: 'jira', error: 'Jira project key is required. Set PRLT_JIRA_PROJECT.' }
    }

    try {
      // Map PMO priority to Jira priority name
      const jiraPriority = input.priority ? PMO_PRIORITY_TO_JIRA[input.priority] : undefined

      // Create the issue in Jira
      const issue = await client.createIssue({
        projectKey,
        summary: input.title,
        description: input.description,
        priority: jiraPriority,
        labels: input.labels,
      })

      const browseUrl = client.getBrowseUrl(issue.key)

      // Create local PMO mirror ticket
      const mirrorDescription = [
        input.description || '',
        '',
        '---',
        `_Created in Jira: [${issue.key}](${browseUrl})_`,
      ].join('\n').trim()

      const mirrorPriority = input.priority
        || (issue.fields.priority ? resolveJiraPriority(issue.fields.priority.name) : undefined)

      const pmoTicket = await this.storage.createTicket(projectId, {
        ...input,
        title: issue.fields.summary,
        description: mirrorDescription,
        priority: mirrorPriority,
        metadata: {
          ...input.metadata,
          'external_source': 'jira',
          'external_id': issue.id,
          'external_key': issue.key,
          'external_url': browseUrl,
          'jira.issue_id': issue.id,
          'jira.issue_key': issue.key,
          'jira.project_key': issue.fields.project.key,
          'jira.status': issue.fields.status.name,
        },
      })

      return { success: true, provider: 'jira', ticket: pmoTicket }
    } catch (error) {
      return {
        success: false,
        provider: 'jira',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async getTicket(ticketId: string): Promise<ProviderGetResult> {
    // For getTicket, use local PMO since we maintain mirrors
    try {
      const ticket = await this.storage.getTicket(ticketId)
      return { success: true, provider: 'jira', ticket }
    } catch (error) {
      return {
        success: false,
        provider: 'jira',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async updateTicket(ticketId: string, input: UpdateTicketInput): Promise<ProviderUpdateResult> {
    let client: JiraClient
    try {
      client = this.getClientOrFail()
    } catch {
      return { success: false, provider: 'jira', error: 'Jira is not configured' }
    }

    // Look up Jira issue key from ticket metadata
    const ticket = await this.storage.getTicket(ticketId)
    const jiraIssueKey = ticket?.metadata?.['jira.issue_key']

    if (jiraIssueKey) {
      // Build Jira update payload from input fields
      const jiraInput: { summary?: string; description?: string; priority?: string; labels?: string[] } = {}
      if (input.title !== undefined) jiraInput.summary = input.title
      if (input.description !== undefined) jiraInput.description = input.description ?? undefined
      if (input.priority !== undefined) {
        jiraInput.priority = input.priority ? PMO_PRIORITY_TO_JIRA[input.priority] : undefined
      }

      // Only call Jira API if there are Jira-relevant fields
      if (Object.keys(jiraInput).length > 0) {
        try {
          await client.updateIssue(jiraIssueKey, jiraInput)
        } catch (error) {
          return {
            success: false,
            provider: 'jira',
            error: `Failed to update Jira issue: ${error instanceof Error ? error.message : String(error)}`,
          }
        }
      }
    }

    // Also update local PMO mirror
    try {
      const updated = await this.storage.updateTicket(ticketId, input as Partial<Ticket>)
      return { success: true, provider: 'jira', ticket: updated }
    } catch (error) {
      return {
        success: false,
        provider: 'jira',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async assignTicket(ticketId: string, assignee: string): Promise<ProviderAssignResult> {
    let client: JiraClient
    try {
      client = this.getClientOrFail()
    } catch {
      return { success: false, provider: 'jira', error: 'Jira is not configured' }
    }

    // Look up Jira issue key from ticket metadata
    const ticket = await this.storage.getTicket(ticketId)
    const jiraIssueKey = ticket?.metadata?.['jira.issue_key']

    if (jiraIssueKey) {
      // Try to find the user in Jira and assign
      try {
        const users = await client.findUser(assignee)
        if (users.length > 0 && users[0].accountId) {
          await client.assignIssue(jiraIssueKey, users[0].accountId)
        }
      } catch {
        // Non-fatal: assignee resolution is best-effort
      }
    }

    // Update local PMO mirror
    try {
      await this.storage.updateTicket(ticketId, { assignee } as Partial<Ticket>)
      return { success: true, provider: 'jira' }
    } catch (error) {
      return {
        success: false,
        provider: 'jira',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
}

/**
 * Convert a Jira issue to a normalized PMO Ticket.
 */
function jiraIssueToTicket(issue: JiraIssue, client: JiraClient): Ticket {
  const priorityName = issue.fields.priority?.name
  const priority = priorityName ? resolveJiraPriority(priorityName) : undefined
  const categoryKey = issue.fields.status.statusCategory?.key
  const statusCategory = categoryKey ? JIRA_STATUS_CATEGORY_TO_PMO[categoryKey] : 'started'

  return {
    id: issue.key,
    title: issue.fields.summary,
    description: issue.fields.description || undefined,
    priority,
    projectId: issue.fields.project.key,
    projectName: issue.fields.project.name,
    statusId: issue.fields.status.id,
    statusName: issue.fields.status.name,
    statusCategory: statusCategory as Ticket['statusCategory'],
    owner: issue.fields.reporter?.displayName || undefined,
    assignee: issue.fields.assignee?.displayName || undefined,
    subtasks: [],
    labels: issue.fields.labels || [],
    metadata: {
      external_source: 'jira',
      external_key: issue.key,
      external_id: issue.id,
      external_url: client.getBrowseUrl(issue.key),
      'jira.issue_id': issue.id,
      'jira.issue_key': issue.key,
      'jira.project_key': issue.fields.project.key,
      'jira.status': issue.fields.status.name,
    },
    createdAt: new Date(issue.fields.created),
    updatedAt: new Date(issue.fields.updated),
  }
}

/**
 * Resolve a Jira priority name to PMO priority (P0-P3).
 * Does case-insensitive lookup against JIRA_PRIORITY_TO_PMO.
 */
function resolveJiraPriority(name: string): string | undefined {
  // Try exact match first
  if (JIRA_PRIORITY_TO_PMO[name]) return JIRA_PRIORITY_TO_PMO[name]

  // Case-insensitive fallback
  const lower = name.toLowerCase()
  for (const [key, value] of Object.entries(JIRA_PRIORITY_TO_PMO)) {
    if (key.toLowerCase() === lower) return value
  }

  return undefined
}

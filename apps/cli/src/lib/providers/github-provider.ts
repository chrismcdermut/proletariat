/**
 * GitHub Issues Ticket Provider
 *
 * Writes ticket operations directly to GitHub Issues via REST API,
 * then updates local PMO to keep it in sync.
 *
 * State mapping strategy:
 * - Uses labels to represent workflow states (e.g., "status: In Progress")
 * - Terminal states (completed, dropped) also close/reopen the issue
 * - Auth via GITHUB_TOKEN environment variable or stored credential
 *
 * Follows the same pattern as ClickUpTicketProvider:
 * - Write to GitHub first
 * - Update local PMO as best-effort fallback
 */

import type Database from 'better-sqlite3'
import { GitHubClient } from '../github/client.js'
import { getGitHubToken, loadGitHubConfig } from '../github/config.js'
import type { GitHubIssue } from '../github/types.js'
import { GITHUB_LABEL_TO_PMO_CATEGORY, GITHUB_PRIORITY_LABELS, PMO_PRIORITY_TO_GITHUB_LABEL } from '../github/types.js'
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

export class GitHubIssuesTicketProvider implements TicketProvider {
  readonly name: TicketProviderName = 'github'

  constructor(
    private db: Database.Database,
    private storage: ProviderStorage,
    private projectId: string,
  ) {}

  private getTokenOrFail(): string {
    const token = getGitHubToken(this.db)
    if (!token) throw new Error('GitHub token not configured')
    return token
  }

  private getConfigOrFail(): { token: string; owner: string; repo: string; statusLabelPrefix?: string } {
    const config = loadGitHubConfig(this.db)
    if (!config) throw new Error('GitHub Issues not configured (missing token, owner, or repo)')
    return config
  }

  async moveTicket(ticketId: string, newState: string): Promise<ProviderMoveResult> {
    let config: ReturnType<typeof this.getConfigOrFail>
    try {
      config = this.getConfigOrFail()
    } catch {
      return { success: false, provider: 'github', error: 'GitHub Issues not configured' }
    }

    // Look up GitHub issue number from ticket metadata
    const ticket = await this.storage.getTicket(ticketId)
    if (!ticket) {
      return { success: false, provider: 'github', error: `Ticket ${ticketId} not found` }
    }

    const issueNumber = ticket.metadata?.['github.issue_number']
    if (!issueNumber) {
      return { success: false, provider: 'github', error: `No GitHub issue mapping for ticket ${ticketId}` }
    }

    const client = new GitHubClient(config.token)
    const num = parseInt(issueNumber, 10)

    try {
      // Determine if this state implies open or closed
      const lowerState = newState.toLowerCase()
      const isClosedState = ['done', 'closed', 'complete', 'completed', 'shipped', 'merged',
        'resolved', 'finished', 'canceled', 'cancelled', "won't fix", 'wontfix',
        'dropped', 'archived', 'removed', 'discarded'].includes(lowerState)

      // Get current issue to find existing status labels
      const issue = await client.getIssue(config.owner, config.repo, num)

      // Remove existing status labels
      const prefix = config.statusLabelPrefix ?? 'status:'
      for (const label of issue.labels) {
        if (label.name.toLowerCase().startsWith(prefix.toLowerCase())) {
          try {
            await client.removeLabel(config.owner, config.repo, num, label.name)
          } catch {
            // Non-fatal: label may already be removed
          }
        }
      }

      // Add the new status label
      const statusLabel = `${prefix} ${newState}`
      try {
        await client.addLabels(config.owner, config.repo, num, [statusLabel])
      } catch {
        // If label doesn't exist, create it then add
        try {
          await client.createLabel(config.owner, config.repo, {
            name: statusLabel,
            color: 'ededed',
          })
          await client.addLabels(config.owner, config.repo, num, [statusLabel])
        } catch {
          // Non-fatal: status label is informational
        }
      }

      // Close or reopen the issue based on state
      await client.updateIssue(config.owner, config.repo, num, {
        state: isClosedState ? 'closed' : 'open',
      })
    } catch (error) {
      return {
        success: false,
        provider: 'github',
        error: `Failed to update GitHub issue: ${error instanceof Error ? error.message : String(error)}`,
      }
    }

    // Also update local PMO to keep it in sync
    try {
      await this.storage.moveTicket(this.projectId, ticketId, newState)
    } catch {
      // Non-fatal: GitHub is the source of truth
    }

    return { success: true, provider: 'github' }
  }

  async deleteTicket(ticketId: string): Promise<ProviderDeleteResult> {
    let config: ReturnType<typeof this.getConfigOrFail>
    try {
      config = this.getConfigOrFail()
    } catch {
      return { success: false, provider: 'github', error: 'GitHub Issues not configured' }
    }

    // Look up GitHub issue number from ticket metadata
    const ticket = await this.storage.getTicket(ticketId)
    const issueNumber = ticket?.metadata?.['github.issue_number']

    if (issueNumber) {
      const client = new GitHubClient(config.token)
      const num = parseInt(issueNumber, 10)
      // GitHub issues can't be deleted via API — close them instead
      try {
        await client.updateIssue(config.owner, config.repo, num, { state: 'closed' })
      } catch (error) {
        return {
          success: false,
          provider: 'github',
          error: `Failed to close GitHub issue: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
    }

    // Also delete the local PMO mirror
    try {
      await this.storage.deleteTicket(ticketId)
    } catch {
      // Non-fatal if GitHub close succeeded
    }

    return { success: true, provider: 'github' }
  }

  async listTickets(_projectId?: string, filter?: TicketFilter): Promise<ProviderListResult> {
    let config: ReturnType<typeof this.getConfigOrFail>
    try {
      config = this.getConfigOrFail()
    } catch {
      return { success: false, provider: 'github', tickets: [], error: 'GitHub Issues not configured' }
    }

    try {
      const client = new GitHubClient(config.token)
      const issues = await client.listIssues(config.owner, config.repo, {
        state: 'all',
        labels: filter?.label,
      })

      let tickets: Ticket[] = issues.map(issue => githubIssueToTicket(issue, config.owner, config.repo, config.statusLabelPrefix))

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

      return { success: true, provider: 'github', tickets }
    } catch (error) {
      return {
        success: false,
        provider: 'github',
        tickets: [],
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async createTicket(projectId: string, input: CreateTicketInput): Promise<ProviderCreateResult> {
    let config: ReturnType<typeof this.getConfigOrFail>
    try {
      config = this.getConfigOrFail()
    } catch {
      return { success: false, provider: 'github', error: 'GitHub Issues not configured' }
    }

    try {
      const client = new GitHubClient(config.token)

      // Build labels list
      const labels: string[] = [...(input.labels || [])]

      // Add priority label if set
      if (input.priority && PMO_PRIORITY_TO_GITHUB_LABEL[input.priority]) {
        labels.push(PMO_PRIORITY_TO_GITHUB_LABEL[input.priority])
      }

      // Add status label if set
      if (input.statusName) {
        const prefix = config.statusLabelPrefix ?? 'status:'
        labels.push(`${prefix} ${input.statusName}`)
      }

      // Create the issue on GitHub
      const issue = await client.createIssue(config.owner, config.repo, {
        title: input.title,
        body: input.description,
        labels,
        assignees: input.assignee ? [input.assignee] : undefined,
      })

      // Create local PMO mirror ticket
      const mirrorDescription = [
        input.description || '',
        '',
        '---',
        `_Created in GitHub: [#${issue.number}](${issue.html_url})_`,
      ].join('\n').trim()

      const pmoTicket = await this.storage.createTicket(projectId, {
        ...input,
        title: issue.title,
        description: mirrorDescription,
        metadata: {
          ...input.metadata,
          'external_source': 'github',
          'external_id': String(issue.id),
          'external_key': `${config.owner}/${config.repo}#${issue.number}`,
          'external_url': issue.html_url,
          'github.issue_number': String(issue.number),
          'github.owner': config.owner,
          'github.repo': config.repo,
        },
      })

      return { success: true, provider: 'github', ticket: pmoTicket }
    } catch (error) {
      return {
        success: false,
        provider: 'github',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async getTicket(ticketId: string): Promise<ProviderGetResult> {
    // For getTicket, use local PMO since we maintain mirrors
    try {
      const ticket = await this.storage.getTicket(ticketId)
      return { success: true, provider: 'github', ticket }
    } catch (error) {
      return {
        success: false,
        provider: 'github',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async updateTicket(ticketId: string, input: UpdateTicketInput): Promise<ProviderUpdateResult> {
    let config: ReturnType<typeof this.getConfigOrFail>
    try {
      config = this.getConfigOrFail()
    } catch {
      return { success: false, provider: 'github', error: 'GitHub Issues not configured' }
    }

    // Look up GitHub issue number from ticket metadata
    const ticket = await this.storage.getTicket(ticketId)
    const issueNumber = ticket?.metadata?.['github.issue_number']

    if (issueNumber) {
      const client = new GitHubClient(config.token)
      const num = parseInt(issueNumber, 10)

      // Build GitHub update payload from input fields
      const githubInput: {
        title?: string
        body?: string
        labels?: string[]
      } = {}
      if (input.title !== undefined) githubInput.title = input.title
      if (input.description !== undefined) githubInput.body = input.description ?? undefined

      // Only call GitHub API if there are relevant fields
      if (Object.keys(githubInput).length > 0) {
        try {
          await client.updateIssue(config.owner, config.repo, num, githubInput)
        } catch (error) {
          return {
            success: false,
            provider: 'github',
            error: `Failed to update GitHub issue: ${error instanceof Error ? error.message : String(error)}`,
          }
        }
      }
    }

    // Also update local PMO mirror
    try {
      const updated = await this.storage.updateTicket(ticketId, input as Partial<Ticket>)
      return { success: true, provider: 'github', ticket: updated }
    } catch (error) {
      return {
        success: false,
        provider: 'github',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async assignTicket(ticketId: string, assignee: string): Promise<ProviderAssignResult> {
    let config: ReturnType<typeof this.getConfigOrFail>
    try {
      config = this.getConfigOrFail()
    } catch {
      return { success: false, provider: 'github', error: 'GitHub Issues not configured' }
    }

    // Look up GitHub issue number from ticket metadata
    const ticket = await this.storage.getTicket(ticketId)
    const issueNumber = ticket?.metadata?.['github.issue_number']

    if (issueNumber) {
      const client = new GitHubClient(config.token)
      const num = parseInt(issueNumber, 10)

      // GitHub uses login usernames for assignment
      try {
        await client.updateIssue(config.owner, config.repo, num, {
          assignees: [assignee],
        })
      } catch {
        // Non-fatal: assignee resolution is best-effort
        // The assignee name may not match a GitHub username
      }
    }

    // Update local PMO mirror
    try {
      await this.storage.updateTicket(ticketId, { assignee } as Partial<Ticket>)
      return { success: true, provider: 'github' }
    } catch (error) {
      return {
        success: false,
        provider: 'github',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
}

/**
 * Convert a GitHub issue to a normalized PMO Ticket.
 */
function githubIssueToTicket(
  issue: GitHubIssue,
  owner: string,
  repo: string,
  statusLabelPrefix?: string,
): Ticket {
  const prefix = statusLabelPrefix ?? 'status:'

  // Determine status from labels
  let statusName = issue.state === 'closed' ? 'Closed' : 'Open'
  let statusCategory: Ticket['statusCategory'] = issue.state === 'closed' ? 'completed' : 'unstarted'

  // Check for status label
  for (const label of issue.labels) {
    if (label.name.toLowerCase().startsWith(prefix.toLowerCase())) {
      statusName = label.name.slice(prefix.length).trim()
      // Try to resolve category from label name
      const category = GITHUB_LABEL_TO_PMO_CATEGORY[statusName.toLowerCase()]
      if (category) {
        statusCategory = category as Ticket['statusCategory']
      }
      break
    }
  }

  // Determine priority from labels
  let priority: string | undefined
  for (const label of issue.labels) {
    const mapped = GITHUB_PRIORITY_LABELS[label.name.toLowerCase()]
    if (mapped) {
      priority = mapped
      break
    }
  }

  // Collect non-status, non-priority labels
  const ticketLabels = issue.labels
    .filter(l => {
      const lower = l.name.toLowerCase()
      return !lower.startsWith(prefix.toLowerCase()) && !GITHUB_PRIORITY_LABELS[lower]
    })
    .map(l => l.name)

  return {
    id: `${owner}/${repo}#${issue.number}`,
    title: issue.title,
    description: issue.body || undefined,
    priority,
    projectId: `${owner}/${repo}`,
    projectName: `${owner}/${repo}`,
    statusId: issue.state,
    statusName,
    statusCategory,
    owner: issue.assignee?.login || undefined,
    assignee: issue.assignee?.login || undefined,
    subtasks: [],
    labels: ticketLabels,
    metadata: {
      external_source: 'github',
      external_key: `${owner}/${repo}#${issue.number}`,
      external_id: String(issue.id),
      external_url: issue.html_url,
      'github.issue_number': String(issue.number),
      'github.owner': owner,
      'github.repo': repo,
    },
    createdAt: new Date(issue.created_at),
    updatedAt: new Date(issue.updated_at),
  }
}

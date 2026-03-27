/**
 * ClickUp Ticket Provider
 *
 * Writes ticket operations directly to ClickUp via REST API,
 * then updates local PMO to keep it in sync.
 *
 * Follows the same pattern as LinearTicketProvider:
 * - Write to ClickUp first
 * - Update local PMO as best-effort fallback
 */

import type Database from 'better-sqlite3'
import { ClickUpClient } from '../clickup/client.js'
import { getClickUpApiKey, loadClickUpConfig } from '../clickup/config.js'
import type { ClickUpTask } from '../clickup/types.js'
import { PMO_PRIORITY_TO_CLICKUP, CLICKUP_PRIORITY_TO_PMO, CLICKUP_STATUS_TYPE_TO_PMO_CATEGORY } from '../clickup/types.js'
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
import { ProviderStatusMappingStore } from './status-mapping.js'

export class ClickUpTicketProvider implements TicketProvider {
  readonly name: TicketProviderName = 'clickup'

  constructor(
    private db: Database.Database,
    private storage: ProviderStorage,
    private projectId: string,
  ) {}

  private getApiKeyOrFail(): string {
    const apiKey = getClickUpApiKey(this.db)
    if (!apiKey) throw new Error('ClickUp API key not configured')
    return apiKey
  }

  async moveTicket(ticketId: string, newState: string): Promise<ProviderMoveResult> {
    const apiKey = getClickUpApiKey(this.db)
    if (!apiKey) {
      return { success: false, provider: 'clickup', error: 'ClickUp API key not configured' }
    }

    // Look up ClickUp task ID from ticket metadata
    const ticket = await this.storage.getTicket(ticketId)
    if (!ticket) {
      return { success: false, provider: 'clickup', error: `Ticket ${ticketId} not found` }
    }

    const clickUpTaskId = ticket.metadata?.['clickup.task_id']
    if (!clickUpTaskId) {
      return { success: false, provider: 'clickup', error: `No ClickUp mapping for ticket ${ticketId}` }
    }

    const client = new ClickUpClient(apiKey)

    // Check DB mapping for a configured provider-specific status
    let resolvedState = newState
    try {
      const mappingStore = new ProviderStatusMappingStore(this.db)
      const mapping = mappingStore.getProviderStatus('clickup', newState)
      if (mapping) {
        resolvedState = mapping.providerStatus
      }
    } catch {
      // Non-fatal: fall through to using the original state name
    }

    // Update the task status on ClickUp
    try {
      await client.updateTaskStatus(clickUpTaskId, resolvedState)
    } catch (error) {
      return {
        success: false,
        provider: 'clickup',
        error: `Failed to update ClickUp task: ${error instanceof Error ? error.message : String(error)}`,
      }
    }

    // Also update local PMO to keep it in sync
    try {
      await this.storage.moveTicket(this.projectId, ticketId, newState)
    } catch {
      // Non-fatal: ClickUp is the source of truth
    }

    // Post a comment about the status change
    try {
      await client.addComment(
        clickUpTaskId,
        `Status updated to ${newState} (via prlt)`,
      )
    } catch {
      // Non-fatal: comment is informational
    }

    return { success: true, provider: 'clickup' }
  }

  async deleteTicket(ticketId: string): Promise<ProviderDeleteResult> {
    let apiKey: string
    try {
      apiKey = this.getApiKeyOrFail()
    } catch {
      return { success: false, provider: 'clickup', error: 'ClickUp API key not configured' }
    }

    // Look up ClickUp task ID from ticket metadata
    const ticket = await this.storage.getTicket(ticketId)
    const clickUpTaskId = ticket?.metadata?.['clickup.task_id']

    if (clickUpTaskId) {
      const client = new ClickUpClient(apiKey)
      try {
        await client.deleteTask(clickUpTaskId)
      } catch (error) {
        return {
          success: false,
          provider: 'clickup',
          error: `Failed to delete ClickUp task: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
    }

    // Also delete the local PMO mirror
    try {
      await this.storage.deleteTicket(ticketId)
    } catch {
      // Non-fatal if ClickUp delete succeeded
    }

    return { success: true, provider: 'clickup' }
  }

  async listTickets(_projectId?: string, filter?: TicketFilter): Promise<ProviderListResult> {
    let apiKey: string
    try {
      apiKey = this.getApiKeyOrFail()
    } catch {
      return { success: false, provider: 'clickup', tickets: [], error: 'ClickUp API key not configured' }
    }

    const clickUpConfig = loadClickUpConfig(this.db)
    const listId = clickUpConfig?.defaultListId || process.env.PRLT_CLICKUP_LIST_ID

    if (!listId) {
      return { success: false, provider: 'clickup', tickets: [], error: 'ClickUp list ID is required. Set PRLT_CLICKUP_LIST_ID.' }
    }

    try {
      const client = new ClickUpClient(apiKey)
      const tasks = await client.listTasks(listId)

      let tickets: Ticket[] = tasks.map(task => clickUpTaskToTicket(task))

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

      return { success: true, provider: 'clickup', tickets }
    } catch (error) {
      return {
        success: false,
        provider: 'clickup',
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
      return { success: false, provider: 'clickup', error: 'ClickUp API key not configured' }
    }

    const client = new ClickUpClient(apiKey)
    const clickUpConfig = loadClickUpConfig(this.db)
    const listId = clickUpConfig?.defaultListId || process.env.PRLT_CLICKUP_LIST_ID

    if (!listId) {
      return { success: false, provider: 'clickup', error: 'ClickUp list ID is required. Set PRLT_CLICKUP_LIST_ID.' }
    }

    try {
      // Map PMO priority to ClickUp priority number
      const clickUpPriority = input.priority ? PMO_PRIORITY_TO_CLICKUP[input.priority] : undefined

      // Create the task in ClickUp
      const task = await client.createTask(listId, {
        name: input.title,
        description: input.description,
        priority: clickUpPriority ?? null,
        tags: input.labels,
      })

      // Create local PMO mirror ticket
      const mirrorDescription = [
        input.description || '',
        '',
        '---',
        `_Created in ClickUp: [${task.id}](${task.url})_`,
      ].join('\n').trim()

      const mirrorPriority = input.priority || (task.priority ? CLICKUP_PRIORITY_TO_PMO[task.priority.id] : undefined)

      const pmoTicket = await this.storage.createTicket(projectId, {
        ...input,
        title: task.name,
        description: mirrorDescription,
        priority: mirrorPriority,
        metadata: {
          ...input.metadata,
          'external_source': 'clickup',
          'external_id': task.id,
          'external_key': task.custom_id || task.id,
          'external_url': task.url,
          'clickup.task_id': task.id,
          'clickup.list_id': listId,
          'clickup.status': task.status.status,
        },
      })

      return { success: true, provider: 'clickup', ticket: pmoTicket }
    } catch (error) {
      return {
        success: false,
        provider: 'clickup',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async getTicket(ticketId: string): Promise<ProviderGetResult> {
    // For getTicket, use local PMO since we maintain mirrors
    try {
      const ticket = await this.storage.getTicket(ticketId)
      return { success: true, provider: 'clickup', ticket }
    } catch (error) {
      return {
        success: false,
        provider: 'clickup',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async updateTicket(ticketId: string, input: UpdateTicketInput): Promise<ProviderUpdateResult> {
    let apiKey: string
    try {
      apiKey = this.getApiKeyOrFail()
    } catch {
      return { success: false, provider: 'clickup', error: 'ClickUp API key not configured' }
    }

    // Look up ClickUp task ID from ticket metadata
    const ticket = await this.storage.getTicket(ticketId)
    const clickUpTaskId = ticket?.metadata?.['clickup.task_id']

    if (clickUpTaskId) {
      // Build ClickUp update payload from input fields
      const clickUpInput: { name?: string; description?: string; priority?: number | null } = {}
      if (input.title !== undefined) clickUpInput.name = input.title
      if (input.description !== undefined) clickUpInput.description = input.description ?? undefined
      if (input.priority !== undefined) {
        clickUpInput.priority = input.priority ? PMO_PRIORITY_TO_CLICKUP[input.priority] : null
      }

      // Only call ClickUp API if there are relevant fields
      if (Object.keys(clickUpInput).length > 0) {
        const client = new ClickUpClient(apiKey)
        try {
          await client.updateTask(clickUpTaskId, clickUpInput)
        } catch (error) {
          return {
            success: false,
            provider: 'clickup',
            error: `Failed to update ClickUp task: ${error instanceof Error ? error.message : String(error)}`,
          }
        }
      }
    }

    // Also update local PMO mirror
    try {
      const updated = await this.storage.updateTicket(ticketId, input as Partial<Ticket>)
      return { success: true, provider: 'clickup', ticket: updated }
    } catch (error) {
      return {
        success: false,
        provider: 'clickup',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async assignTicket(ticketId: string, assignee: string): Promise<ProviderAssignResult> {
    let apiKey: string
    try {
      apiKey = this.getApiKeyOrFail()
    } catch {
      return { success: false, provider: 'clickup', error: 'ClickUp API key not configured' }
    }

    // Look up ClickUp task ID from ticket metadata
    const ticket = await this.storage.getTicket(ticketId)
    const clickUpTaskId = ticket?.metadata?.['clickup.task_id']

    if (clickUpTaskId) {
      const client = new ClickUpClient(apiKey)
      // ClickUp requires numeric user IDs for assignment.
      // If the assignee looks like an email, try to resolve it.
      // Otherwise, skip the ClickUp-side assignment (best-effort).
      if (assignee.includes('@')) {
        try {
          const teams = await client.listTeams()
          const teamId = teams[0]?.id
          if (teamId) {
            const member = await client.findMemberByEmail(teamId, assignee)
            if (member) {
              await client.addAssignee(clickUpTaskId, member.id)
            }
          }
        } catch {
          // Non-fatal: assignee resolution is best-effort
        }
      }
    }

    // Update local PMO mirror
    try {
      await this.storage.updateTicket(ticketId, { assignee } as Partial<Ticket>)
      return { success: true, provider: 'clickup' }
    } catch (error) {
      return {
        success: false,
        provider: 'clickup',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
}

/**
 * Convert a ClickUp task to a normalized PMO Ticket.
 */
function clickUpTaskToTicket(task: ClickUpTask): Ticket {
  const priorityId = task.priority?.id
  const priority = priorityId ? CLICKUP_PRIORITY_TO_PMO[priorityId] : undefined
  const statusCategory = CLICKUP_STATUS_TYPE_TO_PMO_CATEGORY[task.status.type] || 'started'

  return {
    id: task.custom_id || task.id,
    title: task.name,
    description: task.description || undefined,
    priority,
    projectId: task.list.id,
    projectName: task.list.name,
    statusId: task.status.id,
    statusName: task.status.status,
    statusCategory: statusCategory as Ticket['statusCategory'],
    owner: task.assignees[0]?.username || undefined,
    assignee: task.assignees[0]?.username || undefined,
    subtasks: [],
    labels: task.tags.map(t => t.name),
    metadata: {
      external_source: 'clickup',
      external_key: task.custom_id || task.id,
      external_id: task.id,
      external_url: task.url,
      'clickup.task_id': task.id,
      'clickup.list_id': task.list.id,
      'clickup.status': task.status.status,
    },
    createdAt: new Date(parseInt(task.date_created, 10)),
    updatedAt: new Date(parseInt(task.date_updated, 10)),
  }
}

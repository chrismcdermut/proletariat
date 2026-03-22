/**
 * ClickUp Ticket Provider
 *
 * Writes ticket operations directly to ClickUp via API,
 * then updates local PMO to keep it in sync.
 */

import type Database from 'better-sqlite3'
import { ClickUpClient } from '../clickup/client.js'
import { ClickUpMapper } from '../clickup/mapper.js'
import { getClickUpApiKey, loadClickUpConfig } from '../clickup/config.js'
import { PMO_PRIORITY_TO_CLICKUP, CLICKUP_PRIORITY_TO_PMO } from '../clickup/types.js'
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

export class ClickUpTicketProvider implements TicketProvider {
  readonly name = 'clickup' as const

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

    // Look up ClickUp mapping for this PMO ticket
    const mapper = new ClickUpMapper(this.db)
    const mapping = mapper.getByTicketId(ticketId)
    if (!mapping) {
      return { success: false, provider: 'clickup', error: `No ClickUp mapping for ticket ${ticketId}` }
    }

    // Update the task status on ClickUp
    const client = new ClickUpClient(apiKey)
    try {
      await client.updateTask(mapping.clickupTaskId, { status: newState })
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
        mapping.clickupTaskId,
        `Status updated to **${newState}** (via prlt)`,
      )
    } catch {
      // Non-fatal: comment is informational
    }

    // Update sync timestamp
    try {
      mapper.updateSyncTimestamp(ticketId)
    } catch {
      // Non-fatal
    }

    return { success: true, provider: 'clickup' }
  }

  async deleteTicket(ticketId: string): Promise<ProviderDeleteResult> {
    // ClickUp API doesn't have a simple archive endpoint like Linear.
    // We'll just delete the local mapping and PMO ticket.
    const mapper = new ClickUpMapper(this.db)

    try {
      mapper.deleteMapping(ticketId)
    } catch {
      // Non-fatal
    }

    try {
      await this.storage.deleteTicket(ticketId)
    } catch {
      // Non-fatal
    }

    return { success: true, provider: 'clickup' }
  }

  async listTickets(projectId?: string, filter?: TicketFilter): Promise<ProviderListResult> {
    let apiKey: string
    try {
      apiKey = this.getApiKeyOrFail()
    } catch {
      return { success: false, provider: 'clickup', tickets: [], error: 'ClickUp API key not configured' }
    }

    const config = loadClickUpConfig(this.db)
    const spaceId = config?.spaceId

    if (!spaceId) {
      return { success: false, provider: 'clickup', tickets: [], error: 'ClickUp space not configured' }
    }

    try {
      const client = new ClickUpClient(apiKey)

      // Get all lists in the space
      const lists = await client.listFolderlessLists(spaceId)

      // Also get lists from folders
      const folders = await client.listFolders(spaceId)
      for (const folder of folders) {
        lists.push(...folder.lists)
      }

      // Fetch tasks from all lists
      const allTasks: Ticket[] = []
      for (const list of lists) {
        // eslint-disable-next-line no-await-in-loop
        const tasks = await client.listTasks(list.id)

        for (const task of tasks) {
          allTasks.push({
            id: task.id,
            title: task.name,
            description: task.description || undefined,
            priority: task.priority ? (CLICKUP_PRIORITY_TO_PMO[task.priority.id] ?? undefined) : undefined,
            projectId: list.id,
            projectName: list.name,
            statusId: task.status.status,
            statusName: task.status.status,
            owner: task.assignees[0]?.username,
            assignee: task.assignees[0]?.username,
            subtasks: [],
            labels: task.tags.map(t => t.name),
            metadata: {
              external_source: 'clickup',
              external_key: task.id,
              external_id: task.id,
              external_url: task.url,
            },
            createdAt: new Date(parseInt(task.date_created, 10)),
            updatedAt: new Date(parseInt(task.date_updated, 10)),
          })
        }
      }

      // Apply client-side filters
      let tickets = allTasks
      if (filter?.priority) {
        tickets = tickets.filter(t => t.priority === filter.priority)
      }
      if (filter?.column) {
        tickets = tickets.filter(t => t.statusName === filter.column)
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

    const config = loadClickUpConfig(this.db)
    const spaceId = config?.spaceId

    if (!spaceId) {
      return { success: false, provider: 'clickup', error: 'ClickUp space not configured. Run "prlt clickup connect".' }
    }

    const client = new ClickUpClient(apiKey)

    try {
      // Get the first list in the space to create the task in
      const lists = await client.listFolderlessLists(spaceId)
      if (lists.length === 0) {
        return { success: false, provider: 'clickup', error: 'No lists found in the configured ClickUp space.' }
      }

      const targetListId = lists[0].id

      // Map PMO priority to ClickUp priority number
      const clickupPriority = input.priority ? PMO_PRIORITY_TO_CLICKUP[input.priority] : undefined

      // Create the task in ClickUp
      const task = await client.createTask(targetListId, {
        name: input.title,
        description: input.description,
        priority: clickupPriority,
        tags: input.labels,
      })

      // Create local PMO mirror ticket
      const mirrorDescription = [
        input.description || '',
        '',
        '---',
        `_Created in ClickUp: [${task.name}](${task.url})_`,
      ].join('\n').trim()

      const pmoTicket = await this.storage.createTicket(projectId, {
        ...input,
        title: task.name,
        description: mirrorDescription,
        metadata: {
          ...input.metadata,
          'external_source': 'clickup',
          'external_id': task.id,
          'external_key': task.id,
          'external_url': task.url,
          'clickup.task_id': task.id,
          'clickup.url': task.url,
          'clickup.list_id': task.list.id,
          'clickup.status': task.status.status,
        },
      })

      // Create mapping record
      const mapper = new ClickUpMapper(this.db)
      mapper.createMapping({
        pmoTicketId: pmoTicket.id,
        clickupTaskId: task.id,
        clickupListId: task.list.id,
        clickupSpaceId: task.space.id,
        syncDirection: 'outbound',
        createdAt: new Date(),
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
    // Use local PMO mirror for reads to avoid unnecessary API calls
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

  async updateTicket(ticketId: string, changes: Record<string, unknown>): Promise<ProviderUpdateResult> {
    const apiKey = getClickUpApiKey(this.db)
    if (!apiKey) {
      return { success: false, provider: 'clickup', error: 'ClickUp API key not configured' }
    }

    const mapper = new ClickUpMapper(this.db)
    const mapping = mapper.getByTicketId(ticketId)

    // Propagate changes to ClickUp API if we have a mapping
    if (mapping) {
      const client = new ClickUpClient(apiKey)
      const updatePayload: {
        name?: string
        description?: string
        priority?: number
        assignees?: { add?: number[]; rem?: number[] }
      } = {}

      if (typeof changes.title === 'string') {
        updatePayload.name = changes.title
      }
      if (typeof changes.description === 'string') {
        updatePayload.description = changes.description
      }
      if (typeof changes.priority === 'string') {
        updatePayload.priority = PMO_PRIORITY_TO_CLICKUP[changes.priority]
      }

      if (Object.keys(updatePayload).length > 0) {
        try {
          await client.updateTask(mapping.clickupTaskId, updatePayload)
        } catch (error) {
          return {
            success: false,
            provider: 'clickup',
            error: `Failed to update ClickUp task: ${error instanceof Error ? error.message : String(error)}`,
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
      const ticket = await this.storage.updateTicket(ticketId, changes)
      return { success: true, provider: 'clickup', ticket }
    } catch (error) {
      return {
        success: false,
        provider: 'clickup',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async addComment(ticketId: string, body: string): Promise<ProviderCommentResult> {
    const apiKey = getClickUpApiKey(this.db)
    if (!apiKey) {
      return { success: false, provider: 'clickup', error: 'ClickUp API key not configured' }
    }

    const mapper = new ClickUpMapper(this.db)
    const mapping = mapper.getByTicketId(ticketId)
    if (!mapping) {
      return { success: false, provider: 'clickup', error: `No ClickUp mapping for ticket ${ticketId}` }
    }

    try {
      const client = new ClickUpClient(apiKey)
      await client.addComment(mapping.clickupTaskId, body)
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

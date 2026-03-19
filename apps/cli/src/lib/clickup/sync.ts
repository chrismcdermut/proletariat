import type { Ticket } from '../pmo/types.js'
import { ClickUpClient } from './client.js'
import { ClickUpMapper } from './mapper.js'
import { PMO_PRIORITY_TO_CLICKUP } from './types.js'

export class ClickUpSync {
  constructor(
    private client: ClickUpClient,
    private mapper: ClickUpMapper,
  ) {}

  private buildTaskName(ticket: Ticket): string {
    return `${ticket.id}: ${ticket.title}`
  }

  private buildTaskDescription(ticket: Ticket): string {
    const parts = [ticket.description?.trim() || '', '', '---', `Synced from PMO ticket ${ticket.id}`]
    return parts.join('\n').trim()
  }

  private deriveClickUpStatus(ticket: Ticket): string | undefined {
    const category = ticket.statusCategory
    if (!category) return undefined

    switch (category) {
      case 'completed':
        return 'complete'
      case 'canceled':
        return 'Closed'
      case 'started':
        return 'in progress'
      default:
        return undefined
    }
  }

  async createTaskForTicket(ticket: Ticket, listId: string): Promise<string> {
    const priority = ticket.priority ? PMO_PRIORITY_TO_CLICKUP[ticket.priority] : undefined

    const task = await this.client.createTask(listId, {
      name: this.buildTaskName(ticket),
      description: this.buildTaskDescription(ticket),
      priority: priority ?? null,
      status: this.deriveClickUpStatus(ticket),
    })

    this.mapper.createOrUpdateMapping(ticket.id, task.id, listId)
    return task.id
  }

  async syncTicket(ticket: Ticket, taskId: string): Promise<void> {
    const priority = ticket.priority ? PMO_PRIORITY_TO_CLICKUP[ticket.priority] : undefined

    await this.client.updateTask(taskId, {
      name: this.buildTaskName(ticket),
      description: this.buildTaskDescription(ticket),
      priority: priority ?? null,
      status: this.deriveClickUpStatus(ticket),
    })
    this.mapper.updateSyncTimestamp(ticket.id)
  }
}

import type { Ticket } from '../pmo/types.js'
import { AsanaClient } from './client.js'
import { AsanaMapper } from './mapper.js'

export class AsanaSync {
  constructor(
    private client: AsanaClient,
    private mapper: AsanaMapper,
  ) {}

  private buildTaskName(ticket: Ticket): string {
    return `${ticket.id}: ${ticket.title}`
  }

  private buildTaskNotes(ticket: Ticket): string {
    const parts = [ticket.description?.trim() || '', '', '---', `Synced from PMO ticket ${ticket.id}`]
    return parts.join('\n').trim()
  }

  private isCompletedStatus(ticket: Ticket): boolean {
    return ticket.statusCategory === 'completed' || ticket.statusCategory === 'canceled'
  }

  async createTaskForTicket(ticket: Ticket, projectGid: string): Promise<string> {
    const task = await this.client.createTask({
      name: this.buildTaskName(ticket),
      notes: this.buildTaskNotes(ticket),
      completed: this.isCompletedStatus(ticket),
      projects: [projectGid],
    })

    this.mapper.createOrUpdateMapping(ticket.id, task.gid, projectGid)
    return task.gid
  }

  async syncTicket(ticket: Ticket, taskGid: string): Promise<void> {
    await this.client.updateTask(taskGid, {
      name: this.buildTaskName(ticket),
      notes: this.buildTaskNotes(ticket),
      completed: this.isCompletedStatus(ticket),
    })
    this.mapper.updateSyncTimestamp(ticket.id)
  }
}

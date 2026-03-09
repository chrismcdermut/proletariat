import type { Ticket } from '../pmo/types.js'
import { ShortcutClient } from './client.js'
import { ShortcutMapper } from './mapper.js'

export class ShortcutSync {
  constructor(
    private client: ShortcutClient,
    private mapper: ShortcutMapper,
  ) {}

  private buildStoryName(ticket: Ticket): string {
    return `${ticket.id}: ${ticket.title}`
  }

  private buildStoryDescription(ticket: Ticket): string {
    const parts = [ticket.description?.trim() || '', '', '---', `Synced from PMO ticket ${ticket.id}`]
    return parts.join('\n').trim()
  }

  private isCompletedStatus(ticket: Ticket): boolean {
    return ticket.statusCategory === 'completed' || ticket.statusCategory === 'canceled'
  }

  async syncTicket(ticket: Ticket, storyId: string, workflowStates?: Map<number, { id: number; name: string; type: string }>): Promise<void> {
    const updateInput: Record<string, unknown> = {
      name: this.buildStoryName(ticket),
      description: this.buildStoryDescription(ticket),
    }

    // If we have workflow states, try to map PMO status category to a Shortcut state
    if (workflowStates) {
      const targetState = this.findMatchingState(ticket, workflowStates)
      if (targetState) {
        updateInput.workflow_state_id = targetState
      }
    }

    // Mark archived if completed/canceled
    if (this.isCompletedStatus(ticket)) {
      updateInput.archived = false // Don't auto-archive, let workflow state handle it
    }

    await this.client.updateStory(Number(storyId), updateInput)
    this.mapper.updateSyncTimestamp(ticket.id)
  }

  private findMatchingState(
    ticket: Ticket,
    workflowStates: Map<number, { id: number; name: string; type: string }>,
  ): number | null {
    const categoryMapping: Record<string, string> = {
      pending: 'unstarted',
      started: 'started',
      completed: 'done',
      canceled: 'done',
    }

    const targetType = categoryMapping[ticket.statusCategory ?? '']
    if (!targetType) return null

    for (const [id, state] of workflowStates) {
      if (state.type === targetType) {
        return id
      }
    }

    return null
  }

  async createStoryForTicket(ticket: Ticket, workflowStates?: Map<number, { id: number; name: string; type: string }>): Promise<string> {
    // Find a "backlog" or "unstarted" state as default
    let workflowStateId: number | undefined
    if (workflowStates) {
      for (const [id, state] of workflowStates) {
        if (state.type === 'unstarted') {
          workflowStateId = id
          break
        }
      }
    }

    // Shortcut requires creating stories via POST /stories
    // We'll use the client's request method via updateStory pattern
    // Actually, we need to use the search/create endpoint
    // For now, we'll throw - the sync command should map existing stories
    throw new Error(
      `Cannot create Shortcut stories from PMO yet. Use "prlt shortcut sync --ticket ${ticket.id} --story <story-id>" to map an existing story.`
    )
  }
}

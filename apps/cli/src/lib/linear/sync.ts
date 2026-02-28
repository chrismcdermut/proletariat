/**
 * Linear Outbound Sync
 *
 * Handles syncing PMO ticket status changes back to Linear,
 * attaching PR links, and posting status comments.
 */

import type { PMOStorage, Ticket, WorkflowStatus } from '../pmo/types.js'
import { LinearClient } from './client.js'
import { LinearMapper } from './mapper.js'
import {
  PMO_PRIORITY_TO_LINEAR,
} from './types.js'
import type { LinearWorkflowState } from './types.js'

export class LinearSync {
  constructor(
    private client: LinearClient,
    private mapper: LinearMapper,
  ) {}

  /**
   * Sync a PMO ticket's status back to Linear.
   * Finds the best matching Linear state based on category.
   */
  async syncTicketStatus(
    ticket: Ticket,
    linearStates: LinearWorkflowState[],
  ): Promise<boolean> {
    const mapping = this.mapper.getByTicketId(ticket.id)
    if (!mapping) return false

    const pmoCategory = ticket.statusCategory
    if (!pmoCategory) return false

    // Find the best matching Linear state
    const matchingState = linearStates.find((s) => s.type === pmoCategory)
    if (!matchingState) return false

    await this.client.updateIssueState(mapping.linearIssueId, matchingState.id)
    this.mapper.updateSyncTimestamp(ticket.id)

    return true
  }

  /**
   * Attach a PR link to the corresponding Linear issue.
   */
  async syncPRLink(
    ticketId: string,
    prUrl: string,
    prTitle: string,
  ): Promise<boolean> {
    const mapping = this.mapper.getByTicketId(ticketId)
    if (!mapping) return false

    await this.client.attachUrl(
      mapping.linearIssueId,
      prUrl,
      `PR: ${prTitle}`,
    )

    // Also add a comment for visibility
    await this.client.addComment(
      mapping.linearIssueId,
      `Pull request created: [${prTitle}](${prUrl})`,
    )

    this.mapper.updateSyncTimestamp(ticketId)
    return true
  }

  /**
   * Post a status update comment to the Linear issue.
   */
  async syncStatusComment(
    ticketId: string,
    statusName: string,
    message?: string,
  ): Promise<boolean> {
    const mapping = this.mapper.getByTicketId(ticketId)
    if (!mapping) return false

    const body = message
      ? `Status updated to **${statusName}**: ${message}`
      : `Status updated to **${statusName}**`

    await this.client.addComment(mapping.linearIssueId, body)
    this.mapper.updateSyncTimestamp(ticketId)
    return true
  }

  /**
   * Batch sync all mapped tickets that have changed since last sync.
   * Returns counts of synced/skipped/errored items.
   */
  async syncAllStatuses(
    storage: PMOStorage,
    mappings: ReturnType<LinearMapper['listMappings']>,
    linearStates: LinearWorkflowState[],
  ): Promise<{ synced: number; skipped: number; errors: number }> {
    const result = { synced: 0, skipped: 0, errors: 0 }

    for (const mapping of mappings) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const ticket = await storage.getTicket(mapping.pmoTicketId)
        if (!ticket) {
          result.skipped++
          continue
        }

        // eslint-disable-next-line no-await-in-loop
        const synced = await this.syncTicketStatus(ticket, linearStates)
        if (synced) {
          result.synced++
        } else {
          result.skipped++
        }
      } catch {
        result.errors++
      }
    }

    return result
  }
}

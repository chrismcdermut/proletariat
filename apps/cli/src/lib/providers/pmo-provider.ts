/**
 * PMO Ticket Provider
 *
 * Default provider for users without external integrations.
 * Wraps the existing PMO storage.moveTicket() call.
 * Emits ticket:status_changed events via the storage layer.
 */

import type { PostExecutionStorage } from '../work-lifecycle/post-execution.js'
import type { TicketProvider, ProviderMoveResult } from './types.js'

export class PMOTicketProvider implements TicketProvider {
  readonly name = 'pmo' as const

  constructor(
    private storage: PostExecutionStorage,
    private projectId: string,
  ) {}

  async moveTicket(ticketId: string, newState: string): Promise<ProviderMoveResult> {
    try {
      await this.storage.moveTicket(this.projectId, ticketId, newState)
      return { success: true, provider: 'pmo' }
    } catch (error) {
      return {
        success: false,
        provider: 'pmo',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
}

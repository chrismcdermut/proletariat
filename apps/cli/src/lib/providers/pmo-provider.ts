/**
 * PMO Ticket Provider
 *
 * Default provider for users without external integrations.
 * Wraps the existing PMO storage calls.
 * Emits ticket:status_changed events via the storage layer.
 */

import type { TicketFilter, CreateTicketInput } from '../pmo/types.js'
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

export class PMOTicketProvider implements TicketProvider {
  readonly name = 'pmo' as const

  constructor(
    private storage: ProviderStorage,
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

  async deleteTicket(ticketId: string): Promise<ProviderDeleteResult> {
    try {
      await this.storage.deleteTicket(ticketId)
      return { success: true, provider: 'pmo' }
    } catch (error) {
      return {
        success: false,
        provider: 'pmo',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async listTickets(projectId?: string, filter?: TicketFilter): Promise<ProviderListResult> {
    try {
      const tickets = await this.storage.listTickets(projectId, filter)
      return { success: true, provider: 'pmo', tickets }
    } catch (error) {
      return {
        success: false,
        provider: 'pmo',
        tickets: [],
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async createTicket(projectId: string, input: CreateTicketInput): Promise<ProviderCreateResult> {
    try {
      const ticket = await this.storage.createTicket(projectId, input)
      return { success: true, provider: 'pmo', ticket }
    } catch (error) {
      return {
        success: false,
        provider: 'pmo',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async getTicket(ticketId: string): Promise<ProviderGetResult> {
    try {
      const ticket = await this.storage.getTicket(ticketId)
      return { success: true, provider: 'pmo', ticket }
    } catch (error) {
      return {
        success: false,
        provider: 'pmo',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async updateTicket(ticketId: string, changes: Record<string, unknown>): Promise<ProviderUpdateResult> {
    try {
      const ticket = await this.storage.updateTicket(ticketId, changes)
      return { success: true, provider: 'pmo', ticket }
    } catch (error) {
      return {
        success: false,
        provider: 'pmo',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async addComment(_ticketId: string, _body: string): Promise<ProviderCommentResult> {
    // Local PMO doesn't support comments — no-op success
    return { success: true, provider: 'pmo' }
  }
}

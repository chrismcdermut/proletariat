/**
 * PMO Ticket Provider
 *
 * Default provider for users without external integrations.
 * Wraps the existing PMO storage calls.
 * Emits ticket:status_changed events via the storage layer.
 */

import type { Ticket, TicketFilter, CreateTicketInput, UpdateTicketInput } from '../pmo/types.js'
import type {
  TicketProvider,
  ProviderMoveResult,
  ProviderDeleteResult,
  ProviderListResult,
  ProviderCreateResult,
  ProviderGetResult,
  ProviderUpdateResult,
  ProviderAssignResult,
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

  async updateTicket(ticketId: string, input: UpdateTicketInput): Promise<ProviderUpdateResult> {
    try {
      const ticket = await this.storage.updateTicket(ticketId, input as Partial<Ticket>)
      return { success: true, provider: 'pmo', ticket }
    } catch (error) {
      return {
        success: false,
        provider: 'pmo',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async assignTicket(ticketId: string, assignee: string): Promise<ProviderAssignResult> {
    try {
      await this.storage.updateTicket(ticketId, { assignee } as Partial<Ticket>)
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

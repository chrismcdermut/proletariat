/**
 * TicketService
 *
 * Service for ticket operations: list, get, create, move, update.
 * Routes through the TicketProvider interface so the same service
 * works regardless of backend (PMO, Linear, Jira, etc.).
 *
 * No oclif, no inquirer, no CLI formatting.
 */

import type Database from 'better-sqlite3'
import type { Ticket, TicketFilter, CreateTicketInput, UpdateTicketInput } from '../lib/pmo/types.js'
import type { ProviderStorage, ProviderListResult } from '../lib/providers/types.js'
import { resolveProjectProvider } from '../lib/providers/resolver.js'
import { ServiceError } from './types.js'
import type { ListTicketsOptions, ListTicketsResult, GetTicketResult } from './types.js'

/**
 * Storage interface needed by TicketService.
 * SQLiteStorage satisfies this.
 */
export interface TicketServiceStorage extends ProviderStorage {
  getProject(id: string): Promise<{ id: string; name: string } | null>
  listProjectSummaries(): Promise<Array<{ id: string; name: string }>>
}

export class TicketService {
  constructor(
    private readonly db: Database.Database,
    private readonly storage: TicketServiceStorage,
  ) {}

  /**
   * List tickets with filtering, validation, and pagination.
   *
   * Resolves the correct provider (PMO or Linear) based on project config,
   * validates project/column existence, fetches tickets, and paginates.
   */
  async listTickets(options: ListTicketsOptions = {}): Promise<ListTicketsResult> {
    const { projectId, filter = {}, limit, offset, source } = options

    // Build the effective filter
    const effectiveFilter: TicketFilter = { ...filter }
    if (!projectId) {
      effectiveFilter.allProjects = true
    }

    // Validate project exists if specified
    if (projectId) {
      const project = await this.storage.getProject(projectId)
      if (!project) {
        const allProjects = await this.storage.listProjectSummaries()
        const validIds = allProjects.map(p => p.id)
        throw new ServiceError(
          'NOT_FOUND',
          `Project "${projectId}" not found. Valid projects: ${validIds.join(', ')}`,
          { validProjects: validIds },
        )
      }
    }

    // Column validation against the local PMO board was removed with the dead
    // PMO ticket tables (PRLT-1299). The provider (Linear, Jira, etc.) will
    // validate the column name itself when the list is performed, and local
    // PMO no longer carries columns, so no pre-flight check is possible here.

    // Resolve provider and fetch
    const provider = resolveProjectProvider(
      this.db,
      this.storage,
      projectId || '',
      source,
    )

    let listResult: ProviderListResult
    try {
      listResult = await provider.listTickets(projectId, effectiveFilter)
    } catch (error) {
      throw new ServiceError(
        'EXTERNAL_FAILURE',
        `Failed to list tickets: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      )
    }

    if (!listResult.success) {
      throw new ServiceError(
        'EXTERNAL_FAILURE',
        listResult.error || 'Failed to list tickets',
      )
    }

    let tickets = listResult.tickets
    const totalCount = tickets.length

    // Apply pagination
    if (offset) tickets = tickets.slice(offset)
    if (limit) tickets = tickets.slice(0, limit)

    // Board info on local PMO was removed with the dead PMO ticket tables
    // (PRLT-1299). Consumers of this service use tickets[*].statusName instead
    // of the now-absent board structure.
    return {
      success: true,
      tickets,
      provider: listResult.provider,
      totalCount,
    }
  }

  /**
   * Get a single ticket by ID.
   */
  async getTicket(ticketId: string, projectId?: string): Promise<GetTicketResult> {
    const provider = resolveProjectProvider(
      this.db,
      this.storage,
      projectId || '',
    )

    const result = await provider.getTicket(ticketId)
    if (!result.success) {
      throw new ServiceError(
        'EXTERNAL_FAILURE',
        result.error || `Failed to get ticket ${ticketId}`,
      )
    }

    return {
      success: true,
      ticket: result.ticket ?? null,
      provider: result.provider,
    }
  }

  /**
   * Create a ticket.
   */
  async createTicket(projectId: string, input: CreateTicketInput): Promise<Ticket> {
    const provider = resolveProjectProvider(
      this.db,
      this.storage,
      projectId,
    )

    const result = await provider.createTicket(projectId, input)
    if (!result.success || !result.ticket) {
      throw new ServiceError(
        'EXTERNAL_FAILURE',
        result.error || 'Failed to create ticket',
      )
    }

    return result.ticket
  }

  /**
   * Move a ticket to a new state/column.
   */
  async moveTicket(ticketId: string, newState: string): Promise<void> {
    const provider = resolveProjectProvider(
      this.db,
      this.storage,
      '',
    )

    const result = await provider.moveTicket(ticketId, newState)
    if (!result.success) {
      throw new ServiceError(
        'EXTERNAL_FAILURE',
        result.error || `Failed to move ticket ${ticketId} to ${newState}`,
      )
    }
  }

  /**
   * Update ticket fields.
   */
  async updateTicket(ticketId: string, input: UpdateTicketInput): Promise<Ticket> {
    const provider = resolveProjectProvider(
      this.db,
      this.storage,
      '',
    )

    const result = await provider.updateTicket(ticketId, input)
    if (!result.success || !result.ticket) {
      throw new ServiceError(
        'EXTERNAL_FAILURE',
        result.error || `Failed to update ticket ${ticketId}`,
      )
    }

    return result.ticket
  }

  /**
   * Assign a ticket to a user or agent.
   */
  async assignTicket(ticketId: string, assignee: string): Promise<void> {
    const provider = resolveProjectProvider(
      this.db,
      this.storage,
      '',
    )

    const result = await provider.assignTicket(ticketId, assignee)
    if (!result.success) {
      throw new ServiceError(
        'EXTERNAL_FAILURE',
        result.error || `Failed to assign ticket ${ticketId} to ${assignee}`,
      )
    }
  }
}

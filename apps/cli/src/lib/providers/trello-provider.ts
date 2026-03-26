/**
 * Trello Ticket Provider
 *
 * Writes ticket operations directly to Trello via API,
 * then updates local PMO to keep it in sync.
 *
 * Follows the same pattern as LinearTicketProvider:
 * Trello is the source of truth, PMO is best-effort mirror.
 */

import type Database from 'better-sqlite3'
import { TrelloClient } from '../trello/client.js'
import { TrelloMapper } from '../trello/mapper.js'
import { getTrelloApiKey, getTrelloApiToken, loadTrelloConfig } from '../trello/config.js'
import { listTrelloCards } from '../external-issues/trello.js'
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

export class TrelloTicketProvider implements TicketProvider {
  readonly name = 'trello' as const

  constructor(
    private db: Database.Database,
    private storage: ProviderStorage,
    private projectId: string,
    private ticketStatusCategory: string | null,
  ) {}

  private getCredentialsOrFail(): { apiKey: string; apiToken: string } {
    const apiKey = getTrelloApiKey(this.db)
    if (!apiKey) throw new Error('Trello API key not configured')
    const apiToken = getTrelloApiToken(this.db)
    if (!apiToken) throw new Error('Trello API token not configured')
    return { apiKey, apiToken }
  }

  async moveTicket(ticketId: string, newState: string): Promise<ProviderMoveResult> {
    // 1. Get Trello credentials
    let creds: { apiKey: string; apiToken: string }
    try {
      creds = this.getCredentialsOrFail()
    } catch {
      return { success: false, provider: 'trello', error: 'Trello credentials not configured' }
    }

    // 2. Look up Trello mapping for this PMO ticket
    const mapper = new TrelloMapper(this.db)
    const mapping = mapper.getByTicketId(ticketId)
    if (!mapping) {
      return { success: false, provider: 'trello', error: `No Trello mapping for ticket ${ticketId}` }
    }

    const client = new TrelloClient(creds.apiKey, creds.apiToken)

    // 3. Get the card to find its board
    const card = await client.getCard(mapping.trelloCardId)
    if (!card) {
      return { success: false, provider: 'trello', error: `Trello card ${mapping.trelloCardId} not found` }
    }

    // 4. Get board lists and find matching list for the target state
    let lists: Array<{ id: string; name: string }>
    try {
      lists = await client.getBoardLists(card.idBoard)
    } catch (error) {
      return {
        success: false,
        provider: 'trello',
        error: `Failed to get board lists: ${error instanceof Error ? error.message : String(error)}`,
      }
    }

    const targetList = findMatchingTrelloList(lists, newState)
    if (!targetList) {
      return {
        success: false,
        provider: 'trello',
        error: `No matching Trello list for state "${newState}". Available lists: ${lists.map(l => l.name).join(', ')}`,
      }
    }

    // 5. Move the card to the target list
    try {
      await client.updateCard(mapping.trelloCardId, { name: card.name, idList: targetList.id })
    } catch (error) {
      return {
        success: false,
        provider: 'trello',
        error: `Failed to move Trello card: ${error instanceof Error ? error.message : String(error)}`,
      }
    }

    // 6. Update local PMO mirror (best-effort)
    try {
      await this.storage.moveTicket(this.projectId, ticketId, newState)
    } catch {
      // Non-fatal: Trello is the source of truth
    }

    // 7. Post a comment about the status change (best-effort)
    try {
      await client.addComment(
        mapping.trelloCardId,
        `Status updated to **${newState}** (via prlt)`,
      )
    } catch {
      // Non-fatal: comment is informational
    }

    // 8. Update sync timestamp (best-effort)
    try {
      mapper.updateSyncTimestamp(ticketId)
    } catch {
      // Non-fatal
    }

    return { success: true, provider: 'trello' }
  }

  async deleteTicket(ticketId: string): Promise<ProviderDeleteResult> {
    let creds: { apiKey: string; apiToken: string }
    try {
      creds = this.getCredentialsOrFail()
    } catch {
      return { success: false, provider: 'trello', error: 'Trello credentials not configured' }
    }

    // Look up Trello mapping
    const mapper = new TrelloMapper(this.db)
    const mapping = mapper.getByTicketId(ticketId)

    if (mapping) {
      // Archive the card in Trello (closed = true)
      const client = new TrelloClient(creds.apiKey, creds.apiToken)
      try {
        const card = await client.getCard(mapping.trelloCardId)
        if (card) {
          await client.updateCard(mapping.trelloCardId, { name: card.name, closed: true })
        }
      } catch (error) {
        return {
          success: false,
          provider: 'trello',
          error: `Failed to archive Trello card: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
    }

    // Delete the local PMO mirror
    try {
      await this.storage.deleteTicket(ticketId)
    } catch {
      // Non-fatal if Trello archive succeeded
    }

    return { success: true, provider: 'trello' }
  }

  async listTickets(projectId?: string, filter?: TicketFilter): Promise<ProviderListResult> {
    let creds: { apiKey: string; apiToken: string }
    try {
      creds = this.getCredentialsOrFail()
    } catch {
      return { success: false, provider: 'trello', tickets: [], error: 'Trello credentials not configured' }
    }

    const trelloConfig = loadTrelloConfig(this.db)
    const boardId = trelloConfig?.boardId || process.env.PRLT_TRELLO_BOARD_ID

    try {
      const envelopes = await listTrelloCards(
        { apiKey: creds.apiKey, apiToken: creds.apiToken, boardId },
        { limit: 50, query: filter?.search },
      )

      let tickets: Ticket[] = envelopes.map(envelope => ({
        id: envelope.source.externalKey,
        title: envelope.title,
        description: envelope.description || undefined,
        priority: envelope.priority || undefined,
        category: envelope.category || undefined,
        projectId: envelope.projectKey,
        projectName: envelope.projectKey,
        statusId: envelope.status,
        statusName: envelope.status,
        owner: envelope.assignee || undefined,
        assignee: envelope.assignee || undefined,
        subtasks: [],
        labels: envelope.labels,
        metadata: {
          external_source: envelope.source.name,
          external_key: envelope.source.externalKey,
          external_id: envelope.source.externalId,
          external_url: envelope.source.url,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      }))

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

      return { success: true, provider: 'trello', tickets }
    } catch (error) {
      return {
        success: false,
        provider: 'trello',
        tickets: [],
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async createTicket(projectId: string, input: CreateTicketInput): Promise<ProviderCreateResult> {
    let creds: { apiKey: string; apiToken: string }
    try {
      creds = this.getCredentialsOrFail()
    } catch {
      return { success: false, provider: 'trello', error: 'Trello credentials not configured' }
    }

    const client = new TrelloClient(creds.apiKey, creds.apiToken)
    const trelloConfig = loadTrelloConfig(this.db)
    const boardId = trelloConfig?.boardId || process.env.PRLT_TRELLO_BOARD_ID

    if (!boardId) {
      return { success: false, provider: 'trello', error: 'Trello board ID is required. Run "prlt trello configure" or set PRLT_TRELLO_BOARD_ID.' }
    }

    try {
      // Get the first list on the board as the default target
      const lists = await client.getBoardLists(boardId)
      if (lists.length === 0) {
        return { success: false, provider: 'trello', error: 'No lists found on the Trello board.' }
      }

      const targetList = lists[0]

      // Create the card in Trello
      const card = await client.createCard({
        name: input.title,
        desc: input.description || undefined,
        idList: targetList.id,
        idBoard: boardId,
      })

      // Create local PMO mirror ticket
      const mirrorDescription = [
        input.description || '',
        '',
        '---',
        `_Created in Trello: [${card.name}](${card.url})_`,
      ].join('\n').trim()

      const pmoTicket = await this.storage.createTicket(projectId, {
        ...input,
        title: card.name,
        description: mirrorDescription,
        metadata: {
          ...input.metadata,
          'external_source': 'trello',
          'external_id': card.id,
          'external_key': card.id,
          'external_url': card.url,
        },
      })

      // Create mapping record for sync operations
      const mapper = new TrelloMapper(this.db)
      mapper.createOrUpdateMapping(pmoTicket.id, card.id, card.idBoard)

      return { success: true, provider: 'trello', ticket: pmoTicket }
    } catch (error) {
      return {
        success: false,
        provider: 'trello',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async getTicket(ticketId: string): Promise<ProviderGetResult> {
    // Use local PMO mirror to avoid unnecessary API calls (same pattern as Linear)
    try {
      const ticket = await this.storage.getTicket(ticketId)
      return { success: true, provider: 'trello', ticket }
    } catch (error) {
      return {
        success: false,
        provider: 'trello',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async updateTicket(ticketId: string, input: UpdateTicketInput): Promise<ProviderUpdateResult> {
    let creds: { apiKey: string; apiToken: string }
    try {
      creds = this.getCredentialsOrFail()
    } catch {
      return { success: false, provider: 'trello', error: 'Trello credentials not configured' }
    }

    // Look up Trello mapping for this PMO ticket
    const mapper = new TrelloMapper(this.db)
    const mapping = mapper.getByTicketId(ticketId)

    if (mapping) {
      // Build Trello update payload from input fields
      const trelloInput: { name?: string; desc?: string } = {}
      if (input.title !== undefined) trelloInput.name = input.title
      if (input.description !== undefined) trelloInput.desc = input.description ?? undefined

      // Only call Trello API if there are Trello-relevant fields
      if (Object.keys(trelloInput).length > 0) {
        const client = new TrelloClient(creds.apiKey, creds.apiToken)
        try {
          // Trello updateCard requires name, so fetch current card if we don't have it
          if (!trelloInput.name) {
            const card = await client.getCard(mapping.trelloCardId)
            if (card) trelloInput.name = card.name
          }
          await client.updateCard(mapping.trelloCardId, trelloInput as { name: string; desc?: string })
        } catch (error) {
          return {
            success: false,
            provider: 'trello',
            error: `Failed to update Trello card: ${error instanceof Error ? error.message : String(error)}`,
          }
        }
      }

      // Update sync timestamp (best-effort)
      try {
        mapper.updateSyncTimestamp(ticketId)
      } catch {
        // Non-fatal
      }
    }

    // Also update local PMO mirror
    try {
      const ticket = await this.storage.updateTicket(ticketId, input as Partial<Ticket>)
      return { success: true, provider: 'trello', ticket }
    } catch (error) {
      return {
        success: false,
        provider: 'trello',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async assignTicket(ticketId: string, assignee: string): Promise<ProviderAssignResult> {
    // Trello assignee is via member IDs — best-effort on Trello side,
    // always update local PMO mirror
    try {
      await this.storage.updateTicket(ticketId, { assignee } as Partial<Ticket>)
      return { success: true, provider: 'trello' }
    } catch (error) {
      return {
        success: false,
        provider: 'trello',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
}

/**
 * Find the best matching Trello list for a target state name.
 * Uses case-insensitive exact match first, then substring match.
 */
function findMatchingTrelloList(
  lists: Array<{ id: string; name: string }>,
  targetState: string,
): { id: string; name: string } | null {
  const lower = targetState.toLowerCase()

  // 1. Exact match (case-insensitive)
  const exact = lists.find(l => l.name.toLowerCase() === lower)
  if (exact) return exact

  // 2. List name contains the target state
  const contains = lists.find(l => l.name.toLowerCase().includes(lower))
  if (contains) return contains

  // 3. Target state contains the list name
  const reverseContains = lists.find(l => lower.includes(l.name.toLowerCase()))
  if (reverseContains) return reverseContains

  return null
}

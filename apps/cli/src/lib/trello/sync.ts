import type { Ticket } from '../pmo/types.js'
import { TrelloClient } from './client.js'
import { TrelloMapper } from './mapper.js'

export class TrelloSync {
  constructor(
    private client: TrelloClient,
    private mapper: TrelloMapper,
  ) {}

  private buildCardName(ticket: Ticket): string {
    return `${ticket.id}: ${ticket.title}`
  }

  private buildCardDescription(ticket: Ticket): string {
    const parts = [ticket.description?.trim() || '', '', '---', `Synced from PMO ticket ${ticket.id}`]
    return parts.join('\n').trim()
  }

  private isCompletedStatus(ticket: Ticket): boolean {
    return ticket.statusCategory === 'completed' || ticket.statusCategory === 'canceled'
  }

  async createCardForTicket(ticket: Ticket, listId: string, boardId?: string): Promise<string> {
    const card = await this.client.createCard({
      name: this.buildCardName(ticket),
      desc: this.buildCardDescription(ticket),
      closed: this.isCompletedStatus(ticket),
      idList: listId,
      idBoard: boardId,
    })

    this.mapper.createOrUpdateMapping(ticket.id, card.id, boardId)
    return card.id
  }

  async syncTicket(ticket: Ticket, cardId: string): Promise<void> {
    await this.client.updateCard(cardId, {
      name: this.buildCardName(ticket),
      desc: this.buildCardDescription(ticket),
      closed: this.isCompletedStatus(ticket),
    })
    this.mapper.updateSyncTimestamp(ticket.id)
  }
}

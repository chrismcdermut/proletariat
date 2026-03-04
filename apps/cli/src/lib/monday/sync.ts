import type { Ticket } from '../pmo/types.js'
import { MondayClient } from './client.js'
import { MondayMapper } from './mapper.js'

export class MondaySync {
  constructor(
    private client: MondayClient,
    private mapper: MondayMapper,
  ) {}

  async syncTicket(ticket: Ticket, boardId: string): Promise<{ created: boolean; itemId: string }> {
    const itemName = this.ticketToItemName(ticket)
    const mapping = this.mapper.getByTicketId(ticket.id)

    if (mapping && mapping.mondayBoardId === boardId) {
      if (mapping.mondayItemName !== itemName) {
        await this.client.updateItemName(boardId, mapping.mondayItemId, itemName)
      }

      this.mapper.createOrUpdateMapping({
        pmoTicketId: ticket.id,
        mondayBoardId: boardId,
        mondayItemId: mapping.mondayItemId,
        mondayItemName: itemName,
        mondayItemUrl: mapping.mondayItemUrl,
        syncDirection: 'outbound',
      })

      return {
        created: false,
        itemId: mapping.mondayItemId,
      }
    }

    const createdItem = await this.client.createItem(boardId, itemName)

    this.mapper.createOrUpdateMapping({
      pmoTicketId: ticket.id,
      mondayBoardId: boardId,
      mondayItemId: createdItem.id,
      mondayItemName: createdItem.name,
      mondayItemUrl: createdItem.url,
      syncDirection: 'outbound',
    })

    return {
      created: true,
      itemId: createdItem.id,
    }
  }

  ticketToItemName(ticket: Ticket): string {
    return `${ticket.id}: ${ticket.title}`
  }
}

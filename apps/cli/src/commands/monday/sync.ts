import { Flags } from '@oclif/core'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import { colors } from '../../lib/colors.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'
import {
  MondayClient,
  MondayMapper,
  MondaySync,
  isMondayConfigured,
  loadMondayConfig,
} from '../../lib/monday/index.js'

export default class MondaySyncCommand extends PMOCommand {
  static description = 'Sync PMO tickets to Monday.com board items'

  static examples = [
    '<%= config.bin %> <%= command.id %>                     # Sync project tickets to Monday board',
    '<%= config.bin %> <%= command.id %> --ticket TKT-001    # Sync one ticket',
    '<%= config.bin %> <%= command.id %> --dry-run           # Preview sync operations',
  ]

  static flags = {
    ...pmoBaseFlags,
    ticket: Flags.string({
      description: 'PMO ticket ID to sync',
    }),
    'dry-run': Flags.boolean({
      description: 'Preview what would be synced without writing to Monday',
      default: false,
    }),
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(MondaySyncCommand)
    const jsonMode = shouldOutputJson(flags)
    const db = this.storage.getDatabase()

    if (!isMondayConfigured(db)) {
      if (jsonMode) {
        outputErrorAsJson('MONDAY_NOT_CONFIGURED', 'Monday is not configured. Run "prlt monday connect" first.', createMetadata('monday sync', flags))
        this.exit(1)
      }
      this.error('Monday is not configured. Run "prlt monday connect" first.')
    }

    const config = loadMondayConfig(db)!
    if (!config.boardId) {
      if (jsonMode) {
        outputErrorAsJson('MONDAY_BOARD_REQUIRED', 'No Monday board configured. Run "prlt monday connect --board <id>" first.', createMetadata('monday sync', flags))
        this.exit(1)
      }
      this.error('No Monday board configured. Run "prlt monday connect --board <id>" first.')
    }

    const client = new MondayClient(config.apiToken)
    const mapper = new MondayMapper(db)
    const sync = new MondaySync(client, mapper)

    if (flags.ticket) {
      await this.syncSingleTicket(flags.ticket, config.boardId!, sync, jsonMode, flags)
      return
    }

    const projectId = await this.requireProject({
      jsonMode: jsonMode ? {
        flags,
        commandName: 'monday sync',
        baseCommand: `${this.config.bin} monday sync`,
      } : undefined,
    })

    const tickets = await this.storage.listTickets(projectId)

    if (tickets.length === 0) {
      if (jsonMode) {
        outputSuccessAsJson({
          synced: 0,
          created: 0,
          skipped: 0,
          message: `No tickets found for project ${projectId}.`,
        }, createMetadata('monday sync', flags))
        return
      }

      this.log(colors.warning(`No tickets found for project ${projectId}.`))
      return
    }

    if (flags['dry-run']) {
      if (jsonMode) {
        outputSuccessAsJson({
          dryRun: true,
          action: 'sync-all',
          projectId,
          boardId: config.boardId,
          tickets: tickets.map((ticket) => ({
            ticketId: ticket.id,
            itemName: sync.ticketToItemName(ticket),
            mapped: mapper.getByTicketId(ticket.id) !== null,
          })),
        }, createMetadata('monday sync', flags))
        return
      }

      this.log(colors.textMuted(`Would sync ${tickets.length} ticket(s) from ${projectId} to Monday board ${config.boardId}.`))
      return
    }

    let syncedCount = 0
    let createdCount = 0
    const errors: Array<{ ticketId: string; error: string }> = []

    for (const ticket of tickets) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const result = await sync.syncTicket(ticket, config.boardId!)
        syncedCount++
        if (result.created) createdCount++
      } catch (error) {
        errors.push({
          ticketId: ticket.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    if (jsonMode) {
      outputSuccessAsJson({
        action: 'sync-all',
        projectId,
        boardId: config.boardId,
        synced: syncedCount,
        created: createdCount,
        skipped: tickets.length - syncedCount,
        errors,
      }, createMetadata('monday sync', flags))
      return
    }

    this.log(colors.success(`Synced ${syncedCount}/${tickets.length} ticket(s) to Monday`))
    this.log(colors.textMuted(`  Created new items: ${createdCount}`))
    if (errors.length > 0) {
      this.log(colors.warning(`  Errors: ${errors.length}`))
      for (const error of errors.slice(0, 5)) {
        this.log(colors.textMuted(`    ${error.ticketId}: ${error.error}`))
      }
    }
  }

  private async syncSingleTicket(
    ticketId: string,
    boardId: string,
    sync: MondaySync,
    jsonMode: boolean,
    flags: Record<string, unknown>,
  ): Promise<void> {
    const ticket = await this.storage.getTicket(ticketId)

    if (!ticket) {
      if (jsonMode) {
        outputErrorAsJson('TICKET_NOT_FOUND', `Ticket ${ticketId} not found.`, createMetadata('monday sync', flags))
        this.exit(1)
      }
      this.error(`Ticket ${ticketId} not found.`)
    }

    if (flags['dry-run']) {
      if (jsonMode) {
        outputSuccessAsJson({
          dryRun: true,
          action: 'sync-ticket',
          ticketId,
          boardId,
          itemName: sync.ticketToItemName(ticket!),
        }, createMetadata('monday sync', flags))
        return
      }

      this.log(colors.textMuted(`Would sync ${ticketId} to Monday board ${boardId}.`))
      return
    }

    try {
      const result = await sync.syncTicket(ticket!, boardId)

      if (jsonMode) {
        outputSuccessAsJson({
          action: 'sync-ticket',
          ticketId,
          boardId,
          itemId: result.itemId,
          created: result.created,
        }, createMetadata('monday sync', flags))
        return
      }

      if (result.created) {
        this.log(colors.success(`Created Monday item for ${ticketId}`))
      } else {
        this.log(colors.success(`Updated Monday item for ${ticketId}`))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (jsonMode) {
        outputErrorAsJson('MONDAY_SYNC_FAILED', `Failed to sync ${ticketId}: ${message}`, createMetadata('monday sync', flags))
        this.exit(1)
      }
      this.error(`Failed to sync ${ticketId}: ${message}`)
    }
  }
}

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
  TrelloClient,
  TrelloMapper,
  TrelloSync,
  isTrelloConfigured,
  loadTrelloConfig,
} from '../../lib/trello/index.js'

export default class TrelloSyncCommand extends PMOCommand {
  static description = 'Sync PMO tickets to Trello cards'

  static examples = [
    '<%= config.bin %> <%= command.id %> --ticket TKT-001 --card abc123',
    '<%= config.bin %> <%= command.id %> --ticket TKT-001 --create-missing',
    '<%= config.bin %> <%= command.id %> --dry-run',
  ]

  static flags = {
    ...pmoBaseFlags,
    ticket: Flags.string({
      description: 'PMO ticket ID to sync (syncs all mapped tickets if omitted)',
    }),
    card: Flags.string({
      description: 'Trello card ID to map to --ticket',
    }),
    list: Flags.string({
      description: 'Trello list ID used with --create-missing',
    }),
    'create-missing': Flags.boolean({
      description: 'Create Trello card when no mapping exists (requires list)',
      default: false,
    }),
    'dry-run': Flags.boolean({
      description: 'Preview sync operations without making changes',
      default: false,
    }),
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(TrelloSyncCommand)
    const jsonMode = shouldOutputJson(flags)
    const db = this.storage.getDatabase()

    if (!isTrelloConfigured(db)) {
      if (jsonMode) {
        outputErrorAsJson('TRELLO_NOT_CONFIGURED', 'Trello is not configured. Run "prlt trello configure" first.', createMetadata('trello sync', flags))
        this.exit(1)
      }
      this.error('Trello is not configured. Run "prlt trello configure" first.')
    }

    const config = loadTrelloConfig(db)!
    const client = new TrelloClient(config.apiKey, config.apiToken)
    const mapper = new TrelloMapper(db)
    const sync = new TrelloSync(client, mapper)

    if (flags.ticket) {
      const ticket = await this.storage.getTicket(flags.ticket)
      if (!ticket) {
        if (jsonMode) {
          outputErrorAsJson('TICKET_NOT_FOUND', `Ticket ${flags.ticket} not found.`, createMetadata('trello sync', flags))
          this.exit(1)
        }
        this.error(`Ticket ${flags.ticket} not found.`)
      }

      if (flags.card) {
        mapper.createOrUpdateMapping(flags.ticket, flags.card, config.boardId)
      }

      const mapping = mapper.getByTicketId(flags.ticket)
      if (!mapping) {
        if (!flags['create-missing']) {
          if (jsonMode) {
            outputSuccessAsJson({
              synced: false,
              message: `Ticket ${flags.ticket} has no Trello mapping. Use --card or --create-missing.`,
            }, createMetadata('trello sync', flags))
            return
          }
          this.log(colors.warning(`Ticket ${flags.ticket} has no Trello mapping. Use --card or --create-missing.`))
          return
        }

        const listId = flags.list
        if (!listId) {
          if (jsonMode) {
            outputErrorAsJson('TRELLO_LIST_REQUIRED', 'List ID is required for --create-missing. Use --list.', createMetadata('trello sync', flags))
            this.exit(1)
          }
          this.error('List ID is required for --create-missing. Use --list.')
        }

        if (flags['dry-run']) {
          if (jsonMode) {
            outputSuccessAsJson({
              dryRun: true,
              action: 'create-and-sync',
              ticketId: flags.ticket,
              listId,
            }, createMetadata('trello sync', flags))
            return
          }
          this.log(colors.textMuted(`Would create Trello card in list ${listId} for ${flags.ticket}`))
          return
        }

        const cardId = await sync.createCardForTicket(ticket!, listId!, config.boardId)
        await sync.syncTicket(ticket!, cardId)

        if (jsonMode) {
          outputSuccessAsJson({
            action: 'create-and-sync',
            ticketId: flags.ticket,
            trelloCardId: cardId,
            synced: true,
          }, createMetadata('trello sync', flags))
          return
        }

        this.log(colors.success(`Created and synced Trello card ${cardId} for ${flags.ticket}`))
        return
      }

      if (flags['dry-run']) {
        if (jsonMode) {
          outputSuccessAsJson({
            dryRun: true,
            action: 'sync-ticket',
            ticketId: flags.ticket,
            trelloCardId: mapping.trelloCardId,
            statusCategory: ticket!.statusCategory,
          }, createMetadata('trello sync', flags))
          return
        }
        this.log(colors.textMuted(`Would sync ${flags.ticket} to Trello card ${mapping.trelloCardId}`))
        return
      }

      await sync.syncTicket(ticket!, mapping.trelloCardId)

      if (jsonMode) {
        outputSuccessAsJson({
          action: 'sync-ticket',
          ticketId: flags.ticket,
          trelloCardId: mapping.trelloCardId,
          synced: true,
        }, createMetadata('trello sync', flags))
        return
      }

      this.log(colors.success(`Synced ${flags.ticket} to Trello card ${mapping.trelloCardId}`))
      return
    }

    const mappings = mapper.listMappings()
    if (mappings.length === 0) {
      if (jsonMode) {
        outputSuccessAsJson({ synced: 0, skipped: 0, errors: 0, message: 'No mapped tickets to sync.' }, createMetadata('trello sync', flags))
        return
      }
      this.log(colors.textMuted('No mapped tickets to sync.'))
      return
    }

    if (flags['dry-run']) {
      const preview = []
      for (const mapping of mappings) {
        // eslint-disable-next-line no-await-in-loop
        const ticket = await this.storage.getTicket(mapping.pmoTicketId)
        preview.push({
          ticketId: mapping.pmoTicketId,
          trelloCardId: mapping.trelloCardId,
          statusCategory: ticket?.statusCategory ?? null,
        })
      }

      if (jsonMode) {
        outputSuccessAsJson({ dryRun: true, action: 'sync-all', tickets: preview }, createMetadata('trello sync', flags))
        return
      }

      for (const item of preview) {
        this.log(colors.textMuted(`  ${item.ticketId} -> ${item.trelloCardId} (${item.statusCategory ?? 'missing'})`))
      }
      return
    }

    let synced = 0
    let skipped = 0
    let errors = 0

    for (const mapping of mappings) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const ticket = await this.storage.getTicket(mapping.pmoTicketId)
        if (!ticket) {
          skipped++
          continue
        }

        // eslint-disable-next-line no-await-in-loop
        await sync.syncTicket(ticket, mapping.trelloCardId)
        synced++
      } catch {
        errors++
      }
    }

    if (jsonMode) {
      outputSuccessAsJson({ action: 'sync-all', synced, skipped, errors }, createMetadata('trello sync', flags))
      return
    }

    this.log(colors.success(`Trello sync complete: ${synced} synced, ${skipped} skipped, ${errors} errors`))
  }
}

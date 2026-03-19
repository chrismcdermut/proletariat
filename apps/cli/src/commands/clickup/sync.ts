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
  ClickUpClient,
  ClickUpMapper,
  ClickUpSync,
  isClickUpConfigured,
  loadClickUpConfig,
} from '../../lib/clickup/index.js'

export default class ClickUpSyncCommand extends PMOCommand {
  static description = 'Sync PMO tickets to ClickUp tasks'

  static examples = [
    '<%= config.bin %> <%= command.id %> --ticket TKT-001 --task abc123',
    '<%= config.bin %> <%= command.id %> --ticket TKT-001 --create-missing',
    '<%= config.bin %> <%= command.id %> --dry-run',
  ]

  static flags = {
    ...pmoBaseFlags,
    ticket: Flags.string({
      description: 'PMO ticket ID to sync (syncs all mapped tickets if omitted)',
    }),
    task: Flags.string({
      description: 'ClickUp task ID to map to --ticket',
    }),
    list: Flags.string({
      description: 'ClickUp list ID used with --create-missing',
    }),
    'create-missing': Flags.boolean({
      description: 'Create ClickUp task when no mapping exists (requires list)',
      default: false,
    }),
    'dry-run': Flags.boolean({
      description: 'Preview sync operations without making changes',
      default: false,
    }),
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(ClickUpSyncCommand)
    const jsonMode = shouldOutputJson(flags)
    const db = this.storage.getDatabase()

    if (!isClickUpConfigured(db)) {
      if (jsonMode) {
        outputErrorAsJson('CLICKUP_NOT_CONFIGURED', 'ClickUp is not configured. Run "prlt clickup connect" first.', createMetadata('clickup sync', flags))
        return
      }
      this.error('ClickUp is not configured. Run "prlt clickup connect" first.')
    }

    const config = loadClickUpConfig(db)!
    const client = new ClickUpClient(config.apiKey)
    const mapper = new ClickUpMapper(db)
    const sync = new ClickUpSync(client, mapper)

    if (flags.ticket) {
      const ticket = await this.storage.getTicket(flags.ticket)
      if (!ticket) {
        if (jsonMode) {
          outputErrorAsJson('TICKET_NOT_FOUND', `Ticket ${flags.ticket} not found.`, createMetadata('clickup sync', flags))
          return
        }
        this.error(`Ticket ${flags.ticket} not found.`)
      }

      if (flags.task) {
        mapper.createOrUpdateMapping(flags.ticket, flags.task, flags.list ?? config.listId)
      }

      const mapping = mapper.getByTicketId(flags.ticket)
      if (!mapping) {
        if (!flags['create-missing']) {
          if (jsonMode) {
            outputSuccessAsJson({
              synced: false,
              message: `Ticket ${flags.ticket} has no ClickUp mapping. Use --task or --create-missing.`,
            }, createMetadata('clickup sync', flags))
            return
          }
          this.log(colors.warning(`Ticket ${flags.ticket} has no ClickUp mapping. Use --task or --create-missing.`))
          return
        }

        const listId = flags.list ?? config.listId
        if (!listId) {
          if (jsonMode) {
            outputErrorAsJson('CLICKUP_LIST_REQUIRED', 'List ID is required for --create-missing. Use --list or run "prlt clickup connect" and select a list.', createMetadata('clickup sync', flags))
            return
          }
          this.error('List ID is required for --create-missing. Use --list or run "prlt clickup connect" and select a list.')
        }

        if (flags['dry-run']) {
          if (jsonMode) {
            outputSuccessAsJson({
              dryRun: true,
              action: 'create-and-sync',
              ticketId: flags.ticket,
              listId,
            }, createMetadata('clickup sync', flags))
            return
          }
          this.log(colors.textMuted(`Would create ClickUp task in list ${listId} for ${flags.ticket}`))
          return
        }

        const taskId = await sync.createTaskForTicket(ticket!, listId!)
        await sync.syncTicket(ticket!, taskId)

        if (jsonMode) {
          outputSuccessAsJson({
            action: 'create-and-sync',
            ticketId: flags.ticket,
            clickupTaskId: taskId,
            synced: true,
          }, createMetadata('clickup sync', flags))
          return
        }

        this.log(colors.success(`Created and synced ClickUp task ${taskId} for ${flags.ticket}`))
        return
      }

      if (flags['dry-run']) {
        if (jsonMode) {
          outputSuccessAsJson({
            dryRun: true,
            action: 'sync-ticket',
            ticketId: flags.ticket,
            clickupTaskId: mapping.clickupTaskId,
            statusCategory: ticket!.statusCategory,
          }, createMetadata('clickup sync', flags))
          return
        }
        this.log(colors.textMuted(`Would sync ${flags.ticket} to ClickUp task ${mapping.clickupTaskId}`))
        return
      }

      await sync.syncTicket(ticket!, mapping.clickupTaskId)

      if (jsonMode) {
        outputSuccessAsJson({
          action: 'sync-ticket',
          ticketId: flags.ticket,
          clickupTaskId: mapping.clickupTaskId,
          synced: true,
        }, createMetadata('clickup sync', flags))
        return
      }

      this.log(colors.success(`Synced ${flags.ticket} to ClickUp task ${mapping.clickupTaskId}`))
      return
    }

    const mappings = mapper.listMappings()
    if (mappings.length === 0) {
      if (jsonMode) {
        outputSuccessAsJson({ synced: 0, skipped: 0, errors: 0, message: 'No mapped tickets to sync.' }, createMetadata('clickup sync', flags))
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
          clickupTaskId: mapping.clickupTaskId,
          statusCategory: ticket?.statusCategory ?? null,
        })
      }

      if (jsonMode) {
        outputSuccessAsJson({ dryRun: true, action: 'sync-all', tickets: preview }, createMetadata('clickup sync', flags))
        return
      }

      for (const item of preview) {
        this.log(colors.textMuted(`  ${item.ticketId} -> ${item.clickupTaskId} (${item.statusCategory ?? 'missing'})`))
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
        await sync.syncTicket(ticket, mapping.clickupTaskId)
        synced++
      } catch {
        errors++
      }
    }

    if (jsonMode) {
      outputSuccessAsJson({ action: 'sync-all', synced, skipped, errors }, createMetadata('clickup sync', flags))
      return
    }

    this.log(colors.success(`ClickUp sync complete: ${synced} synced, ${skipped} skipped, ${errors} errors`))
  }
}

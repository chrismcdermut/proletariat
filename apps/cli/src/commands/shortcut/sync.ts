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
  ShortcutClient,
  ShortcutMapper,
  ShortcutSync,
  isShortcutConfigured,
  loadShortcutConfig,
} from '../../lib/shortcut/index.js'

export default class ShortcutSyncCommand extends PMOCommand {
  static description = 'Sync PMO tickets to Shortcut stories'

  static examples = [
    '<%= config.bin %> <%= command.id %> --ticket TKT-001 --story 12345',
    '<%= config.bin %> <%= command.id %> --ticket TKT-001',
    '<%= config.bin %> <%= command.id %> --dry-run',
  ]

  static flags = {
    ...pmoBaseFlags,
    ticket: Flags.string({
      description: 'PMO ticket ID to sync (syncs all mapped tickets if omitted)',
    }),
    story: Flags.string({
      description: 'Shortcut story ID to map to --ticket',
    }),
    'dry-run': Flags.boolean({
      description: 'Preview sync operations without making changes',
      default: false,
    }),
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(ShortcutSyncCommand)
    const jsonMode = shouldOutputJson(flags)
    const db = this.storage.getDatabase()

    if (!isShortcutConfigured(db)) {
      if (jsonMode) {
        outputErrorAsJson('SHORTCUT_NOT_CONFIGURED', 'Shortcut is not configured. Run "prlt shortcut connect" first.', createMetadata('shortcut sync', flags))
        this.exit(1)
      }
      this.error('Shortcut is not configured. Run "prlt shortcut connect" first.')
    }

    const config = loadShortcutConfig(db)!
    const client = new ShortcutClient(config.apiToken)
    const mapper = new ShortcutMapper(db)
    const sync = new ShortcutSync(client, mapper)

    // Fetch workflow states for status mapping
    const statesList = await client.listWorkflowStates()
    const workflowStates = new Map<number, { id: number; name: string; type: string }>()
    for (const state of statesList) {
      workflowStates.set(state.id, state)
    }

    if (flags.ticket) {
      const ticket = await this.storage.getTicket(flags.ticket)
      if (!ticket) {
        if (jsonMode) {
          outputErrorAsJson('TICKET_NOT_FOUND', `Ticket ${flags.ticket} not found.`, createMetadata('shortcut sync', flags))
          this.exit(1)
        }
        this.error(`Ticket ${flags.ticket} not found.`)
      }

      if (flags.story) {
        mapper.createOrUpdateMapping(flags.ticket, flags.story, config.workspaceSlug)
      }

      const mapping = mapper.getByTicketId(flags.ticket)
      if (!mapping) {
        if (jsonMode) {
          outputSuccessAsJson({
            synced: false,
            message: `Ticket ${flags.ticket} has no Shortcut mapping. Use --story to map a story.`,
          }, createMetadata('shortcut sync', flags))
          return
        }
        this.log(colors.warning(`Ticket ${flags.ticket} has no Shortcut mapping. Use --story to map a story.`))
        return
      }

      if (flags['dry-run']) {
        if (jsonMode) {
          outputSuccessAsJson({
            dryRun: true,
            action: 'sync-ticket',
            ticketId: flags.ticket,
            shortcutStoryId: mapping.shortcutStoryId,
            statusCategory: ticket!.statusCategory,
          }, createMetadata('shortcut sync', flags))
          return
        }
        this.log(colors.textMuted(`Would sync ${flags.ticket} to Shortcut story ${mapping.shortcutStoryId}`))
        return
      }

      await sync.syncTicket(ticket!, mapping.shortcutStoryId, workflowStates)

      if (jsonMode) {
        outputSuccessAsJson({
          action: 'sync-ticket',
          ticketId: flags.ticket,
          shortcutStoryId: mapping.shortcutStoryId,
          synced: true,
        }, createMetadata('shortcut sync', flags))
        return
      }

      this.log(colors.success(`Synced ${flags.ticket} to Shortcut story ${mapping.shortcutStoryId}`))
      return
    }

    // Bulk sync: all mapped tickets
    const mappings = mapper.listMappings()
    if (mappings.length === 0) {
      if (jsonMode) {
        outputSuccessAsJson({ synced: 0, skipped: 0, errors: 0, message: 'No mapped tickets to sync.' }, createMetadata('shortcut sync', flags))
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
          shortcutStoryId: mapping.shortcutStoryId,
          statusCategory: ticket?.statusCategory ?? null,
        })
      }

      if (jsonMode) {
        outputSuccessAsJson({ dryRun: true, action: 'sync-all', tickets: preview }, createMetadata('shortcut sync', flags))
        return
      }

      for (const item of preview) {
        this.log(colors.textMuted(`  ${item.ticketId} -> story ${item.shortcutStoryId} (${item.statusCategory ?? 'missing'})`))
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
        await sync.syncTicket(ticket, mapping.shortcutStoryId, workflowStates)
        synced++
      } catch {
        errors++
      }
    }

    if (jsonMode) {
      outputSuccessAsJson({ action: 'sync-all', synced, skipped, errors }, createMetadata('shortcut sync', flags))
      return
    }

    this.log(colors.success(`Shortcut sync complete: ${synced} synced, ${skipped} skipped, ${errors} errors`))
  }
}

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
  AsanaClient,
  AsanaMapper,
  AsanaSync,
  isAsanaConfigured,
  loadAsanaConfig,
} from '../../lib/asana/index.js'

export default class AsanaSyncCommand extends PMOCommand {
  static description = 'Sync PMO tickets to Asana tasks'

  static examples = [
    '<%= config.bin %> <%= command.id %> --ticket TKT-001 --task 123456789',
    '<%= config.bin %> <%= command.id %> --ticket TKT-001 --create-missing',
    '<%= config.bin %> <%= command.id %> --dry-run',
  ]

  static flags = {
    ...pmoBaseFlags,
    ticket: Flags.string({
      description: 'PMO ticket ID to sync (syncs all mapped tickets if omitted)',
    }),
    task: Flags.string({
      description: 'Asana task gid to map to --ticket',
    }),
    project: Flags.string({
      description: 'Asana project gid used with --create-missing',
    }),
    'create-missing': Flags.boolean({
      description: 'Create Asana task when no mapping exists (requires project)',
      default: false,
    }),
    'dry-run': Flags.boolean({
      description: 'Preview sync operations without making changes',
      default: false,
    }),
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(AsanaSyncCommand)
    const jsonMode = shouldOutputJson(flags)
    const db = this.storage.getDatabase()

    if (!isAsanaConfigured(db)) {
      if (jsonMode) {
        outputErrorAsJson('ASANA_NOT_CONFIGURED', 'Asana is not configured. Run "prlt asana connect" first.', createMetadata('asana sync', flags))
        this.exit(1)
      }
      this.error('Asana is not configured. Run "prlt asana connect" first.')
    }

    const config = loadAsanaConfig(db)!
    const client = new AsanaClient(config.accessToken)
    const mapper = new AsanaMapper(db)
    const sync = new AsanaSync(client, mapper)

    if (flags.ticket) {
      const ticket = await this.storage.getTicket(flags.ticket)
      if (!ticket) {
        if (jsonMode) {
          outputErrorAsJson('TICKET_NOT_FOUND', `Ticket ${flags.ticket} not found.`, createMetadata('asana sync', flags))
          this.exit(1)
        }
        this.error(`Ticket ${flags.ticket} not found.`)
      }

      if (flags.task) {
        mapper.createOrUpdateMapping(flags.ticket, flags.task, flags.project ?? config.projectGid)
      }

      const mapping = mapper.getByTicketId(flags.ticket)
      if (!mapping) {
        if (!flags['create-missing']) {
          if (jsonMode) {
            outputSuccessAsJson({
              synced: false,
              message: `Ticket ${flags.ticket} has no Asana mapping. Use --task or --create-missing.`,
            }, createMetadata('asana sync', flags))
            return
          }
          this.log(colors.warning(`Ticket ${flags.ticket} has no Asana mapping. Use --task or --create-missing.`))
          return
        }

        const projectGid = flags.project ?? config.projectGid
        if (!projectGid) {
          if (jsonMode) {
            outputErrorAsJson('ASANA_PROJECT_REQUIRED', 'Project gid is required for --create-missing. Use --project or run "prlt asana connect --project ...".', createMetadata('asana sync', flags))
            this.exit(1)
          }
          this.error('Project gid is required for --create-missing. Use --project or run "prlt asana connect --project ...".')
        }

        if (flags['dry-run']) {
          if (jsonMode) {
            outputSuccessAsJson({
              dryRun: true,
              action: 'create-and-sync',
              ticketId: flags.ticket,
              projectGid,
            }, createMetadata('asana sync', flags))
            return
          }
          this.log(colors.textMuted(`Would create Asana task in project ${projectGid} for ${flags.ticket}`))
          return
        }

        const taskGid = await sync.createTaskForTicket(ticket!, projectGid!)
        await sync.syncTicket(ticket!, taskGid)

        if (jsonMode) {
          outputSuccessAsJson({
            action: 'create-and-sync',
            ticketId: flags.ticket,
            asanaTaskGid: taskGid,
            synced: true,
          }, createMetadata('asana sync', flags))
          return
        }

        this.log(colors.success(`Created and synced Asana task ${taskGid} for ${flags.ticket}`))
        return
      }

      if (flags['dry-run']) {
        if (jsonMode) {
          outputSuccessAsJson({
            dryRun: true,
            action: 'sync-ticket',
            ticketId: flags.ticket,
            asanaTaskGid: mapping.asanaTaskGid,
            statusCategory: ticket!.statusCategory,
          }, createMetadata('asana sync', flags))
          return
        }
        this.log(colors.textMuted(`Would sync ${flags.ticket} to Asana task ${mapping.asanaTaskGid}`))
        return
      }

      await sync.syncTicket(ticket!, mapping.asanaTaskGid)

      if (jsonMode) {
        outputSuccessAsJson({
          action: 'sync-ticket',
          ticketId: flags.ticket,
          asanaTaskGid: mapping.asanaTaskGid,
          synced: true,
        }, createMetadata('asana sync', flags))
        return
      }

      this.log(colors.success(`Synced ${flags.ticket} to Asana task ${mapping.asanaTaskGid}`))
      return
    }

    const mappings = mapper.listMappings()
    if (mappings.length === 0) {
      if (jsonMode) {
        outputSuccessAsJson({ synced: 0, skipped: 0, errors: 0, message: 'No mapped tickets to sync.' }, createMetadata('asana sync', flags))
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
          asanaTaskGid: mapping.asanaTaskGid,
          statusCategory: ticket?.statusCategory ?? null,
        })
      }

      if (jsonMode) {
        outputSuccessAsJson({ dryRun: true, action: 'sync-all', tickets: preview }, createMetadata('asana sync', flags))
        return
      }

      for (const item of preview) {
        this.log(colors.textMuted(`  ${item.ticketId} -> ${item.asanaTaskGid} (${item.statusCategory ?? 'missing'})`))
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
        await sync.syncTicket(ticket, mapping.asanaTaskGid)
        synced++
      } catch {
        errors++
      }
    }

    if (jsonMode) {
      outputSuccessAsJson({ action: 'sync-all', synced, skipped, errors }, createMetadata('asana sync', flags))
      return
    }

    this.log(colors.success(`Asana sync complete: ${synced} synced, ${skipped} skipped, ${errors} errors`))
  }
}

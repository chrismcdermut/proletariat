import { Flags } from '@oclif/core'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import { colors } from '../../lib/colors.js'
import { styles } from '../../lib/styles.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'
import {
  LinearClient,
  LinearMapper,
  LinearSync,
  isLinearConfigured,
  loadLinearConfig,
} from '../../lib/linear/index.js'

export default class LinearSyncCommand extends PMOCommand {
  static description = 'Sync PMO ticket status and PR links back to Linear'

  static examples = [
    '<%= config.bin %> <%= command.id %>                    # Sync all mapped tickets',
    '<%= config.bin %> <%= command.id %> --ticket TKT-001   # Sync a specific ticket',
    '<%= config.bin %> <%= command.id %> --pr-url https://github.com/... --ticket TKT-001  # Attach PR to Linear issue',
    '<%= config.bin %> <%= command.id %> --dry-run          # Preview what would be synced',
  ]

  static flags = {
    ...pmoBaseFlags,
    ticket: Flags.string({
      description: 'PMO ticket ID to sync (syncs all if omitted)',
    }),
    'pr-url': Flags.string({
      description: 'PR URL to attach to the Linear issue',
    }),
    'pr-title': Flags.string({
      description: 'PR title for the attachment (defaults to ticket title)',
    }),
    'dry-run': Flags.boolean({
      description: 'Preview what would be synced without making changes',
      default: false,
    }),
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(LinearSyncCommand)
    const jsonMode = shouldOutputJson(flags)
    const db = this.storage.getDatabase()

    if (!isLinearConfigured(db)) {
      if (jsonMode) {
        outputErrorAsJson('LINEAR_NOT_CONFIGURED', 'Linear is not configured. Run "prlt linear auth" first.', createMetadata('linear sync', flags))
        this.exit(1)
      }
      this.error('Linear is not configured. Run "prlt linear auth" first.')
    }

    const config = loadLinearConfig(db)!
    const client = new LinearClient(config.apiKey)
    const mapper = new LinearMapper(db)
    const sync = new LinearSync(client, mapper)

    // Handle PR link attachment
    if (flags['pr-url'] && flags.ticket) {
      const prTitle = flags['pr-title'] ?? (await this.storage.getTicket(flags.ticket))?.title ?? 'Pull Request'

      if (flags['dry-run']) {
        if (jsonMode) {
          outputSuccessAsJson({
            dryRun: true,
            action: 'attach-pr',
            ticketId: flags.ticket,
            prUrl: flags['pr-url'],
            prTitle,
          }, createMetadata('linear sync', flags))
          return
        }
        this.log(styles.muted(`Would attach PR to ${flags.ticket}: ${flags['pr-url']}`))
        return
      }

      const attached = await sync.syncPRLink(flags.ticket, flags['pr-url'], prTitle)

      if (jsonMode) {
        outputSuccessAsJson({
          action: 'attach-pr',
          ticketId: flags.ticket,
          prUrl: flags['pr-url'],
          synced: attached,
        }, createMetadata('linear sync', flags))
        return
      }

      if (attached) {
        this.log(colors.success(`PR linked to Linear issue for ${flags.ticket}`))
      } else {
        this.log(colors.warning(`No Linear mapping found for ${flags.ticket}`))
      }
      return
    }

    // Sync ticket status(es) back to Linear
    if (flags.ticket) {
      // Single ticket sync
      const ticket = await this.storage.getTicket(flags.ticket)
      if (!ticket) {
        if (jsonMode) {
          outputErrorAsJson('TICKET_NOT_FOUND', `Ticket ${flags.ticket} not found.`, createMetadata('linear sync', flags))
          this.exit(1)
        }
        this.error(`Ticket ${flags.ticket} not found.`)
      }

      const mapping = mapper.getByTicketId(flags.ticket)
      if (!mapping) {
        if (jsonMode) {
          outputSuccessAsJson({
            synced: false,
            message: `Ticket ${flags.ticket} has no Linear mapping.`,
          }, createMetadata('linear sync', flags))
          return
        }
        this.log(colors.warning(`Ticket ${flags.ticket} has no Linear mapping.`))
        return
      }

      // Get Linear states for the team
      const team = await client.getTeamByKey(mapping.linearTeamKey)
      if (!team) {
        if (jsonMode) {
          outputErrorAsJson('TEAM_NOT_FOUND', `Linear team ${mapping.linearTeamKey} not found.`, createMetadata('linear sync', flags))
          this.exit(1)
        }
        this.error(`Linear team ${mapping.linearTeamKey} not found.`)
      }

      const linearStates = await client.listStates(team.id)

      if (flags['dry-run']) {
        if (jsonMode) {
          outputSuccessAsJson({
            dryRun: true,
            action: 'sync-status',
            ticketId: flags.ticket,
            linearIdentifier: mapping.linearIdentifier,
            currentStatus: ticket!.statusName,
            statusCategory: ticket!.statusCategory,
          }, createMetadata('linear sync', flags))
          return
        }
        this.log(styles.muted(`Would sync ${flags.ticket} (${mapping.linearIdentifier}): status "${ticket!.statusName}" (${ticket!.statusCategory})`))
        return
      }

      const synced = await sync.syncTicketStatus(ticket!, linearStates)

      if (jsonMode) {
        outputSuccessAsJson({
          action: 'sync-status',
          ticketId: flags.ticket,
          linearIdentifier: mapping.linearIdentifier,
          synced,
        }, createMetadata('linear sync', flags))
        return
      }

      if (synced) {
        this.log(colors.success(`Synced ${mapping.linearIdentifier} status to Linear`))
      } else {
        this.log(colors.warning(`Could not find matching Linear state for ${ticket!.statusCategory}`))
      }
      return
    }

    // Bulk sync: sync all mapped tickets
    const mappings = mapper.listMappings()

    if (mappings.length === 0) {
      if (jsonMode) {
        outputSuccessAsJson({
          synced: 0,
          message: 'No mapped tickets to sync.',
        }, createMetadata('linear sync', flags))
        return
      }
      this.log(styles.muted('No mapped tickets to sync.'))
      return
    }

    if (!jsonMode) {
      this.log(styles.muted(`Syncing ${mappings.length} mapped ticket(s) to Linear...`))
    }

    // Group mappings by team to fetch states efficiently
    const teamKeys = [...new Set(mappings.map((m) => m.linearTeamKey))]
    const statesByTeam: Record<string, Awaited<ReturnType<typeof client.listStates>>> = {}

    for (const teamKey of teamKeys) {
      // eslint-disable-next-line no-await-in-loop
      const team = await client.getTeamByKey(teamKey)
      if (team) {
        // eslint-disable-next-line no-await-in-loop
        statesByTeam[teamKey] = await client.listStates(team.id)
      }
    }

    if (flags['dry-run']) {
      const preview = []
      for (const mapping of mappings) {
        // eslint-disable-next-line no-await-in-loop
        const ticket = await this.storage.getTicket(mapping.pmoTicketId)
        preview.push({
          ticketId: mapping.pmoTicketId,
          linearIdentifier: mapping.linearIdentifier,
          currentStatus: ticket?.statusName,
          statusCategory: ticket?.statusCategory,
        })
      }

      if (jsonMode) {
        outputSuccessAsJson({
          dryRun: true,
          action: 'sync-all',
          tickets: preview,
        }, createMetadata('linear sync', flags))
        return
      }

      this.log('')
      for (const item of preview) {
        this.log(styles.muted(`  ${item.linearIdentifier} → ${item.currentStatus} (${item.statusCategory})`))
      }
      return
    }

    // Perform the sync for each team
    let totalSynced = 0
    let totalSkipped = 0
    let totalErrors = 0

    for (const teamKey of teamKeys) {
      const teamStates = statesByTeam[teamKey]
      if (!teamStates) {
        totalErrors += mappings.filter((m) => m.linearTeamKey === teamKey).length
        continue
      }

      const teamMappings = mappings.filter((m) => m.linearTeamKey === teamKey)
      // eslint-disable-next-line no-await-in-loop
      const result = await sync.syncAllStatuses(this.storage, teamMappings, teamStates)
      totalSynced += result.synced
      totalSkipped += result.skipped
      totalErrors += result.errors
    }

    if (jsonMode) {
      outputSuccessAsJson({
        action: 'sync-all',
        synced: totalSynced,
        skipped: totalSkipped,
        errors: totalErrors,
      }, createMetadata('linear sync', flags))
      return
    }

    this.log('')
    if (totalSynced > 0) this.log(colors.success(`Synced: ${totalSynced}`))
    if (totalSkipped > 0) this.log(styles.muted(`Skipped: ${totalSkipped}`))
    if (totalErrors > 0) this.log(colors.error(`Errors: ${totalErrors}`))
  }
}

import { Args, Flags } from '@oclif/core'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import { styles } from '../../lib/styles.js'
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'

export default class WorkReview extends PMOCommand {
  static description = 'Spawn agent to review a ticket\'s PR (comment, fix, or both — context-driven)'

  static examples = [
    '<%= config.bin %> work review TKT-001',
    '<%= config.bin %> work review TKT-001 TKT-002',
    '<%= config.bin %> work review  # Interactive picker for reviewable tickets',
  ]

  static strict = false

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID(s) to review - prompts with picker if not provided',
      required: false,
    }),
  }

  static flags = {
    ...pmoBaseFlags,
    json: Flags.boolean({
      char: 'm',
      aliases: ['machine'],
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
  }

  async execute(): Promise<void> {
    const { flags, argv } = await this.parse(WorkReview)
    const projectId = (flags as { project?: string }).project

    const jsonMode = shouldOutputJson(flags)

    const handleError = (code: string, message: string): void => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('work review', flags))
        return
      }
      this.error(message)
    }

    // Collect ticket IDs from argv (supports multiple args)
    let ticketIds: string[] = (argv as string[]).filter(a => !a.startsWith('-'))

    if (ticketIds.length === 0) {
      // No tickets specified - show picker of reviewable tickets (in progress or review with PRs)
      const allTickets = await this.storage.listTickets(projectId)
      const reviewableTickets = allTickets.filter(
        (t) =>
          t.statusCategory === 'started' ||
          t.statusCategory === 'done' ||
          t.statusName?.toLowerCase() === 'in progress' ||
          t.statusName?.toLowerCase() === 'review' ||
          t.metadata?.pr_url
      )

      if (reviewableTickets.length === 0) {
        return handleError(
          'NO_TICKETS',
          'No reviewable tickets found. Tickets need a PR to be reviewed.'
        )
      }

      const selected = await this.selectFromList({
        message: 'Select ticket to review:',
        items: reviewableTickets,
        getName: (t) => `${t.id} - ${t.title} (${t.statusName})`,
        getValue: (t) => t.id,
        getCommand: (t) =>
          `prlt work review ${t.id}${projectId ? ` -P ${projectId}` : ''} --json`,
        jsonMode: jsonMode ? { flags, commandName: 'work review' } : null,
      })

      if (!selected) {
        return
      }
      ticketIds = [selected]
    }

    // Launch work start with review action for each ticket
    for (const ticketId of ticketIds) {
      this.log(styles.info(`\nLaunching review for ${styles.emphasis(ticketId)}...`))

      const workStartArgs = [ticketId, '--action', 'review']
      if (projectId) {
        workStartArgs.push('--project', projectId)
      }
      if (jsonMode) {
        workStartArgs.push('--json')
      }

      // eslint-disable-next-line no-await-in-loop
      await this.config.runCommand('work:start', workStartArgs)
    }
  }
}

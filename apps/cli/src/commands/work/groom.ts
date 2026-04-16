import { Args, Flags } from '@oclif/core'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import { styles } from '../../lib/styles.js'
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'
import { setInternalAction } from '../../services/action-context.js'

export default class WorkGroom extends PMOCommand {
  static description = 'Enrich a ticket with requirements, acceptance criteria, and subtasks'

  static examples = [
    '<%= config.bin %> work groom TKT-001',
    '<%= config.bin %> work groom TKT-001 TKT-002',
    '<%= config.bin %> work groom  # Interactive picker for backlog tickets',
  ]

  static strict = false

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID(s) to groom - prompts with picker if not provided',
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
    const { flags, argv } = await this.parse(WorkGroom)
    const projectId = (flags as { project?: string }).project

    const jsonMode = shouldOutputJson(flags)

    const handleError = (code: string, message: string): void => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('work groom', flags))
        return
      }
      this.error(message)
    }

    // Collect ticket IDs from argv (supports multiple args)
    let ticketIds: string[] = (argv as string[]).filter(a => !a.startsWith('-'))

    if (ticketIds.length === 0) {
      // No tickets specified - show picker of backlog tickets
      const allTickets = await this.storage.listTickets(projectId)
      const backlogTickets = allTickets.filter(
        (t) =>
          t.statusName?.toLowerCase() === 'backlog' ||
          t.statusCategory === 'backlog'
      )

      if (backlogTickets.length === 0) {
        return handleError(
          'NO_TICKETS',
          'No backlog tickets found to groom.'
        )
      }

      const selected = await this.selectFromList({
        message: 'Select ticket to groom:',
        items: backlogTickets,
        getName: (t) => `${t.id} - ${t.title} (${t.statusName})`,
        getValue: (t) => t.id,
        getCommand: (t) =>
          `prlt work groom ${t.id}${projectId ? ` -P ${projectId}` : ''} --json`,
        jsonMode: jsonMode ? { flags, commandName: 'work groom' } : null,
      })

      if (!selected) {
        return
      }
      ticketIds = [selected]
    }

    // Launch work start with groom action for each ticket. The action is
    // passed through the internal action-context channel rather than an
    // `--action` CLI flag (PRLT-1316) so users can't bypass the verb layer.
    for (const ticketId of ticketIds) {
      this.log(styles.info(`\nLaunching groom for ${styles.emphasis(ticketId)}...`))

      const workStartArgs = [ticketId]
      if (projectId) {
        workStartArgs.push('--project', projectId)
      }
      if (jsonMode) {
        workStartArgs.push('--json')
      }

      setInternalAction('groom')
      // eslint-disable-next-line no-await-in-loop
      await this.config.runCommand('work:start', workStartArgs)
    }
  }
}

import { Args, Flags } from '@oclif/core'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import { styles } from '../../lib/styles.js'
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'
import { setInternalAction } from '../../services/action-context.js'

export default class WorkImplement extends PMOCommand {
  static description = 'Spawn agent to implement, continue, revise, or test a ticket (context-driven)'

  static examples = [
    '<%= config.bin %> work implement TKT-001',
    '<%= config.bin %> work implement TKT-001 --message "Focus on the auth module"',
    '<%= config.bin %> work implement  # Interactive picker for todo/in-progress tickets',
  ]

  static strict = false

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID(s) to work on - prompts with picker if not provided',
      required: false,
    }),
  }

  static flags = {
    ...pmoBaseFlags,
    message: Flags.string({
      char: 'M',
      description: 'Additional instructions for the agent',
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Bypass action state guardrails',
      default: false,
    }),
    json: Flags.boolean({
      char: 'm',
      aliases: ['machine'],
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
  }

  async execute(): Promise<void> {
    const { flags, argv } = await this.parse(WorkImplement)
    const projectId = (flags as { project?: string }).project

    const jsonMode = shouldOutputJson(flags)

    const handleError = (code: string, message: string): void => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('work implement', flags))
        return
      }
      this.error(message)
    }

    // Collect ticket IDs from argv (supports multiple args)
    let ticketIds: string[] = (argv as string[]).filter(a => !a.startsWith('-'))

    if (ticketIds.length === 0) {
      // No tickets specified - show picker of todo/in-progress tickets
      const allTickets = await this.storage.listTickets(projectId)
      const workableTickets = allTickets.filter(
        (t) =>
          t.statusCategory === 'backlog' ||
          t.statusCategory === 'unstarted' ||
          t.statusCategory === 'started'
      )

      if (workableTickets.length === 0) {
        return handleError(
          'NO_TICKETS',
          'No tickets ready for implementation. Groom tickets first with "prlt work groom".'
        )
      }

      const selected = await this.selectFromList({
        message: 'Select ticket to implement:',
        items: workableTickets,
        getName: (t) => `${t.id} - ${t.title} (${t.statusName})`,
        getValue: (t) => t.id,
        getCommand: (t) =>
          `prlt work implement ${t.id}${projectId ? ` -P ${projectId}` : ''} --json`,
        jsonMode: jsonMode ? { flags, commandName: 'work implement' } : null,
      })

      if (!selected) {
        return
      }
      ticketIds = [selected]
    }

    // Launch work start with implement action for each ticket. The action is
    // passed through the internal action-context channel rather than an
    // `--action` CLI flag (PRLT-1316) so users can't bypass the verb layer.
    // (Note: 'implement' is also the default, so this is essentially a no-op
    // handoff, but we set it explicitly to make the routing clear.)
    for (const ticketId of ticketIds) {
      this.log(styles.info(`\nLaunching implement for ${styles.emphasis(ticketId)}...`))

      const workStartArgs = [ticketId]
      if (projectId) {
        workStartArgs.push('--project', projectId)
      }
      if (flags.message) {
        workStartArgs.push('--message', flags.message)
      }
      if (flags.force) {
        workStartArgs.push('--force')
      }
      if (jsonMode) {
        workStartArgs.push('--json')
      }

      setInternalAction('implement')
      // eslint-disable-next-line no-await-in-loop
      await this.config.runCommand('work:start', workStartArgs)
    }
  }
}

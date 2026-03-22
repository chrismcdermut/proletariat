import { Args, Flags } from '@oclif/core'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import { styles } from '../../lib/styles.js'
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'

export default class WorkPeek extends PMOCommand {
  static description = 'View what an agent is doing on a ticket (non-interactive)'

  static examples = [
    '<%= config.bin %> work peek TKT-001',
    '<%= config.bin %> work peek TKT-001 --lines 100',
    '<%= config.bin %> work peek TKT-001 --follow',
    '<%= config.bin %> work peek TKT-001 --full',
  ]

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID to peek at',
      required: true,
    }),
  }

  static flags = {
    ...pmoBaseFlags,
    lines: Flags.integer({
      char: 'l',
      description: 'Number of scrollback lines to capture',
      default: 200,
    }),
    full: Flags.boolean({
      description: 'Capture entire scrollback buffer',
      default: false,
    }),
    follow: Flags.boolean({
      char: 'f',
      description: 'Stream output continuously (like tail -f)',
      default: false,
    }),
    since: Flags.string({
      description: 'Filter output to lines after this timestamp (ISO 8601)',
    }),
    json: Flags.boolean({
      char: 'm',
      aliases: ['machine'],
      description: 'Output as JSON',
      default: false,
    }),
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(WorkPeek)

    const jsonMode = shouldOutputJson(flags)

    const handleError = (code: string, message: string): void => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('work peek', flags))
        return
      }
      this.error(message)
    }

    const ticketId = args.ticketId
    if (!ticketId) {
      return handleError('MISSING_TICKET', 'Ticket ID is required.')
    }

    // Delegate to session peek with the ticket ID
    const peekArgs: string[] = [ticketId]

    if (flags.lines !== 200) {
      peekArgs.push('--lines', String(flags.lines))
    }
    if (flags.full) {
      peekArgs.push('--full')
    }
    if (flags.follow) {
      peekArgs.push('--follow')
    }
    if (flags.since) {
      peekArgs.push('--since', flags.since)
    }
    if (jsonMode) {
      peekArgs.push('--json')
    }

    await this.config.runCommand('session:peek', peekArgs)
  }
}

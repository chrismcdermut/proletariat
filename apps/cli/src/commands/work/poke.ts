import { Args, Flags } from '@oclif/core'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'
import { trackPrimitiveExecuted } from '../../lib/telemetry/analytics.js'

export default class WorkPoke extends PMOCommand {
  static description = 'Send a message to steer an agent working on a ticket'

  static aliases = ['work:steer']

  static examples = [
    '<%= config.bin %> work poke TKT-001 "Focus on the tests first"',
    '<%= config.bin %> work poke TKT-001 --file instructions.md',
    '<%= config.bin %> work poke TKT-001 "Run the tests" --wait',
    '<%= config.bin %> work steer TKT-001 "Add error handling"',
  ]

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID of the running agent',
      required: true,
    }),
    message: Args.string({
      description: 'Message to send (use "-" to read from stdin, or omit with --file)',
      required: false,
    }),
  }

  static flags = {
    ...pmoBaseFlags,
    file: Flags.string({
      char: 'F',
      description: 'Read message from a file',
    }),
    wait: Flags.boolean({
      char: 'w',
      description: 'Wait for response after sending',
      default: false,
    }),
    timeout: Flags.integer({
      description: 'Timeout in seconds for --wait mode',
      default: 120,
    }),
    json: Flags.boolean({
      char: 'm',
      aliases: ['machine'],
      description: 'Output as JSON',
      default: false,
    }),
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(WorkPoke)
    const startTime = Date.now()

    const jsonMode = shouldOutputJson(flags)

    const handleError = (code: string, message: string): void => {
      trackPrimitiveExecuted({ primitive: 'poke', durationMs: Date.now() - startTime, success: false, errorType: 'command_error' })
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('work poke', flags))
        return
      }
      this.error(message)
    }

    const ticketId = args.ticketId
    if (!ticketId) {
      return handleError('MISSING_TICKET', 'Ticket ID is required.')
    }

    // Delegate to session poke with the ticket ID
    const pokeArgs: string[] = [ticketId]

    if (args.message) {
      pokeArgs.push(args.message)
    }
    if (flags.file) {
      pokeArgs.push('--file', flags.file)
    }
    if (flags.wait) {
      pokeArgs.push('--wait')
    }
    if (flags.timeout !== 120) {
      pokeArgs.push('--timeout', String(flags.timeout))
    }
    if (jsonMode) {
      pokeArgs.push('--json')
    }

    await this.config.runCommand('session:poke', pokeArgs)
    trackPrimitiveExecuted({ primitive: 'poke', durationMs: Date.now() - startTime, success: true })
  }
}

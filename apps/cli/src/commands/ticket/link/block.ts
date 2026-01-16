import { Args, Flags } from '@oclif/core'
import inquirer from 'inquirer'
import { autoExportToBoard, PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js'
import { styles } from '../../../lib/styles.js'
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputErrorAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../../lib/prompt-json.js'

export default class TicketLinkBlock extends PMOCommand {
  static description = 'Add a blocking dependency (ticket is blocked by another)'

  static examples = [
    '<%= config.bin %> <%= command.id %> TKT-001 TKT-002  # TKT-001 is blocked by TKT-002',
    '<%= config.bin %> <%= command.id %> TKT-001         # Interactive selection',
  ]

  static args = {
    id: Args.string({
      description: 'Ticket ID that will be blocked',
      required: true,
    }),
    blocker: Args.string({
      description: 'Ticket ID that blocks this ticket',
      required: false,
    }),
  }

  static flags = {
    ...pmoBaseFlags,
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
    'no-interactive': Flags.boolean({
      description: 'Alias for --json flag',
      default: false,
    }),
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(TicketLinkBlock)

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags)

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('ticket link block', flags))
        this.exit(1)
      }
      this.error(message)
    }

    const ticket = await this.storage.getTicket(args.id)
    if (!ticket) {
      return handleError('TICKET_NOT_FOUND', `Ticket not found: ${args.id}`)
    }

    let blockerId = args.blocker

    // If no blocker provided, prompt for selection
    if (!blockerId) {
      const allTickets = await this.storage.listTickets()
      const otherTickets = allTickets.filter(t => t.id !== args.id)

      if (otherTickets.length === 0) {
        if (jsonMode) {
          outputErrorAsJson('NO_OTHER_TICKETS', 'No other tickets to create dependency with.', createMetadata('ticket link block', flags))
          return
        }
        this.log(styles.muted('\nNo other tickets to create dependency with.'))
        return
      }

      // In JSON mode, output ticket selection prompt
      if (jsonMode) {
        const ticketChoices = otherTickets.map(t => ({
          name: `${t.id} - ${t.title} (${t.statusName || t.status})`,
          value: t.id,
        }))
        outputPromptAsJson(
          buildPromptConfig('list', 'blocker', `Select ticket that blocks ${args.id}:`, ticketChoices),
          createMetadata('ticket link block', flags)
        )
        return
      }

      const { selected } = await inquirer.prompt([{
        type: 'list',
        name: 'selected',
        message: `Select ticket that blocks ${args.id}:`,
        choices: otherTickets.map(t => ({
          name: `${t.id} - ${t.title} (${t.statusName || t.status})`,
          value: t.id,
        })),
      }])
      blockerId = selected
    }

    const blockerTicket = await this.storage.getTicket(blockerId!)
    if (!blockerTicket) {
      this.error(`Ticket not found: ${blockerId}`)
    }

    try {
      await this.storage.createTicketDependency(args.id, blockerId!, 'blocks')
      await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)))

      this.log(styles.success(`\n✅ ${styles.emphasis(args.id)} is blocked by ${styles.emphasis(blockerId!)}`))
      this.log(styles.muted(`   ${ticket.title}`))
      this.log(styles.muted(`   blocked by: ${blockerTicket.title}`))
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('already exists')) {
          this.error('Dependency already exists')
        }
        if (error.message.includes('self-dependency')) {
          this.error('Cannot create self-dependency')
        }
      }
      throw error
    }
  }
}

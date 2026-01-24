import { Args, Flags } from '@oclif/core'
import { autoExportToBoard, PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js'
import { styles } from '../../../lib/styles.js'
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../../lib/prompt-json.js'

export default class TicketLinkDuplicates extends PMOCommand {
  static description = 'Mark a ticket as duplicate of another'

  static examples = [
    '<%= config.bin %> <%= command.id %> TKT-001 TKT-002  # TKT-001 duplicates TKT-002',
    '<%= config.bin %> <%= command.id %> TKT-001         # Interactive selection',
  ]

  static args = {
    id: Args.string({
      description: 'Duplicate ticket ID',
      required: true,
    }),
    original: Args.string({
      description: 'Original ticket ID',
      required: false,
    }),
  }

  static flags = {
    ...pmoBaseFlags,
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(TicketLinkDuplicates)

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags)

    // Helper to handle errors in JSON mode
    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('ticket link duplicates', flags))
        this.exit(1)
      }
      this.error(message)
    }

    const ticket = await this.storage.getTicket(args.id)
    if (!ticket) {
      return handleError('TICKET_NOT_FOUND', `Ticket not found: ${args.id}`)
    }

    let originalId = args.original

    if (!originalId) {
      const projectId = (flags as { project?: string }).project
      const allTickets = await this.storage.listTickets(projectId)
      const otherTickets = allTickets.filter(t => t.id !== args.id)

      if (otherTickets.length === 0) {
        if (jsonMode) {
          outputErrorAsJson('NO_OTHER_TICKETS', 'No other tickets.', createMetadata('ticket link duplicates', flags))
          return
        }
        this.log(styles.muted('\nNo other tickets.'))
        return
      }

      const selected = await this.selectFromList({
        message: `Select the original ticket (${args.id} is a duplicate of):`,
        items: otherTickets,
        getName: (t) => `${t.id} - ${t.title} (${t.statusName || t.status})`,
        getValue: (t) => t.id,
        getCommand: (t) => `prlt ticket link duplicates ${args.id} ${t.id} --json`,
        jsonMode: jsonMode ? { flags, commandName: 'ticket link duplicates' } : null,
      })

      if (!selected) {
        return
      }
      originalId = selected
    }

    const originalTicket = await this.storage.getTicket(originalId!)
    if (!originalTicket) {
      this.error(`Ticket not found: ${originalId}`)
    }

    try {
      await this.storage.createTicketDependency(args.id, originalId!, 'duplicates')
      await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)))

      this.log(styles.success(`\n✅ ${styles.emphasis(args.id)} duplicates ${styles.emphasis(originalId!)}`))
      this.log(styles.muted(`   ${ticket.title}`))
      this.log(styles.muted(`   duplicates: ${originalTicket.title}`))
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

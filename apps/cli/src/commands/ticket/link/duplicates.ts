import { Args, Flags } from '@oclif/core'
import inquirer from 'inquirer'
import { autoExportToBoard, PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js'
import { styles } from '../../../lib/styles.js'

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
  }

  async execute(): Promise<void> {
    const { args } = await this.parse(TicketLinkDuplicates)

    const ticket = await this.storage.getTicket(args.id)
    if (!ticket) {
      this.error(`Ticket not found: ${args.id}`)
    }

    let originalId = args.original

    if (!originalId) {
      const allTickets = await this.storage.listTickets()
      const otherTickets = allTickets.filter(t => t.id !== args.id)

      if (otherTickets.length === 0) {
        this.log(styles.muted('\nNo other tickets.'))
        return
      }

      const { selected } = await inquirer.prompt([{
        type: 'list',
        name: 'selected',
        message: `Select the original ticket (${args.id} is a duplicate of):`,
        choices: otherTickets.map(t => ({
          name: `${t.id} - ${t.title} (${t.statusName || t.status})`,
          value: t.id,
        })),
      }])
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

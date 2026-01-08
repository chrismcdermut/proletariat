import { Args, Flags } from '@oclif/core'
import inquirer from 'inquirer'
import { autoExportToBoard, PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js'
import { styles } from '../../../lib/styles.js'

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
  }

  async execute(): Promise<void> {
    const { args } = await this.parse(TicketLinkBlock)

    const ticket = await this.storage.getTicket(args.id)
    if (!ticket) {
      this.error(`Ticket not found: ${args.id}`)
    }

    let blockerId = args.blocker

    // If no blocker provided, prompt for selection
    if (!blockerId) {
      const allTickets = await this.storage.listTickets()
      const otherTickets = allTickets.filter(t => t.id !== args.id)

      if (otherTickets.length === 0) {
        this.log(styles.muted('\nNo other tickets to create dependency with.'))
        return
      }

      const { selected } = await inquirer.prompt([{
        type: 'list',
        name: 'selected',
        message: `Select ticket that blocks ${args.id}:`,
        choices: otherTickets.map(t => ({
          name: `${t.id} - ${t.title} (${t.column || t.status})`,
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

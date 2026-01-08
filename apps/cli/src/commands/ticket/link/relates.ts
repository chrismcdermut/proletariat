import { Args, Flags } from '@oclif/core'
import inquirer from 'inquirer'
import { autoExportToBoard, PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js'
import { styles } from '../../../lib/styles.js'

export default class TicketLinkRelates extends PMOCommand {
  static description = 'Add a relates_to dependency (informational link)'

  static examples = [
    '<%= config.bin %> <%= command.id %> TKT-001 TKT-002  # TKT-001 relates to TKT-002',
    '<%= config.bin %> <%= command.id %> TKT-001         # Interactive selection',
  ]

  static args = {
    id: Args.string({
      description: 'Ticket ID',
      required: true,
    }),
    target: Args.string({
      description: 'Related ticket ID',
      required: false,
    }),
  }

  static flags = {
    ...pmoBaseFlags,
  }

  async execute(): Promise<void> {
    const { args } = await this.parse(TicketLinkRelates)

    const ticket = await this.storage.getTicket(args.id)
    if (!ticket) {
      this.error(`Ticket not found: ${args.id}`)
    }

    let targetId = args.target

    if (!targetId) {
      const allTickets = await this.storage.listTickets()
      const otherTickets = allTickets.filter(t => t.id !== args.id)

      if (otherTickets.length === 0) {
        this.log(styles.muted('\nNo other tickets to relate to.'))
        return
      }

      const { selected } = await inquirer.prompt([{
        type: 'list',
        name: 'selected',
        message: `Select ticket that ${args.id} relates to:`,
        choices: otherTickets.map(t => ({
          name: `${t.id} - ${t.title} (${t.column || t.status})`,
          value: t.id,
        })),
      }])
      targetId = selected
    }

    const targetTicket = await this.storage.getTicket(targetId!)
    if (!targetTicket) {
      this.error(`Ticket not found: ${targetId}`)
    }

    try {
      await this.storage.createTicketDependency(args.id, targetId!, 'relates_to')
      await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)))

      this.log(styles.success(`\n✅ ${styles.emphasis(args.id)} relates to ${styles.emphasis(targetId!)}`))
      this.log(styles.muted(`   ${ticket.title}`))
      this.log(styles.muted(`   relates to: ${targetTicket.title}`))
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

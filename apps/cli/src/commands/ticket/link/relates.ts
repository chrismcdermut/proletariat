import { Args, Command, Flags } from '@oclif/core'
import inquirer from 'inquirer'
import { getPMOContext, autoExportToBoard } from '../../../lib/pmo/index.js'
import { styles } from '../../../lib/styles.js'

export default class TicketLinkRelates extends Command {
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
    project: Flags.string({
      char: 'P',
      description: 'Project ID (default: "default")',
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(TicketLinkRelates)

    const { storage, pmoPath } = await getPMOContext(
      flags.project,
      (msg) => this.log(styles.muted(msg)),
      true
    )

    try {
      const ticket = await storage.getTicket(args.id)
      if (!ticket) {
        this.error(`Ticket not found: ${args.id}`)
      }

      let targetId = args.target

      if (!targetId) {
        const allTickets = await storage.listTickets()
        const otherTickets = allTickets.filter(t => t.id !== args.id)

        if (otherTickets.length === 0) {
          this.log(styles.muted('\nNo other tickets to relate to.'))
          await storage.close()
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

      const targetTicket = await storage.getTicket(targetId!)
      if (!targetTicket) {
        this.error(`Ticket not found: ${targetId}`)
      }

      await storage.createTicketDependency(args.id, targetId!, 'relates_to')
      await autoExportToBoard(pmoPath, storage, (msg) => this.log(styles.muted(msg)))

      this.log(styles.success(`\n✅ ${styles.emphasis(args.id)} relates to ${styles.emphasis(targetId!)}`))
      this.log(styles.muted(`   ${ticket.title}`))
      this.log(styles.muted(`   relates to: ${targetTicket.title}`))

      await storage.close()
    } catch (error) {
      await storage.close()
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

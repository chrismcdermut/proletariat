import { Args, Command, Flags } from '@oclif/core'
import inquirer from 'inquirer'
import { getPMOContext, autoExportToBoard } from '../../../lib/pmo/index.js'
import { styles } from '../../../lib/styles.js'

export default class TicketLinkDuplicates extends Command {
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
    project: Flags.string({
      char: 'P',
      description: 'Project ID (default: "default")',
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(TicketLinkDuplicates)

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

      let originalId = args.original

      if (!originalId) {
        const allTickets = await storage.listTickets()
        const otherTickets = allTickets.filter(t => t.id !== args.id)

        if (otherTickets.length === 0) {
          this.log(styles.muted('\nNo other tickets.'))
          await storage.close()
          return
        }

        const { selected } = await inquirer.prompt([{
          type: 'list',
          name: 'selected',
          message: `Select the original ticket (${args.id} is a duplicate of):`,
          choices: otherTickets.map(t => ({
            name: `${t.id} - ${t.title} (${t.column || t.status})`,
            value: t.id,
          })),
        }])
        originalId = selected
      }

      const originalTicket = await storage.getTicket(originalId!)
      if (!originalTicket) {
        this.error(`Ticket not found: ${originalId}`)
      }

      await storage.createTicketDependency(args.id, originalId!, 'duplicates')
      await autoExportToBoard(pmoPath, storage, (msg) => this.log(styles.muted(msg)))

      this.log(styles.success(`\n✅ ${styles.emphasis(args.id)} duplicates ${styles.emphasis(originalId!)}`))
      this.log(styles.muted(`   ${ticket.title}`))
      this.log(styles.muted(`   duplicates: ${originalTicket.title}`))

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

import { Args, Command, Flags } from '@oclif/core'
import inquirer from 'inquirer'
import { getPMOContext, autoExportToBoard } from '../../../lib/pmo/index.js'
import { styles } from '../../../lib/styles.js'
import { TicketDependencyType } from '../../../lib/pmo/types.js'

export default class TicketDependAdd extends Command {
  static description = 'Add a dependency to a ticket'

  static examples = [
    '<%= config.bin %> <%= command.id %> TKT-001 TKT-002',
    '<%= config.bin %> <%= command.id %> TKT-001 TKT-002 --type blocks',
    '<%= config.bin %> <%= command.id %> TKT-001 TKT-002 --type relates_to',
    '<%= config.bin %> <%= command.id %> TKT-001 --blocks TKT-002',
  ]

  static args = {
    id: Args.string({
      description: 'Ticket ID that will have the dependency',
      required: true,
    }),
    'depends-on': Args.string({
      description: 'Ticket ID that this ticket depends on',
      required: false,
    }),
  }

  static flags = {
    project: Flags.string({
      char: 'P',
      description: 'Project ID (default: "default")',
    }),
    type: Flags.string({
      char: 't',
      description: 'Dependency type',
      options: ['blocks', 'relates_to', 'duplicates'],
      default: 'blocks',
    }),
    blocks: Flags.string({
      char: 'b',
      description: 'Shorthand: ticket ID that blocks this ticket',
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(TicketDependAdd)

    const { storage, pmoPath } = await getPMOContext(
      flags.project,
      (msg) => this.log(styles.muted(msg)),
      true
    )

    try {
      const ticketId = args.id
      let dependsOnId = args['depends-on'] || flags.blocks

      // Validate source ticket exists
      const ticket = await storage.getTicket(ticketId)
      if (!ticket) {
        this.error(`Ticket not found: ${ticketId}`)
      }

      // If no target provided, prompt for selection
      if (!dependsOnId) {
        const allTickets = await storage.listTickets()
        const otherTickets = allTickets.filter(t => t.id !== ticketId)

        if (otherTickets.length === 0) {
          this.log(styles.muted('\nNo other tickets to create dependency with.'))
          await storage.close()
          return
        }

        const { selected } = await inquirer.prompt([{
          type: 'list',
          name: 'selected',
          message: `Select ticket that ${ticketId} depends on:`,
          choices: otherTickets.map(t => ({
            name: `${t.id} - ${t.title} (${t.column || t.status})`,
            value: t.id,
          })),
        }])
        dependsOnId = selected
      }

      // Validate target ticket exists
      const dependsOnTicket = await storage.getTicket(dependsOnId!)
      if (!dependsOnTicket) {
        this.error(`Ticket not found: ${dependsOnId}`)
      }

      // Create the dependency
      const dependencyType = (flags.blocks ? 'blocks' : flags.type) as TicketDependencyType

      await storage.createTicketDependency(ticketId, dependsOnId!, dependencyType)

      await autoExportToBoard(pmoPath, storage, (msg) => this.log(styles.muted(msg)))
      await storage.close()

      const typeLabel = dependencyType === 'blocks' ? 'is blocked by' :
                        dependencyType === 'relates_to' ? 'relates to' :
                        'duplicates'

      this.log(styles.success(`\n✅ ${styles.emphasis(ticketId)} ${typeLabel} ${styles.emphasis(dependsOnId!)}`))
      this.log(styles.muted(`   ${ticket.title}`))
      this.log(styles.muted(`   ${typeLabel} ${dependsOnTicket.title}`))

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

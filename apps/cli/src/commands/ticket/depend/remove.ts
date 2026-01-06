import { Args, Command, Flags } from '@oclif/core'
import inquirer from 'inquirer'
import { getPMOContext, autoExportToBoard } from '../../../lib/pmo/index.js'
import { styles } from '../../../lib/styles.js'
import { TicketDependencyType } from '../../../lib/pmo/types.js'

export default class TicketDependRemove extends Command {
  static description = 'Remove a dependency from a ticket'

  static examples = [
    '<%= config.bin %> <%= command.id %> TKT-001 TKT-002',
    '<%= config.bin %> <%= command.id %> TKT-001 TKT-002 --type blocks',
    '<%= config.bin %> <%= command.id %> TKT-001 --all',
  ]

  static args = {
    id: Args.string({
      description: 'Ticket ID',
      required: true,
    }),
    'depends-on': Args.string({
      description: 'Ticket ID to remove dependency from',
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
      description: 'Dependency type to remove (removes all types if not specified)',
      options: ['blocks', 'relates_to', 'duplicates'],
    }),
    all: Flags.boolean({
      char: 'a',
      description: 'Remove all dependencies for this ticket',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(TicketDependRemove)

    const { storage, pmoPath } = await getPMOContext(
      flags.project,
      (msg) => this.log(styles.muted(msg)),
      true
    )

    try {
      const ticketId = args.id

      // Validate ticket exists
      const ticket = await storage.getTicket(ticketId)
      if (!ticket) {
        this.error(`Ticket not found: ${ticketId}`)
      }

      // Get existing dependencies
      const dependencies = await storage.listTicketDependencies(ticketId)

      if (dependencies.length === 0) {
        this.log(styles.muted(`\nTicket ${ticketId} has no dependencies.`))
        await storage.close()
        return
      }

      // If --all flag, remove all dependencies
      if (flags.all) {
        const { confirmed } = await inquirer.prompt([{
          type: 'confirm',
          name: 'confirmed',
          message: `Remove all ${dependencies.length} dependencies from ${ticketId}?`,
          default: false,
        }])

        if (!confirmed) {
          this.log(styles.muted('\nCancelled.'))
          await storage.close()
          return
        }

        for (const dep of dependencies) {
          await storage.deleteTicketDependency(ticketId, dep.dependsOnTicketId, dep.dependencyType)
        }

        await autoExportToBoard(pmoPath, storage, (msg) => this.log(styles.muted(msg)))
        await storage.close()

        this.log(styles.success(`\n✅ Removed ${dependencies.length} dependencies from ${ticketId}`))
        return
      }

      let dependsOnId = args['depends-on']

      // If no target provided, prompt for selection
      if (!dependsOnId) {
        const choices = await Promise.all(dependencies.map(async (dep) => {
          const depTicket = await storage.getTicket(dep.dependsOnTicketId)
          return {
            name: `${dep.dependsOnTicketId} - ${depTicket?.title || 'Unknown'} (${dep.dependencyType})`,
            value: dep.dependsOnTicketId,
          }
        }))

        const { selected } = await inquirer.prompt([{
          type: 'list',
          name: 'selected',
          message: 'Select dependency to remove:',
          choices,
        }])
        dependsOnId = selected
      }

      // Find the dependency
      const dep = dependencies.find(d => d.dependsOnTicketId === dependsOnId)
      if (!dep) {
        this.error(`No dependency found from ${ticketId} to ${dependsOnId}`)
      }

      // Remove specific dependency
      const dependencyType = flags.type as TicketDependencyType | undefined
      await storage.deleteTicketDependency(ticketId, dependsOnId!, dependencyType)

      await autoExportToBoard(pmoPath, storage, (msg) => this.log(styles.muted(msg)))
      await storage.close()

      const depTicket = await storage.getTicket(dependsOnId!)
      this.log(styles.success(`\n✅ Removed dependency: ${ticketId} → ${dependsOnId}`))
      if (depTicket) {
        this.log(styles.muted(`   ${ticket.title} no longer depends on ${depTicket.title}`))
      }

    } catch (error) {
      await storage.close()
      throw error
    }
  }
}

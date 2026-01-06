import { Args, Command, Flags } from '@oclif/core'
import inquirer from 'inquirer'
import { getPMOContext, autoExportToBoard } from '../../../lib/pmo/index.js'
import { styles } from '../../../lib/styles.js'
import { TicketDependencyType } from '../../../lib/pmo/types.js'

export default class TicketLinkRemove extends Command {
  static description = 'Remove a dependency from a ticket'

  static examples = [
    '<%= config.bin %> <%= command.id %> TKT-001 TKT-002',
    '<%= config.bin %> <%= command.id %> TKT-001 TKT-002 --type blocks',
    '<%= config.bin %> <%= command.id %> TKT-001 --all',
    '<%= config.bin %> <%= command.id %> TKT-001         # Interactive selection',
  ]

  static args = {
    id: Args.string({
      description: 'Ticket ID',
      required: true,
    }),
    target: Args.string({
      description: 'Target ticket ID to unlink',
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
      description: 'Dependency type to remove',
      options: ['blocks', 'relates_to', 'duplicates'],
    }),
    all: Flags.boolean({
      char: 'a',
      description: 'Remove all dependencies for this ticket',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(TicketLinkRemove)

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

      const dependencies = await storage.listTicketDependencies(args.id)

      if (dependencies.length === 0) {
        this.log(styles.muted(`\nTicket ${args.id} has no dependencies.`))
        await storage.close()
        return
      }

      // If --all flag, remove all dependencies
      if (flags.all) {
        const { confirmed } = await inquirer.prompt([{
          type: 'confirm',
          name: 'confirmed',
          message: `Remove all ${dependencies.length} dependencies from ${args.id}?`,
          default: false,
        }])

        if (!confirmed) {
          this.log(styles.muted('\nCancelled.'))
          await storage.close()
          return
        }

        for (const dep of dependencies) {
          await storage.deleteTicketDependency(args.id, dep.dependsOnTicketId, dep.dependencyType)
        }

        await autoExportToBoard(pmoPath, storage, (msg) => this.log(styles.muted(msg)))
        await storage.close()

        this.log(styles.success(`\n✅ Removed ${dependencies.length} dependencies from ${args.id}`))
        return
      }

      let targetId = args.target

      // If no target provided, prompt for selection
      if (!targetId) {
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
        targetId = selected
      }

      // Find the dependency
      const dep = dependencies.find(d => d.dependsOnTicketId === targetId)
      if (!dep) {
        this.error(`No dependency found from ${args.id} to ${targetId}`)
      }

      const dependencyType = flags.type as TicketDependencyType | undefined
      await storage.deleteTicketDependency(args.id, targetId!, dependencyType)

      await autoExportToBoard(pmoPath, storage, (msg) => this.log(styles.muted(msg)))

      const depTicket = await storage.getTicket(targetId!)
      this.log(styles.success(`\n✅ Removed dependency: ${args.id} → ${targetId}`))
      if (depTicket) {
        this.log(styles.muted(`   ${ticket.title} no longer linked to ${depTicket.title}`))
      }

      await storage.close()
    } catch (error) {
      await storage.close()
      throw error
    }
  }
}

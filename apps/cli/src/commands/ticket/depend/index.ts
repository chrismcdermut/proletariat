import { Args, Command, Flags } from '@oclif/core'
import { getPMOContext } from '../../../lib/pmo/index.js'
import { styles } from '../../../lib/styles.js'

export default class TicketDepend extends Command {
  static description = 'List dependencies for a ticket'

  static examples = [
    '<%= config.bin %> <%= command.id %> TKT-001',
    '<%= config.bin %> <%= command.id %> TKT-001 --all',
  ]

  static args = {
    id: Args.string({
      description: 'Ticket ID',
      required: true,
    }),
  }

  static flags = {
    project: Flags.string({
      char: 'P',
      description: 'Project ID (default: "default")',
    }),
    all: Flags.boolean({
      char: 'a',
      description: 'Show all dependencies (blockers and blocked-by)',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(TicketDepend)

    const { storage } = await getPMOContext(
      flags.project,
      (msg) => this.log(styles.muted(msg)),
      true
    )

    try {
      const ticket = await storage.getTicket(args.id)
      if (!ticket) {
        this.error(`Ticket not found: ${args.id}`)
      }

      // Get dependencies this ticket has (things it's blocked by)
      const dependencies = await storage.listTicketDependencies(args.id)
      const blockers = await storage.getTicketBlockers(args.id)
      const isBlocked = await storage.isTicketBlocked(args.id)

      this.log(`\n${styles.emphasis(ticket.id)}: ${ticket.title}`)

      if (isBlocked) {
        this.log(styles.warning('  Status: BLOCKED'))
      }

      if (blockers.length > 0) {
        this.log(styles.muted('\n  Blocked by:'))
        for (const blocker of blockers) {
          const status = blocker.status === 'done' ? styles.success('done') : styles.warning(blocker.status)
          this.log(`    - ${blocker.id}: ${blocker.title} (${status})`)
        }
      }

      // Show other dependency types
      const otherDeps = dependencies.filter(d => d.dependencyType !== 'blocks')
      if (otherDeps.length > 0) {
        this.log(styles.muted('\n  Related:'))
        for (const dep of otherDeps) {
          const relatedTicket = await storage.getTicket(dep.dependsOnTicketId)
          if (relatedTicket) {
            this.log(`    - ${dep.dependencyType}: ${relatedTicket.id} - ${relatedTicket.title}`)
          }
        }
      }

      // Optionally show tickets blocked BY this ticket
      if (flags.all) {
        const blockedBy = await storage.getTicketsBlockedBy(args.id)
        if (blockedBy.length > 0) {
          this.log(styles.muted('\n  Blocking:'))
          for (const blocked of blockedBy) {
            this.log(`    - ${blocked.id}: ${blocked.title} (${blocked.status})`)
          }
        }
      }

      if (dependencies.length === 0 && blockers.length === 0) {
        this.log(styles.muted('\n  No dependencies.'))
      }

      this.log('')
      await storage.close()
    } catch (error) {
      await storage.close()
      throw error
    }
  }
}

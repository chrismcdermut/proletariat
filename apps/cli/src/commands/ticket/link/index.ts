import { Args, Command, Flags } from '@oclif/core'
import inquirer from 'inquirer'
import { getPMOContext, autoExportToBoard } from '../../../lib/pmo/index.js'
import { styles } from '../../../lib/styles.js'
import { TicketDependencyType } from '../../../lib/pmo/types.js'

export default class TicketLink extends Command {
  static description = 'Manage ticket dependencies (links)'

  static examples = [
    '<%= config.bin %> <%= command.id %> TKT-001                    # List dependencies',
    '<%= config.bin %> <%= command.id %> TKT-001 --blocks TKT-002   # TKT-001 is blocked by TKT-002',
    '<%= config.bin %> <%= command.id %> TKT-001 --relates TKT-002  # TKT-001 relates to TKT-002',
    '<%= config.bin %> <%= command.id %> TKT-001 --duplicates TKT-002',
    '<%= config.bin %> <%= command.id %> TKT-001 --all              # Show all (blockers + blocking)',
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
    blocks: Flags.string({
      char: 'b',
      description: 'Add blocking dependency: this ticket is blocked by TARGET',
    }),
    relates: Flags.string({
      char: 'r',
      description: 'Add relates_to dependency: this ticket relates to TARGET',
    }),
    duplicates: Flags.string({
      char: 'd',
      description: 'Add duplicates dependency: this ticket duplicates TARGET',
    }),
    all: Flags.boolean({
      char: 'a',
      description: 'Show all dependencies (blockers and tickets blocked by this)',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(TicketLink)

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

      // If a dependency flag is provided, add the dependency
      if (flags.blocks || flags.relates || flags.duplicates) {
        const targetId = flags.blocks || flags.relates || flags.duplicates
        const dependencyType: TicketDependencyType = flags.blocks ? 'blocks' :
                                                      flags.relates ? 'relates_to' : 'duplicates'

        const targetTicket = await storage.getTicket(targetId!)
        if (!targetTicket) {
          this.error(`Ticket not found: ${targetId}`)
        }

        try {
          await storage.createTicketDependency(args.id, targetId!, dependencyType)
          await autoExportToBoard(pmoPath, storage, (msg) => this.log(styles.muted(msg)))

          const typeLabel = dependencyType === 'blocks' ? 'is blocked by' :
                            dependencyType === 'relates_to' ? 'relates to' : 'duplicates'

          this.log(styles.success(`\n✅ ${styles.emphasis(args.id)} ${typeLabel} ${styles.emphasis(targetId!)}`))
          this.log(styles.muted(`   ${ticket.title}`))
          this.log(styles.muted(`   ${typeLabel} ${targetTicket.title}`))
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

        await storage.close()
        return
      }

      // Otherwise, list dependencies
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

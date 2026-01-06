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
      required: false,
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
      let ticketId = args.id
      if (!ticketId) {
        const tickets = await storage.listTickets()
        if (tickets.length === 0) {
          this.log(styles.muted('\nNo tickets found.'))
          await storage.close()
          return
        }
        const { selected } = await inquirer.prompt([{
          type: 'list',
          name: 'selected',
          message: 'Select ticket to manage dependencies:',
          choices: tickets.map(t => ({ name: `${t.id} - ${t.title}`, value: t.id })),
        }])
        ticketId = selected
      }

      const ticket = await storage.getTicket(ticketId!)
      if (!ticket) {
        this.error(`Ticket not found: ${ticketId}`)
      }

      // If a dependency flag is provided, add the dependency directly
      if (flags.blocks || flags.relates || flags.duplicates) {
        const targetId = flags.blocks || flags.relates || flags.duplicates
        const dependencyType: TicketDependencyType = flags.blocks ? 'blocks' :
                                                      flags.relates ? 'relates_to' : 'duplicates'
        await this.addDependency(storage, pmoPath, ticketId!, targetId!, dependencyType, ticket.title)
        await storage.close()
        return
      }

      // Interactive mode: show menu in a loop
      let continueLoop = true
      while (continueLoop) {
        const allTickets = await storage.listTickets()
        const otherTickets = allTickets.filter(t => t.id !== ticketId)

        const { action } = await inquirer.prompt([{
          type: 'list',
          name: 'action',
          message: `Dependencies for ${ticket.id}:`,
          choices: [
            { name: 'View dependencies', value: 'view' },
            { name: 'Add blocking dependency (blocked by...)', value: 'blocks' },
            { name: 'Add relates_to dependency', value: 'relates_to' },
            { name: 'Add duplicates dependency', value: 'duplicates' },
            new inquirer.Separator(),
            { name: 'Remove dependency', value: 'remove' },
            { name: 'Done', value: 'done' },
          ],
        }])

        if (action === 'done') {
          continueLoop = false
          continue
        }

        if (action === 'view') {
          await this.viewDependencies(storage, ticketId!, ticket, flags.all)
          continue
        }

        if (action === 'remove') {
          const dependencies = await storage.listTicketDependencies(ticketId!)
          if (dependencies.length === 0) {
            this.log(styles.muted('\nNo dependencies to remove.'))
            continue
          }
          const choices = await Promise.all(dependencies.map(async dep => {
            const depTicket = await storage.getTicket(dep.dependsOnTicketId)
            return {
              name: `${dep.dependsOnTicketId} - ${depTicket?.title || 'Unknown'} (${dep.dependencyType})`,
              value: { targetId: dep.dependsOnTicketId, type: dep.dependencyType }
            }
          }))
          const { selected } = await inquirer.prompt([{
            type: 'list',
            name: 'selected',
            message: 'Select dependency to remove:',
            choices,
          }])
          await storage.deleteTicketDependency(ticketId!, selected.targetId, selected.type)
          await autoExportToBoard(pmoPath, storage, (msg) => this.log(styles.muted(msg)))
          this.log(styles.success(`\n✅ Removed dependency: ${ticketId} → ${selected.targetId}`))
          continue
        }

        // Add dependency
        if (otherTickets.length === 0) {
          this.log(styles.muted('\nNo other tickets to link to.'))
          continue
        }
        const { targetId } = await inquirer.prompt([{
          type: 'list',
          name: 'targetId',
          message: `Select ticket that ${ticketId} ${action === 'blocks' ? 'is blocked by' : action === 'relates_to' ? 'relates to' : 'duplicates'}:`,
          choices: otherTickets.map(t => ({ name: `${t.id} - ${t.title}`, value: t.id })),
        }])
        await this.addDependency(storage, pmoPath, ticketId!, targetId, action as TicketDependencyType, ticket.title)
      }

      await storage.close()
    } catch (error) {
      await storage.close()
      throw error
    }
  }

  private async addDependency(
    storage: Awaited<ReturnType<typeof getPMOContext>>['storage'],
    pmoPath: string,
    ticketId: string,
    targetId: string,
    dependencyType: TicketDependencyType,
    ticketTitle: string
  ): Promise<void> {
    const targetTicket = await storage.getTicket(targetId)
    if (!targetTicket) {
      this.error(`Ticket not found: ${targetId}`)
    }

    try {
      await storage.createTicketDependency(ticketId, targetId, dependencyType)
      await autoExportToBoard(pmoPath, storage, (msg) => this.log(styles.muted(msg)))

      const typeLabel = dependencyType === 'blocks' ? 'is blocked by' :
                        dependencyType === 'relates_to' ? 'relates to' : 'duplicates'

      this.log(styles.success(`\n✅ ${styles.emphasis(ticketId)} ${typeLabel} ${styles.emphasis(targetId)}`))
      this.log(styles.muted(`   ${ticketTitle}`))
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
  }

  private async viewDependencies(
    storage: Awaited<ReturnType<typeof getPMOContext>>['storage'],
    ticketId: string,
    ticket: { id: string; title: string },
    showAll: boolean
  ): Promise<void> {
    const dependencies = await storage.listTicketDependencies(ticketId)
    const blockers = await storage.getTicketBlockers(ticketId)
    const isBlocked = await storage.isTicketBlocked(ticketId)

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

    if (showAll) {
      const blockedBy = await storage.getTicketsBlockedBy(ticketId)
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
  }
}

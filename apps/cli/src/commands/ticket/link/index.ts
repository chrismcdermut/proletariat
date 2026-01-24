import { Args, Flags } from '@oclif/core'
import { autoExportToBoard, PMOCommand, pmoBaseFlags } from '../../../lib/pmo/index.js'
import { styles } from '../../../lib/styles.js'
import { TicketDependencyType } from '../../../lib/pmo/types.js'
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../../lib/prompt-json.js'

export default class TicketLink extends PMOCommand {
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
    ...pmoBaseFlags,
    json: Flags.boolean({
      description: 'Output prompt configuration as JSON (for AI agents/scripts)',
      default: false,
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

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(TicketLink)

    // Check if JSON output mode is active
    const jsonMode = shouldOutputJson(flags)

    const projectId = (flags as { project?: string }).project
    let ticketId = args.id
    if (!ticketId) {
      const tickets = await this.storage.listTickets(projectId)
      if (tickets.length === 0) {
        if (jsonMode) {
          outputErrorAsJson('NO_TICKETS', 'No tickets found.', createMetadata('ticket link', flags))
          return
        }
        this.log(styles.muted('\nNo tickets found.'))
        return
      }

      const selected = await this.selectFromList({
        message: 'Select ticket to manage dependencies:',
        items: tickets,
        getName: (t) => `${t.id} - ${t.title}`,
        getValue: (t) => t.id,
        getCommand: (t) => `prlt ticket link ${t.id} --json`,
        jsonMode: jsonMode ? { flags, commandName: 'ticket link' } : null,
      })

      if (!selected) {
        return
      }
      ticketId = selected
    }

    const ticket = await this.storage.getTicket(ticketId!)
    if (!ticket) {
      this.error(`Ticket not found: ${ticketId}`)
    }

    // If a dependency flag is provided, add the dependency directly
    if (flags.blocks || flags.relates || flags.duplicates) {
      const targetId = flags.blocks || flags.relates || flags.duplicates
      const dependencyType: TicketDependencyType = flags.blocks ? 'blocks' :
                                                    flags.relates ? 'relates_to' : 'duplicates'
      await this.addDependency(this.storage, this.pmoPath, ticketId!, targetId!, dependencyType, ticket.title)
      return
    }

    // Interactive mode: show menu in a loop - user interaction requires sequential processing
    let continueLoop = true
    while (continueLoop) {
      // eslint-disable-next-line no-await-in-loop
      const allTickets = await this.storage.listTickets(projectId)
      const otherTickets = allTickets.filter(t => t.id !== ticketId)

      const menuChoices = [
        { id: 'view', name: 'View dependencies' },
        { id: 'blocks', name: 'Add blocking dependency (blocked by...)' },
        { id: 'relates_to', name: 'Add relates_to dependency' },
        { id: 'duplicates', name: 'Add duplicates dependency' },
        { id: 'remove', name: 'Remove dependency' },
        { id: 'done', name: 'Done' },
      ]

      // eslint-disable-next-line no-await-in-loop
      const action = await this.selectFromList({
        message: `Dependencies for ${ticket.id}:`,
        items: menuChoices,
        getName: (c) => c.name,
        getValue: (c) => c.id,
        getCommand: (c) => {
          switch (c.id) {
            case 'view': return `prlt ticket link ${ticketId} --all`
            case 'blocks': return `prlt ticket link block ${ticketId} --json`
            case 'relates_to': return `prlt ticket link relates ${ticketId} --json`
            case 'duplicates': return `prlt ticket link duplicates ${ticketId} --json`
            case 'remove': return `prlt ticket link remove ${ticketId} --json`
            default: return ''
          }
        },
        jsonMode: jsonMode ? { flags, commandName: 'ticket link' } : null,
      })

      if (action === 'done' || !action) {
        continueLoop = false
        continue
      }

      if (action === 'view') {
        // eslint-disable-next-line no-await-in-loop
        await this.viewDependencies(this.storage, ticketId!, ticket, flags.all)
        continue
      }

      if (action === 'remove') {
        // eslint-disable-next-line no-await-in-loop
        const dependencies = await this.storage.listTicketDependencies(ticketId!)
        if (dependencies.length === 0) {
          this.log(styles.muted('\nNo dependencies to remove.'))
          continue
        }
        // eslint-disable-next-line no-await-in-loop
      const depChoices = await Promise.all(dependencies.map(async dep => {
          const depTicket = await this.storage.getTicket(dep.dependsOnTicketId)
          return {
            id: dep.dependsOnTicketId,
            name: `${dep.dependsOnTicketId} - ${depTicket?.title || 'Unknown'} (${dep.dependencyType})`,
            type: dep.dependencyType
          }
        }))

        // eslint-disable-next-line no-await-in-loop
        const selected = await this.selectFromList({
          message: 'Select dependency to remove:',
          items: depChoices,
          getName: (d) => d.name,
          getValue: (d) => d.id,
          getCommand: (d) => `prlt ticket link remove ${ticketId} ${d.id} --type ${d.type} --json`,
          jsonMode: jsonMode ? { flags, commandName: 'ticket link' } : null,
        })

        if (!selected) {
          continue
        }

        const selectedDep = depChoices.find(d => d.id === selected)
        if (selectedDep) {
          // eslint-disable-next-line no-await-in-loop
          await this.storage.deleteTicketDependency(ticketId!, selected, selectedDep.type as TicketDependencyType)
          // eslint-disable-next-line no-await-in-loop
          await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)))
          this.log(styles.success(`\n✅ Removed dependency: ${ticketId} → ${selected}`))
        }
        continue
      }

      // Add dependency
      if (otherTickets.length === 0) {
        this.log(styles.muted('\nNo other tickets to link to.'))
        continue
      }

      // eslint-disable-next-line no-await-in-loop
      const targetId = await this.selectFromList({
        message: `Select ticket that ${ticketId} ${action === 'blocks' ? 'is blocked by' : action === 'relates_to' ? 'relates to' : 'duplicates'}:`,
        items: otherTickets,
        getName: (t) => `${t.id} - ${t.title}`,
        getValue: (t) => t.id,
        getCommand: (t) => `prlt ticket link ${action === 'blocks' ? 'block' : action} ${ticketId} ${t.id} --json`,
        jsonMode: jsonMode ? { flags, commandName: 'ticket link' } : null,
      })

      if (targetId) {
        // eslint-disable-next-line no-await-in-loop
        await this.addDependency(this.storage, this.pmoPath, ticketId!, targetId, action as TicketDependencyType, ticket.title)
      }
    }
  }

  private async addDependency(
    storage: typeof this.storage,
    pmoPath: string,
    ticketId: string,
    targetId: string,
    dependencyType: TicketDependencyType,
    ticketTitle: string
  ): Promise<void> {
    const targetTicket = await this.storage.getTicket(targetId)
    if (!targetTicket) {
      this.error(`Ticket not found: ${targetId}`)
    }

    try {
      await this.storage.createTicketDependency(ticketId, targetId, dependencyType)
      await autoExportToBoard(this.pmoPath, this.storage, (msg) => this.log(styles.muted(msg)))

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
    storage: typeof this.storage,
    ticketId: string,
    ticket: { id: string; title: string },
    showAll: boolean
  ): Promise<void> {
    const dependencies = await this.storage.listTicketDependencies(ticketId)
    const blockers = await this.storage.getTicketBlockers(ticketId)
    const isBlocked = await this.storage.isTicketBlocked(ticketId)

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
      // Fetch all related tickets in parallel
      const relatedTickets = await Promise.all(
        otherDeps.map(async dep => ({
          dep,
          ticket: await this.storage.getTicket(dep.dependsOnTicketId)
        }))
      )
      for (const { dep, ticket: relatedTicket } of relatedTickets) {
        if (relatedTicket) {
          this.log(`    - ${dep.dependencyType}: ${relatedTicket.id} - ${relatedTicket.title}`)
        }
      }
    }

    if (showAll) {
      const blockedBy = await this.storage.getTicketsBlockedBy(ticketId)
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

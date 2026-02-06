import { Args, Flags } from '@oclif/core'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import { styles } from '../../lib/styles.js'
import {
  shouldOutputJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'

type EntityType = 'ticket' | 'spec' | 'epic'

/**
 * Infer entity type from ID prefix
 */
function inferEntityType(id: string): EntityType | null {
  const upper = id.toUpperCase()
  if (upper.startsWith('TKT-')) return 'ticket'
  if (upper.startsWith('SPEC-')) return 'spec'
  if (upper.startsWith('EPIC-')) return 'epic'
  return null
}

export default class LinkList extends PMOCommand {
  static description = 'List all links (dependencies) for an entity'

  static examples = [
    '<%= config.bin %> <%= command.id %> TKT-001       # List ticket links',
    '<%= config.bin %> <%= command.id %> SPEC-001      # List spec links',
    '<%= config.bin %> <%= command.id %> EPIC-001      # List epic links',
    '<%= config.bin %> <%= command.id %> TKT-001 --all # Include reverse links',
  ]

  static args = {
    id: Args.string({
      description: 'Entity ID (TKT-xxx, SPEC-xxx, or EPIC-xxx)',
      required: true,
    }),
  }

  static flags = {
    ...pmoBaseFlags,
    all: Flags.boolean({
      char: 'a',
      description: 'Show all links including reverse dependencies (what blocks this, what this blocks)',
      default: false,
    }),
    json: Flags.boolean({
      char: 'm',
      aliases: ['machine'],
      description: 'Output as JSON for AI agents/scripts',
      default: false,
    }),
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(LinkList)

    const jsonMode = shouldOutputJson(flags)

    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('link list', flags))
        this.exit(1)
      }
      this.error(message)
    }

    const entityType = inferEntityType(args.id)

    if (!entityType) {
      return handleError('INVALID_ID', `Cannot infer entity type from "${args.id}". Use TKT-, SPEC-, or EPIC- prefix.`)
    }

    if (entityType === 'ticket') {
      await this.listTicketLinks(args.id, flags.all)
    } else if (entityType === 'spec') {
      await this.listSpecLinks(args.id, flags.all)
    } else if (entityType === 'epic') {
      await this.listEpicLinks(args.id, flags.all)
    }
  }

  private async listTicketLinks(ticketId: string, showAll: boolean): Promise<void> {
    const ticket = await this.storage.getTicket(ticketId)
    if (!ticket) {
      this.error(`Ticket not found: ${ticketId}`)
    }

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
      this.log(styles.muted('\n  No links.'))
    }

    this.log('')
  }

  private async listSpecLinks(specId: string, showAll: boolean): Promise<void> {
    const spec = await this.storage.getSpec(specId)
    if (!spec) {
      this.error(`Spec not found: ${specId}`)
    }

    const dependencies = await this.storage.listSpecDependencies(specId)

    this.log(`\n${styles.emphasis(spec.id)}: ${spec.title}`)

    if (dependencies.length === 0) {
      this.log(styles.muted('\n  No links.'))
      this.log('')
      return
    }

    // Group by type
    const byType: Record<string, typeof dependencies> = {}
    for (const dep of dependencies) {
      if (!byType[dep.dependencyType]) byType[dep.dependencyType] = []
      byType[dep.dependencyType].push(dep)
    }

    for (const [depType, deps] of Object.entries(byType)) {
      this.log(styles.muted(`\n  ${depType}:`))
      for (const dep of deps) {
        const targetSpec = await this.storage.getSpec(dep.dependsOnSpecId)
        if (targetSpec) {
          this.log(`    - ${targetSpec.id}: ${targetSpec.title}`)
        }
      }
    }

    this.log('')
  }

  private async listEpicLinks(epicId: string, showAll: boolean): Promise<void> {
    const epic = await this.storage.getEpic(epicId)
    if (!epic) {
      this.error(`Epic not found: ${epicId}`)
    }

    const dependencies = await this.storage.listEpicDependencies(epicId)

    this.log(`\n${styles.emphasis(epic.id)}: ${epic.title}`)

    // Show blocking dependencies
    const blockingDeps = dependencies.filter(d => d.dependencyType === 'blocks')
    if (blockingDeps.length > 0) {
      this.log(styles.muted('\n  Blocked by:'))
      for (const dep of blockingDeps) {
        const blocker = await this.storage.getEpic(dep.dependsOnEpicId)
        if (blocker) {
          const status = blocker.status === 'complete' ? styles.success('done') : styles.warning(blocker.status)
          this.log(`    - ${blocker.id}: ${blocker.title} (${status})`)
        }
      }
    }

    const otherDeps = dependencies.filter(d => d.dependencyType !== 'blocks')
    if (otherDeps.length > 0) {
      this.log(styles.muted('\n  Related:'))
      for (const dep of otherDeps) {
        const targetEpic = await this.storage.getEpic(dep.dependsOnEpicId)
        if (targetEpic) {
          this.log(`    - ${dep.dependencyType}: ${targetEpic.id} - ${targetEpic.title}`)
        }
      }
    }

    // Note: showAll would show reverse dependencies, but we don't have getEpicsBlockedBy
    // For now, we just show the epic's own dependencies

    if (dependencies.length === 0) {
      this.log(styles.muted('\n  No links.'))
    }

    this.log('')
  }
}

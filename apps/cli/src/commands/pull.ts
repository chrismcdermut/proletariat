import { Flags } from '@oclif/core'
import { PMOCommand, pmoBaseFlags } from '../lib/pmo/base-command.js'
import { shouldOutputJson } from '../lib/prompt-json.js'
import { styles, divider } from '../lib/styles.js'
import {
  loadDietConfig,
  formatDietConfig,
  type DietConfig,
  type PullResult,
  type PulledTicket,
} from '../lib/pmo/diet.js'
import type { Ticket, WorkflowStatus } from '../lib/pmo/types.js'

export default class Pull extends PMOCommand {
  static description = 'Pull tickets from Backlog to Ready using diet ratio enforcement'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --count 20',
    '<%= config.bin %> <%= command.id %> --dry-run',
    '<%= config.bin %> <%= command.id %> --count 50 --dry-run',
  ]

  static flags = {
    ...pmoBaseFlags,
    count: Flags.integer({
      char: 'n',
      description: 'Number of tickets to pull to Ready',
      default: 50,
      min: 1,
    }),
    'dry-run': Flags.boolean({
      char: 'd',
      description: 'Show what would be pulled without moving tickets',
      default: false,
    }),
  }

  protected async execute(): Promise<void> {
    const { flags } = await this.parse(Pull)
    const jsonMode = shouldOutputJson(flags)
    const projectId = await this.requireProject()
    const count = flags.count
    const dryRun = flags['dry-run']

    // Load diet config
    const db = this.storage.getDatabase()
    const dietConfig = loadDietConfig(db)

    // Get project workflow statuses to find the target "Ready" status
    const project = await this.storage.getProject(projectId)
    if (!project) {
      this.error(`Project not found: ${projectId}`)
    }

    const workflowId = project.workflowId || 'default'
    const statuses = await this.storage.listStatuses(workflowId)

    const hasBacklog = statuses.some(s => s.category === 'backlog')
    const readyStatuses = statuses.filter(s => s.category === 'unstarted')

    if (!hasBacklog) {
      this.error('No backlog statuses found in workflow. Cannot pull tickets.')
    }

    if (readyStatuses.length === 0) {
      this.error('No ready/unstarted statuses found in workflow. Cannot pull tickets.')
    }

    // Target status is the first unstarted status (Ready/To Do)
    const targetStatus = readyStatuses.sort((a, b) => a.position - b.position)[0]

    // Get all backlog tickets ordered by position (using statusCategory filter)
    const allBacklogTickets = await this.storage.listTickets(projectId, { statusCategory: 'backlog' })
    allBacklogTickets.sort((a, b) => (a.position || 0) - (b.position || 0))

    if (allBacklogTickets.length === 0) {
      this.log(styles.warning('No tickets in backlog to pull.'))
      return
    }

    // Get existing ready tickets for diet calculation
    const existingReadyTickets = await this.storage.listTickets(projectId, { statusCategory: 'unstarted' })

    // Run the pull algorithm
    const result = await this.runPullAlgorithm(
      allBacklogTickets,
      existingReadyTickets,
      dietConfig,
      count,
    )

    // JSON output path
    if (jsonMode) {
      this.log(JSON.stringify({
        type: 'success',
        result: {
          dryRun,
          pulled: result.pulled,
          skippedBlocked: result.skippedBlocked,
          skippedCeiling: result.skippedCeiling,
          totalCandidates: result.totalCandidates,
          targetStatus: targetStatus.name,
        }
      }, null, 2))
      // Still move tickets if not dry-run
      if (!dryRun && result.pulled.length > 0) {
        for (const ticket of result.pulled) {
          // eslint-disable-next-line no-await-in-loop -- Sequential moves to maintain ordering
          await this.storage.moveTicket(projectId, ticket.id, targetStatus.name)
        }
      }
      return
    }

    // Display results
    this.displayPullResults(result, dietConfig, targetStatus, dryRun)

    // Move tickets if not dry-run
    if (!dryRun && result.pulled.length > 0) {
      for (const ticket of result.pulled) {
        // eslint-disable-next-line no-await-in-loop -- Sequential moves to maintain ordering
        await this.storage.moveTicket(projectId, ticket.id, targetStatus.name)
      }
      this.log(styles.success(`\nMoved ${result.pulled.length} ticket${result.pulled.length === 1 ? '' : 's'} to ${targetStatus.name}.`))
    } else if (dryRun && result.pulled.length > 0) {
      this.log(styles.warning(`\nDry run: ${result.pulled.length} ticket${result.pulled.length === 1 ? '' : 's'} would be moved to ${targetStatus.name}.`))
    }
  }

  /**
   * Core pull algorithm with diet enforcement.
   *
   * Pass 1: Walk backlog top-down, pull if category not over ceiling
   * Pass 2: Force-pull from underrepresented categories
   */
  private async runPullAlgorithm(
    backlogTickets: Ticket[],
    existingReadyTickets: Ticket[],
    dietConfig: DietConfig,
    targetCount: number,
  ): Promise<PullResult> {
    const pulled: PulledTicket[] = []
    let skippedBlocked = 0
    let skippedCeiling = 0

    // Build category count map from existing ready tickets
    const categoryCounts = new Map<string, number>()
    for (const ratio of dietConfig.ratios) {
      categoryCounts.set(ratio.category, 0)
    }
    for (const ticket of existingReadyTickets) {
      const cat = (ticket.category || '').toLowerCase()
      if (cat) {
        categoryCounts.set(cat, (categoryCounts.get(cat) || 0) + 1)
      }
    }

    // Track which tickets are pulled (to avoid duplicates in second pass)
    const pulledIds = new Set<string>()

    // Calculate ceiling per category (total = existing ready + new pulls)
    const totalTarget = existingReadyTickets.length + targetCount
    const getCeiling = (category: string): number => {
      const ratio = dietConfig.ratios.find(r => r.category === category)
      if (!ratio) return targetCount // No ceiling for uncategorized
      return Math.ceil(totalTarget * ratio.target)
    }

    // Pass 1: Walk backlog top-down, pull if under ceiling
    const remainingBacklog: Ticket[] = []
    for (const ticket of backlogTickets) {
      if (pulled.length >= targetCount) break

      // Check if blocked (all blocking dependencies must be completed/canceled)
      // eslint-disable-next-line no-await-in-loop -- Need sequential dependency check
      const blocked = await this.storage.isTicketBlocked(ticket.id)
      if (blocked) {
        skippedBlocked++
        continue
      }

      const cat = (ticket.category || '').toLowerCase()
      const currentCount = categoryCounts.get(cat) || 0
      const ceiling = getCeiling(cat)

      if (currentCount < ceiling) {
        pulled.push({
          id: ticket.id,
          title: ticket.title,
          category: ticket.category || undefined,
          position: ticket.position || 0,
          pass: 'first',
        })
        pulledIds.add(ticket.id)
        categoryCounts.set(cat, currentCount + 1)
      } else {
        skippedCeiling++
        remainingBacklog.push(ticket)
      }
    }

    // Pass 2: Force-pull from underrepresented categories
    if (pulled.length < targetCount) {
      for (const ratio of dietConfig.ratios) {
        if (pulled.length >= targetCount) break

        const currentCount = categoryCounts.get(ratio.category) || 0
        const targetForCat = Math.ceil(totalTarget * ratio.target)

        if (currentCount < targetForCat) {
          const catTickets = remainingBacklog.filter(
            t => (t.category || '').toLowerCase() === ratio.category && !pulledIds.has(t.id)
          )

          for (const ticket of catTickets) {
            if (pulled.length >= targetCount) break
            if ((categoryCounts.get(ratio.category) || 0) >= targetForCat) break

            // eslint-disable-next-line no-await-in-loop -- Sequential dependency check
            const blocked = await this.storage.isTicketBlocked(ticket.id)
            if (blocked) continue

            pulled.push({
              id: ticket.id,
              title: ticket.title,
              category: ticket.category || undefined,
              position: ticket.position || 0,
              pass: 'second',
            })
            pulledIds.add(ticket.id)
            categoryCounts.set(ratio.category, (categoryCounts.get(ratio.category) || 0) + 1)
          }
        }
      }
    }

    return {
      pulled,
      skippedBlocked,
      skippedCeiling,
      totalCandidates: backlogTickets.length,
    }
  }

  /**
   * Display pull results.
   */
  private displayPullResults(
    result: PullResult,
    dietConfig: DietConfig,
    targetStatus: WorkflowStatus,
    dryRun: boolean,
  ): void {
    const prefix = dryRun ? '[DRY RUN] ' : ''

    this.log(styles.title(`\n${prefix}Pull Results`))
    this.log(divider(60))

    // Summary stats
    this.log(`  Backlog candidates: ${result.totalCandidates}`)
    this.log(`  Skipped (blocked):  ${result.skippedBlocked}`)
    this.log(`  Skipped (ceiling):  ${result.skippedCeiling}`)
    this.log(`  ${dryRun ? 'Would pull' : 'Pulling'}:       ${styles.emphasis(String(result.pulled.length))}`)
    this.log(`  Target status:      ${targetStatus.name}`)
    this.log(`  Diet:               ${formatDietConfig(dietConfig)}`)
    this.log(divider(60))

    if (result.pulled.length === 0) {
      this.log(styles.warning('\nNo tickets to pull.'))
      return
    }

    // Group by category for display
    const byCategory = new Map<string, PulledTicket[]>()
    for (const ticket of result.pulled) {
      const cat = ticket.category || 'uncategorized'
      if (!byCategory.has(cat)) {
        byCategory.set(cat, [])
      }
      byCategory.get(cat)!.push(ticket)
    }

    // Display by category
    for (const [category, tickets] of byCategory) {
      const ratio = dietConfig.ratios.find(r => r.category === category)
      const targetPct = ratio ? `${Math.round(ratio.target * 100)}%` : 'n/a'
      const actualPct = result.pulled.length > 0
        ? `${Math.round((tickets.length / result.pulled.length) * 100)}%`
        : '0%'

      this.log(`\n  ${styles.emphasis(category)} (${tickets.length} tickets, target: ${targetPct}, actual: ${actualPct})`)

      for (const ticket of tickets) {
        const passLabel = ticket.pass === 'second' ? styles.warning(' [force-pull]') : ''
        this.log(`    ${styles.code(ticket.id)} ${ticket.title}${passLabel}`)
      }
    }
  }
}

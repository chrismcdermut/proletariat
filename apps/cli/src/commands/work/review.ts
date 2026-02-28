import { Args, Flags } from '@oclif/core'
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import Database from 'better-sqlite3'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import { styles } from '../../lib/styles.js'
import {
  getWorkspaceInfo,
} from '../../lib/agents/commands.js'
import { ExecutionStorage } from '../../lib/execution/storage.js'
import {
  shouldOutputJson,
  outputErrorAsJson,
  outputSuccessAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'
import {
  isGHInstalled,
  isGHAuthenticated,
  getPRFeedback,
  getPRForBranch,
  type PRFeedback,
} from '../../lib/pr/index.js'

/**
 * Default polling interval for checking agent completion (in ms).
 */
const POLL_INTERVAL_MS = 10_000

/**
 * Maximum poll duration before giving up (30 minutes).
 */
const MAX_POLL_DURATION_MS = 30 * 60 * 1000

export default class WorkReview extends PMOCommand {
  static description = 'Automated review-fix pipeline: review → fix → re-review until clean'

  static examples = [
    '<%= config.bin %> <%= command.id %> TKT-001',
    '<%= config.bin %> <%= command.id %> TKT-001 --max-cycles 5',
    '<%= config.bin %> <%= command.id %> TKT-001 --auto  # Skip confirmations between cycles',
    '<%= config.bin %> <%= command.id %>  # Interactive mode',
  ]

  static args = {
    ticketId: Args.string({
      description: 'Ticket ID to review',
      required: false,
    }),
  }

  static flags = {
    ...pmoBaseFlags,
    'max-cycles': Flags.integer({
      description: 'Maximum review-fix cycles before stopping (default: 3)',
      default: 3,
    }),
    auto: Flags.boolean({
      description: 'Skip confirmations between cycles (fully automated)',
      default: false,
    }),
    executor: Flags.string({
      char: 'e',
      description: 'Override executor',
      options: ['claude-code', 'codex', 'aider', 'custom'],
    }),
    'run-on-host': Flags.boolean({
      description: 'Run on host even if devcontainer exists (bypasses sandbox)',
      default: false,
    }),
    'skip-permissions': Flags.boolean({
      description: 'Skip permission checks for agents',
      default: false,
    }),
    display: Flags.string({
      char: 'd',
      description: 'Display mode for agents',
      options: ['foreground', 'terminal', 'background'],
      default: 'background',
    }),
    session: Flags.string({
      char: 's',
      description: 'Session manager inside container',
      options: ['tmux', 'direct'],
      default: 'tmux',
    }),
    'poll-interval': Flags.integer({
      description: 'Polling interval in seconds to check agent completion (default: 10)',
      default: 10,
    }),
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(WorkReview)
    const projectId = (flags as { project?: string }).project

    const jsonMode = shouldOutputJson(flags)

    const handleError = (code: string, message: string): never => {
      if (jsonMode) {
        outputErrorAsJson(code, message, createMetadata('work review', flags))
        this.exit(1)
      }
      this.error(message)
    }

    // Check gh CLI
    if (!isGHInstalled() || !isGHAuthenticated()) {
      return handleError('GH_NOT_AVAILABLE', 'GitHub CLI (gh) is required for the review pipeline.\nRun: prlt gh login')
    }

    // Get workspace info
    let workspaceInfo
    try {
      workspaceInfo = getWorkspaceInfo()
    } catch {
      return handleError('NOT_IN_WORKSPACE', 'Not in a workspace. Run "prlt init" first.')
    }

    const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
    const db = new Database(dbPath)
    const executionStorage = new ExecutionStorage(db)

    try {
      // Get ticketId
      let ticketId = args.ticketId

      if (!ticketId) {
        // Show tickets that are in progress or review (have PRs)
        const allTickets = await this.storage.listTickets(projectId)
        const reviewableTickets = allTickets.filter(t => {
          const hasPR = t.metadata?.pr_url
          const isInProgress = t.status === 'in_progress' || t.status === 'done'
          return hasPR || isInProgress
        })

        if (reviewableTickets.length === 0) {
          db.close()
          return handleError('NO_TICKETS', 'No reviewable tickets found. Tickets need a PR to be reviewed.')
        }

        const selected = await this.selectFromList({
          message: 'Select ticket to review:',
          items: reviewableTickets,
          getName: (t) => `${t.id} - ${t.title} ${t.metadata?.pr_url ? '(has PR)' : ''}`,
          getValue: (t) => t.id,
          getCommand: (t) => `prlt work review ${t.id} --json`,
          jsonMode: jsonMode ? { flags, commandName: 'work review' } : null,
        })

        if (!selected) {
          db.close()
          return
        }
        ticketId = selected
      }

      // Get ticket
      const ticket = await this.storage.getTicket(ticketId!)
      if (!ticket) {
        db.close()
        return handleError('TICKET_NOT_FOUND', `Ticket "${ticketId}" not found.`)
      }

      // Find the PR - either from ticket metadata or by branch
      let prUrl = ticket.metadata?.pr_url as string | undefined
      let prBranch = ticket.metadata?.pr_branch as string | undefined

      if (!prUrl && ticket.branch) {
        // Try to find PR by branch
        const prInfo = getPRForBranch(ticket.branch)
        if (prInfo) {
          prUrl = prInfo.url
          prBranch = ticket.branch
        }
      }

      if (!prUrl) {
        db.close()
        return handleError('NO_PR', `Ticket "${ticketId}" has no PR. Create one first with "prlt work ready ${ticketId} --pr".`)
      }

      const maxCycles = flags['max-cycles']
      const autoMode = flags.auto
      const pollInterval = (flags['poll-interval'] || 10) * 1000

      this.log('')
      this.log(styles.header('Review Pipeline'))
      this.log(styles.muted(`   Ticket: ${ticket.id} - ${ticket.title}`))
      this.log(styles.muted(`   PR: ${prUrl}`))
      this.log(styles.muted(`   Max cycles: ${maxCycles}`))
      this.log(styles.muted(`   Mode: ${autoMode ? 'fully automated' : 'interactive'}`))
      this.log('')

      // Pipeline loop
      for (let cycle = 1; cycle <= maxCycles; cycle++) {
        this.log(styles.header(`Cycle ${cycle}/${maxCycles}: Review Phase`))
        this.log('')

        // === REVIEW PHASE ===
        // Spawn a review agent
        const reviewArgs = this.buildStartArgs(ticketId!, flags, 'review')

        this.log(styles.muted('Spawning review agent...'))

        try {
          await this.config.runCommand('work:start', reviewArgs)
        } catch (error) {
          this.log(styles.error(`Failed to spawn review agent: ${error instanceof Error ? error.message : error}`))
          break
        }

        // Wait for the review agent to complete
        this.log(styles.muted('Waiting for review agent to complete...'))
        const reviewCompleted = await this.waitForAgentCompletion(
          ticketId!,
          executionStorage,
          pollInterval,
        )

        if (!reviewCompleted) {
          this.log(styles.warning('Review agent did not complete within timeout. Stopping pipeline.'))
          break
        }

        this.log(styles.success('Review agent completed.'))
        this.log('')

        // Check PR feedback
        this.log(styles.muted('Checking review results...'))
        const feedback = getPRFeedback(prUrl)

        if (!feedback) {
          this.log(styles.warning('Could not fetch PR feedback. Stopping pipeline.'))
          break
        }

        const verdict = this.getReviewVerdict(feedback)

        if (verdict === 'APPROVED') {
          this.log(styles.success('PR APPROVED! No fixes needed.'))
          this.log('')

          if (jsonMode) {
            outputSuccessAsJson({
              ticketId: ticketId!,
              prUrl,
              verdict: 'APPROVED',
              cycles: cycle,
            }, createMetadata('work review', flags))
          }

          db.close()
          return
        }

        this.log(styles.warning(`Review verdict: ${verdict}`))
        this.log(styles.muted(`   Reviews: ${feedback.reviews.length}`))

        // Show review summary
        for (const review of feedback.reviews) {
          if (review.state === 'CHANGES_REQUESTED' || review.state === 'COMMENTED') {
            this.log(styles.muted(`   ${review.author}: ${review.state}`))
            if (review.comments.length > 0) {
              this.log(styles.muted(`     ${review.comments.length} comment(s)`))
            }
          }
        }
        this.log('')

        // Check if we've reached max cycles
        if (cycle === maxCycles) {
          this.log(styles.warning(`Reached maximum cycles (${maxCycles}). Stopping pipeline.`))
          this.log(styles.muted('Review feedback remains on the PR for manual follow-up.'))
          break
        }

        // === FIX PHASE ===
        if (!autoMode) {
          const shouldFix = await this.selectFromList({
            message: `Issues found in cycle ${cycle}. Auto-fix and re-review?`,
            items: [
              { id: 'yes', name: 'Yes, spawn fix agent and re-review' },
              { id: 'fix-only', name: 'Fix only (no re-review)' },
              { id: 'no', name: 'No, stop pipeline' },
            ],
            getName: (item) => item.name,
            getValue: (item) => item.id,
            getCommand: () => '',
            jsonMode: jsonMode ? { flags, commandName: 'work review' } : null,
          })

          if (shouldFix === 'no' || !shouldFix) {
            this.log(styles.muted('Pipeline stopped by user.'))
            break
          }

          if (shouldFix === 'fix-only') {
            // Spawn fix agent but don't re-review
            this.log(styles.header(`Cycle ${cycle}/${maxCycles}: Fix Phase (final)`))
            await this.runFixPhase(ticketId!, flags, executionStorage, pollInterval)
            break
          }
        }

        this.log(styles.header(`Cycle ${cycle}/${maxCycles}: Fix Phase`))
        this.log('')

        const fixCompleted = await this.runFixPhase(ticketId!, flags, executionStorage, pollInterval)

        if (!fixCompleted) {
          this.log(styles.warning('Fix agent did not complete. Stopping pipeline.'))
          break
        }

        this.log(styles.success('Fix agent completed. Proceeding to re-review...'))
        this.log('')

        // Small delay before re-review to let GitHub update
        await this.sleep(3000)
      }

      // Final status
      this.log('')
      const finalFeedback = getPRFeedback(prUrl)
      const finalVerdict = finalFeedback ? this.getReviewVerdict(finalFeedback) : 'UNKNOWN'

      this.log(styles.header('Pipeline Complete'))
      this.log(styles.muted(`   Final status: ${finalVerdict}`))
      this.log(styles.muted(`   PR: ${prUrl}`))
      this.log('')

      if (jsonMode) {
        outputSuccessAsJson({
          ticketId: ticketId!,
          prUrl,
          verdict: finalVerdict,
        }, createMetadata('work review', flags))
      }

      db.close()
    } catch (error) {
      db.close()
      throw error
    }
  }

  /**
   * Build args for `work:start` command.
   */
  private buildStartArgs(ticketId: string, flags: Record<string, unknown>, action: string): string[] {
    const startArgs: string[] = [
      ticketId,
      '--action', action,
      '--ephemeral',
      '--display', (flags.display as string) || 'background',
      '--yes',
    ]

    if (flags.executor) startArgs.push('--executor', flags.executor as string)
    if (flags['run-on-host']) startArgs.push('--run-on-host')
    if (flags['skip-permissions']) startArgs.push('--skip-permissions')
    else startArgs.push('--permission-mode', 'danger')
    if (flags.session) startArgs.push('--session', flags.session as string)
    if (flags.force) startArgs.push('--force')

    // Pass project if available
    const projectId = (flags as { project?: string }).project
    if (projectId) startArgs.push('--project', projectId)

    return startArgs
  }

  /**
   * Run the fix phase: spawn review-fix agent and wait for completion.
   */
  private async runFixPhase(
    ticketId: string,
    flags: Record<string, unknown>,
    executionStorage: ExecutionStorage,
    pollInterval: number,
  ): Promise<boolean> {
    const fixArgs = this.buildStartArgs(ticketId, flags, 'review-fix')

    this.log(styles.muted('Spawning fix agent...'))

    try {
      await this.config.runCommand('work:start', fixArgs)
    } catch (error) {
      this.log(styles.error(`Failed to spawn fix agent: ${error instanceof Error ? error.message : error}`))
      return false
    }

    this.log(styles.muted('Waiting for fix agent to complete...'))
    return this.waitForAgentCompletion(ticketId, executionStorage, pollInterval)
  }

  /**
   * Wait for the most recent execution on a ticket to complete.
   * Polls the execution storage and checks tmux session existence.
   */
  private async waitForAgentCompletion(
    ticketId: string,
    executionStorage: ExecutionStorage,
    pollInterval: number,
  ): Promise<boolean> {
    const startTime = Date.now()

    while (Date.now() - startTime < MAX_POLL_DURATION_MS) {
      // Clean up stale executions first
      executionStorage.cleanupStaleExecutions()

      // Check if there's still a running execution for this ticket
      const runningExec = executionStorage.getRunningExecution(ticketId)

      if (!runningExec) {
        // No running execution - agent has completed (or was never started)
        return true
      }

      // Check if the tmux session still exists
      if (runningExec.sessionId) {
        const sessionExists = this.checkTmuxSession(runningExec.sessionId, runningExec.environment, runningExec.containerId)
        if (!sessionExists) {
          // Session is gone - mark as completed
          executionStorage.updateStatus(runningExec.id, 'completed')
          return true
        }
      }

      // Log progress periodically
      const elapsed = Math.round((Date.now() - startTime) / 1000)
      if (elapsed > 0 && elapsed % 60 === 0) {
        this.log(styles.muted(`   Still waiting... (${elapsed}s elapsed)`))
      }

      await this.sleep(pollInterval)
    }

    return false
  }

  /**
   * Check if a tmux session exists.
   */
  private checkTmuxSession(sessionId: string, environment?: string, containerId?: string): boolean {
    try {
      if (environment === 'devcontainer' && containerId) {
        execSync(`docker exec ${containerId} tmux has-session -t "${sessionId}"`, { stdio: 'pipe' })
      } else {
        execSync(`tmux has-session -t "${sessionId}"`, { stdio: 'pipe' })
      }
      return true
    } catch {
      return false
    }
  }

  /**
   * Get the review verdict from PR feedback.
   */
  private getReviewVerdict(feedback: PRFeedback): string {
    // Check review decision first (aggregated by GitHub)
    if (feedback.reviewDecision) {
      return feedback.reviewDecision
    }

    // Check individual reviews - most recent takes precedence
    const sortedReviews = [...feedback.reviews].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )

    for (const review of sortedReviews) {
      if (review.state === 'APPROVED') return 'APPROVED'
      if (review.state === 'CHANGES_REQUESTED') return 'CHANGES_REQUESTED'
    }

    // If there are any comments, treat as needing attention
    if (feedback.reviews.some(r => r.comments.length > 0) || feedback.comments.length > 0) {
      return 'COMMENTED'
    }

    return 'UNKNOWN'
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

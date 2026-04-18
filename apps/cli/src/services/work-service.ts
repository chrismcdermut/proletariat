/**
 * WorkService
 *
 * Service for work lifecycle operations: start, ship, propose, stop.
 * Orchestrates the agent lifecycle — ticket resolution, execution,
 * PR management, and ticket state transitions.
 *
 * No oclif, no inquirer, no CLI formatting.
 */

import type Database from 'better-sqlite3'
import { execSync } from 'node:child_process'
import type { Ticket } from '../lib/pmo/types.js'
import type { ProviderStorage, TicketProvider } from '../lib/providers/types.js'
import {
  getPRByNumber,
  getPRForBranch,
  getPRChecks,
  mergePR,
  getGitHubRepo,
  findPRForTicket,
  listOpenPRs,
} from '../lib/pr/index.js'
import type { PRInfo } from '../lib/pr/index.js'
import {
  rebaseSiblingPRs,
  watchAndShip,
  GitHubAutoMergeProvider,
} from '../lib/shipping/index.js'
import type { WhenGreenResult, SiblingRebaseResult } from '../lib/shipping/index.js'
import { moveTicketByIntent } from '../lib/work-lifecycle/transition.js'
import { getEventBus } from '../lib/events/event-bus.js'
import { ExecutionStorage } from '../lib/execution/storage.js'
import { validateBranchName } from '../lib/branch/index.js'
import { PMO_TABLES } from '../lib/pmo/schema.js'
import { ServiceError } from './types.js'
import type {
  ShipWorkOptions,
  ShipWorkResult,
  ShipAllOptions,
  ShipAllResult,
} from './types.js'

/**
 * Storage interface needed by WorkService.
 *
 * Kept nominally aligned with ProviderStorage; WorkService now routes all
 * ticket reads/writes through the provider layer (PRLT-1319).
 */
export type WorkServiceStorage = ProviderStorage

/**
 * Callback for resolving a ticket provider given a ticket ID and project ID.
 * The CLI command injects this — the service never imports oclif.
 */
export type ProviderResolver = (ticketId: string, projectId: string) => Promise<TicketProvider>

/**
 * Logger callback — services log through this, not console or this.log().
 */
export interface ServiceLogger {
  info: (msg: string) => void
  warn: (msg: string) => void
}

const noopLogger: ServiceLogger = {
  info: () => {},
  warn: () => {},
}

export class WorkService {
  private readonly executionStorage: ExecutionStorage

  constructor(
    private readonly db: Database.Database,
    private readonly storage: WorkServiceStorage,
    private readonly resolveProvider: ProviderResolver,
    private readonly logger: ServiceLogger = noopLogger,
  ) {
    this.executionStorage = new ExecutionStorage(db)
  }

  /**
   * Ship work: merge PR, transition ticket to Done, rebase siblings.
   *
   * Handles multiple modes:
   * - Standard: check CI → merge → transition
   * - When-green: watch CI → auto-merge when all checks pass
   * - Already-merged: skip merge → transition ticket (recovery from drift)
   */
  async shipWork(options: ShipWorkOptions): Promise<ShipWorkResult> {
    const {
      ticketId: inputTicketId,
      prNumber: inputPrNumber,
      method = 'squash',
      wait = false,
      whenGreen = false,
      dryRun = false,
      deleteBranch = true,
      admin = false,
      rebaseSiblings = true,
      noTransition = false,
      noRebase = false,
      cwd,
    } = options

    // --- Resolve ticket and PR ---
    let ticketId = inputTicketId
    let prNumber = inputPrNumber
    let ticket: Ticket | null = null
    let prInfo: PRInfo | null = null

    if (prNumber) {
      // PR provided — look it up
      prInfo = getPRByNumber(prNumber, { cwd })
      if (!prInfo) {
        // Fallback: cwd may not be a git repo (e.g. HQ root). Try deriving
        // the repo slug from cwd and use the explicit --repo flag (PRLT-1334).
        const repoSlug = cwd ? getGitHubRepo(cwd) : undefined
        if (repoSlug) {
          prInfo = getPRByNumber(prNumber, { repo: repoSlug })
        }
      }
      if (!prInfo) {
        throw new ServiceError('NOT_FOUND', `PR #${prNumber} not found.`)
      }

      // Try to resolve linked ticket
      const linked = await this.resolveLinkedTicket(prNumber, prInfo.headBranch, undefined)
      if (linked) {
        ticket = linked
        ticketId = linked.id
      }
    } else if (ticketId) {
      // Ticket provided — resolve via the provider (Linear / Jira / etc.)
      // since the local PMO ticket store is gone (PRLT-1299 / PRLT-1319).
      const provider = await this.resolveProvider(ticketId, '')
      const getResult = await provider.getTicket(ticketId)
      ticket = (getResult.success && getResult.ticket) ? getResult.ticket : null
      if (!ticket) {
        throw new ServiceError('NOT_FOUND', `Ticket "${ticketId}" not found.`)
      }

      prNumber = ticket.metadata?.pr_number ? parseInt(ticket.metadata.pr_number, 10) : undefined

      // Build lookup options — start with cwd, derive repo slug as fallback.
      // When cwd is not a git repo (e.g. HQ root), the --repo flag lets gh
      // query GitHub directly without needing a local git remote (PRLT-1334).
      const repoSlug = cwd ? getGitHubRepo(cwd) : undefined
      const lookupOpts: { cwd?: string; repo?: string } = repoSlug ? { repo: repoSlug } : { cwd }

      if (prNumber) {
        prInfo = getPRByNumber(prNumber, { cwd }) || getPRByNumber(prNumber, lookupOpts)
      }

      if (!prInfo) {
        // Try execution branch
        const runningExecution = this.executionStorage.getRunningExecution(ticketId)
        const branch = runningExecution?.branch || ticket.branch
        if (branch) {
          prInfo = getPRForBranch(branch, { cwd }) || getPRForBranch(branch, lookupOpts)
          if (prInfo) prNumber = prInfo.number
        }
      }

      if (!prInfo) {
        // Search by ticket IDs
        const searchIds = this.buildSearchIds(ticket, ticketId)
        const found = findPRForTicket(searchIds, { cwd }) || findPRForTicket(searchIds, lookupOpts)
        if (found) {
          prInfo = found
          prNumber = found.number
        }
      }

      if (!prInfo || !prNumber) {
        throw new ServiceError(
          'NOT_FOUND',
          `No pull request found for ticket "${ticketId}". Create one with "prlt work ready ${ticketId} --pr".`,
        )
      }
    } else {
      throw new ServiceError('VALIDATION', 'Either ticketId or prNumber is required.')
    }

    // Validate PR state
    const alreadyMerged = prInfo.state === 'MERGED'
    if (prInfo.state === 'CLOSED') {
      throw new ServiceError('CONFLICT', `PR #${prNumber} is closed. Reopen it first.`)
    }

    // --- Dry run ---
    if (dryRun) {
      return this.buildDryRunResult(prInfo, prNumber!, ticket, method, cwd)
    }

    // --- Merge ---
    let whenGreenResult: WhenGreenResult | undefined

    if (alreadyMerged) {
      this.logger.info(`PR #${prNumber} already merged — transitioning ticket only.`)
    } else if (whenGreen) {
      whenGreenResult = await watchAndShip(
        {
          prNumber: prNumber!,
          method,
          deleteBranch,
          admin,
          noRebase,
          cwd,
          headBranch: prInfo.headBranch,
          baseBranch: prInfo.baseBranch,
          onProgress: (msg) => this.logger.info(msg),
          onWarning: (msg) => this.logger.warn(msg),
        },
        new GitHubAutoMergeProvider(),
      )

      if (!whenGreenResult.merged) {
        throw new ServiceError(
          'PRECONDITION_FAILED',
          whenGreenResult.error || 'Auto-merge failed.',
          { errorCode: whenGreenResult.errorCode },
        )
      }
    } else {
      // Standard mode: CI check → rebase → merge
      const ciResult = await this.waitForCI(prNumber!, wait, cwd)
      if (!ciResult.passed) {
        throw new ServiceError('PRECONDITION_FAILED', ciResult.message)
      }

      // Check conflicts and rebase
      const hasConflicts = this.checkMergeConflicts(prNumber!, cwd)
      if (hasConflicts) {
        if (noRebase) {
          throw new ServiceError(
            'CONFLICT',
            `PR #${prNumber} has merge conflicts. Resolve manually or drop --no-rebase.`,
          )
        }

        this.logger.info('Merge conflicts detected, rebasing...')
        const rebaseResult = this.rebaseOntoBase(prInfo.headBranch, prInfo.baseBranch, cwd)
        if (!rebaseResult.success) {
          throw new ServiceError('EXTERNAL_FAILURE', `Rebase failed: ${rebaseResult.error}`)
        }

        // Wait for CI after rebase
        const postRebaseCI = await this.waitForCI(prNumber!, true, cwd)
        if (!postRebaseCI.passed) {
          throw new ServiceError('PRECONDITION_FAILED', postRebaseCI.message)
        }
      }

      // Merge
      const mergeResult = mergePR(prNumber!, { method, deleteBranch, admin, cwd })
      if (!mergeResult.success) {
        throw new ServiceError(
          'EXTERNAL_FAILURE',
          `Failed to merge PR #${prNumber}: ${mergeResult.error}`,
        )
      }
    }

    // --- Transition ticket ---
    let newState: string | undefined
    if (ticket && ticketId && !noTransition) {
      // Update PR metadata through the provider (local PMO ticket store is
      // dead — PRLT-1299). Swallow provider errors so they don't block the
      // actual state transition below.
      try {
        const provider = await this.resolveProvider(ticketId, ticket.projectId || '')
        await provider.updateTicket(ticketId, {
          metadata: {
            ...ticket.metadata,
            pr_state: 'MERGED',
            merged_at: new Date().toISOString(),
          },
        })
      } catch (err) {
        if ((err as { code?: string }).code !== 'SQLITE_READONLY') {
          this.logger.warn(`Failed to record PR merge metadata: ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      try {
        const transition = await moveTicketByIntent({
          db: this.db,
          storage: this.storage,
          ticket,
          intent: 'completed',
          providerName: 'pmo',
          resolveProvider: this.resolveProvider,
          log: (msg) => this.logger.info(msg),
        })
        if (transition.moved) {
          newState = transition.targetColumn ?? undefined
        }
      } catch (err) {
        this.logger.warn(
          `Failed to move ticket to Done: ${err instanceof Error ? err.message : err}`,
        )
      }

      // Mark execution completed
      const runningExecution = this.executionStorage.getRunningExecution(ticketId)
      if (runningExecution) {
        this.executionStorage.tryUpdateStatus(runningExecution.id, 'completed')
      }
    }

    // --- Emit event ---
    if (ticketId) {
      try {
        const repo = getGitHubRepo(cwd)
        const prUrl = repo ? `https://github.com/${repo}/pull/${prNumber}` : null
        getEventBus().emit('work:pr_merged', {
          workItemId: ticketId,
          source: 'github',
          prNumber,
          prTitle: prInfo.title,
          prUrl,
          mergeMethod: method,
          timestamp: new Date(),
        })
      } catch {
        // Non-critical
      }
    }

    // --- Rebase siblings ---
    let siblingsRebased = false
    let siblingCount = 0
    if (rebaseSiblings && !alreadyMerged) {
      try {
        const result: SiblingRebaseResult = rebaseSiblingPRs({
          excludePRNumber: prNumber!,
          cwd,
          onProgress: (msg) => this.logger.info(msg),
          labelConflicts: true,
          commentOnConflicts: true,
        })
        siblingCount = result.succeeded.length + result.failed.length
        siblingsRebased = siblingCount > 0
      } catch {
        // Non-critical
      }
    }

    return {
      success: true,
      ticket: ticket ?? undefined,
      pr: prInfo,
      alreadyMerged,
      method,
      siblingsRebased,
      siblingCount,
      newState,
    }
  }

  /**
   * Ship all green PRs.
   */
  async shipAll(options: ShipAllOptions = {}): Promise<ShipAllResult> {
    const {
      method = 'squash',
      whenGreen = false,
      deleteBranch = true,
      rebaseSiblings: _rebaseSiblings = true,
      cwd,
    } = options

    const openPRs = listOpenPRs(cwd)
    if (openPRs.length === 0) {
      return { success: true, shipped: [], skipped: [], failed: [] }
    }

    const shipped: ShipAllResult['shipped'] = []
    const skipped: ShipAllResult['skipped'] = []
    const failed: ShipAllResult['failed'] = []

    for (const pr of openPRs) {
      try {
        const checks = getPRChecks(pr.number, cwd)
        const allPassed = checks.length > 0 && checks.every(
          c => c.conclusion === 'SUCCESS' || c.conclusion === 'SKIPPED'
        )

        if (whenGreen) {
          // Enable auto-merge for each PR
          const autoMerge = new GitHubAutoMergeProvider()
          try {
            await autoMerge.enableAutoMerge(pr.number, method, cwd)
            this.logger.info(`Auto-merge enabled for PR #${pr.number}`)
            skipped.push({ pr, reason: 'auto-merge enabled (watching)' })
          } catch (err) {
            failed.push({ pr, error: `Auto-merge failed: ${err instanceof Error ? err.message : err}` })
          }
          continue
        }

        if (!allPassed) {
          const pending = checks.filter(c => !c.conclusion)
          const failedChecks = checks.filter(c => c.conclusion === 'FAILURE')
          skipped.push({
            pr,
            reason: failedChecks.length > 0
              ? `CI failed: ${failedChecks.map(c => c.name).join(', ')}`
              : pending.length > 0
                ? 'CI pending'
                : 'No CI checks',
          })
          continue
        }

        // Ship this PR
        try {
          const result = await this.shipWork({
            prNumber: pr.number,
            method,
            deleteBranch,
            rebaseSiblings: false, // Don't rebase siblings per-PR in batch
            cwd,
          })
          shipped.push({ ticket: result.ticket, pr })
        } catch (err) {
          failed.push({ pr, error: err instanceof Error ? err.message : String(err) })
        }
      } catch (err) {
        failed.push({ pr, error: err instanceof Error ? err.message : String(err) })
      }
    }

    return {
      success: failed.length === 0,
      shipped,
      skipped,
      failed,
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Resolve linked ticket for a PR.
   */
  private async resolveLinkedTicket(
    prNumber: number,
    headBranch: string,
    projectId: string | undefined,
  ): Promise<Ticket | null> {
    void prNumber
    // The local PMO ticket store was removed (PRLT-1299 / PRLT-1319), so we
    // can no longer scan local tickets by PR metadata. Fall back to the
    // agent_work table (still live) and ticket-ID parsing off the branch.

    // 1. agent_work table — maps branch → ticket ID
    try {
      const row = this.db.prepare(
        `SELECT ticket_id FROM ${PMO_TABLES.agent_work} WHERE branch = ? LIMIT 1`
      ).get(headBranch) as { ticket_id: string } | undefined
      if (row?.ticket_id) {
        const provider = await this.resolveProvider(row.ticket_id, projectId ?? '')
        const res = await provider.getTicket(row.ticket_id)
        if (res.success && res.ticket) return res.ticket
      }
    } catch {
      // Continue
    }

    // 2. Branch name parsing — {ticketId}/{type}/{slug}
    const branchResult = validateBranchName(headBranch)
    if (branchResult.valid && branchResult.parts?.ticketId) {
      const parsedId = branchResult.parts.ticketId
      try {
        const provider = await this.resolveProvider(parsedId, projectId ?? '')
        const res = await provider.getTicket(parsedId)
        if (res.success && res.ticket) return res.ticket
      } catch {
        // Non-fatal — provider may not be configured
      }
    }

    return null
  }

  /**
   * Wait for CI checks to pass with polling.
   */
  async waitForCI(
    prNumber: number,
    shouldWait: boolean,
    cwd?: string,
  ): Promise<{ passed: boolean; message: string }> {
    const maxAttempts = 120
    let attempts = 0

    while (attempts < maxAttempts) {
      const checks = getPRChecks(prNumber, cwd)

      if (checks.length === 0) {
        return { passed: true, message: '' }
      }

      const failedChecks = checks.filter(c => c.conclusion === 'FAILURE')
      const pending = checks.filter(c =>
        !c.conclusion || c.status === 'IN_PROGRESS' || c.status === 'QUEUED'
      )
      const _passed = checks.filter(c =>
        c.conclusion === 'SUCCESS' || c.conclusion === 'SKIPPED'
      )

      if (pending.length === 0) {
        if (failedChecks.length > 0) {
          const names = failedChecks.map(c => c.name).join(', ')
          return { passed: false, message: `CI checks failed: ${names}. Fix before shipping.` }
        }
        return { passed: true, message: '' }
      }

      if (!shouldWait) {
        const names = pending.map(c => c.name).join(', ')
        return {
          passed: false,
          message: `CI checks still running: ${names}. Use --wait to wait, or re-run later.`,
        }
      }

      if (attempts === 0) {
        this.logger.info(`Waiting for CI (${pending.length} pending)...`)
      }
      attempts++
      await new Promise(resolve => setTimeout(resolve, 15_000))
    }

    return { passed: false, message: 'Timed out waiting for CI (30 min).' }
  }

  /**
   * Check if a PR has merge conflicts.
   */
  checkMergeConflicts(prNumber: number, cwd?: string): boolean {
    try {
      const result = execSync(
        `gh pr view ${prNumber} --json mergeable -q .mergeable`,
        { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      ).trim()
      return result === 'CONFLICTING'
    } catch {
      return false
    }
  }

  /**
   * Rebase PR branch onto base and force-push.
   */
  rebaseOntoBase(
    headBranch: string,
    baseBranch: string,
    cwd?: string,
  ): { success: boolean; error?: string } {
    try {
      execSync('git fetch origin', { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
      execSync(`git checkout ${headBranch}`, { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
      execSync(`git rebase origin/${baseBranch}`, { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
      execSync(`git push --force-with-lease origin ${headBranch}`, { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
      return { success: true }
    } catch (error) {
      try {
        execSync('git rebase --abort', { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
      } catch {
        // Ignore abort failures
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown rebase error',
      }
    }
  }

  private buildSearchIds(ticket: Ticket, ticketId: string): string[] {
    const ids: string[] = []
    if (ticket.id) ids.push(ticket.id)

    const externalKey = typeof ticket.metadata?.external_key === 'string'
      ? ticket.metadata.external_key : undefined
    if (externalKey && !ids.includes(externalKey)) ids.push(externalKey)

    const linearId = typeof ticket.metadata?.['linear.identifier'] === 'string'
      ? ticket.metadata['linear.identifier'] : undefined
    if (linearId && !ids.includes(linearId)) ids.push(linearId)

    if (ticketId && !ids.includes(ticketId)) ids.push(ticketId)
    return ids
  }

  private async buildDryRunResult(
    prInfo: PRInfo,
    prNumber: number,
    ticket: Ticket | null,
    method: string,
    cwd?: string,
  ): Promise<ShipWorkResult> {
    const checks = getPRChecks(prNumber, cwd)
    const failedChecks = checks.filter(c => c.conclusion === 'FAILURE' || c.conclusion === 'ERROR')
    const pending = checks.filter(c => !c.conclusion || c.status === 'IN_PROGRESS')

    let ciStatus: 'passed' | 'pending' | 'failed' = 'passed'
    if (failedChecks.length > 0) ciStatus = 'failed'
    else if (pending.length > 0) ciStatus = 'pending'

    const hasConflicts = this.checkMergeConflicts(prNumber, cwd)

    const actions: string[] = []
    if (prInfo.state !== 'MERGED') {
      if (hasConflicts) actions.push('Rebase onto base branch')
      actions.push(`${method} merge PR #${prNumber}`)
    }
    if (ticket) actions.push(`Move ticket ${ticket.id} to Done`)
    if (prInfo.state !== 'MERGED') actions.push(`Delete branch ${prInfo.headBranch}`)

    return {
      success: true,
      ticket: ticket ?? undefined,
      pr: prInfo,
      alreadyMerged: prInfo.state === 'MERGED',
      method,
      dryRunDetails: {
        ticket: ticket ?? undefined,
        pr: prInfo,
        ciStatus,
        hasConflicts,
        actions,
      },
    }
  }
}

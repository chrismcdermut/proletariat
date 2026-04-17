/**
 * PRService
 *
 * Service for PR lifecycle operations: create, merge, check CI, link to tickets.
 * Wraps lib/pr/ functions with ticket-aware orchestration.
 *
 * No oclif, no inquirer, no CLI formatting.
 */

import type Database from 'better-sqlite3'
import {
  createPR as libCreatePR,
  mergePR as libMergePR,
  getPRByNumber,
  getPRForBranch,
  getPRChecks,
  findPRForTicket,
  listOpenPRs,
  generatePRTitle,
  generatePRBody,
  getCommitLog,
  hasBranchBeenPushed,
  pushBranch,
  hasUnpushedCommits,
  isGHInstalled,
  isGHAuthenticated,
} from '../lib/pr/index.js'
import type { PRInfo } from '../lib/pr/index.js'
import { ensureRemoteUpToDate } from '../lib/repos/git.js'
import { validateBranchName } from '../lib/branch/index.js'
import { PMO_TABLES } from '../lib/pmo/schema.js'
import type { Ticket } from '../lib/pmo/types.js'
import type { ProviderStorage, TicketProvider } from '../lib/providers/types.js'
import { ServiceError } from './types.js'
import type {
  CreatePROptions,
  CreatePRServiceResult,
  MergePROptions,
  MergePRServiceResult,
  CheckCIOptions,
  CheckCIResult,
  LinkedTicketResult,
} from './types.js'

/**
 * Storage interface needed by PRService.
 *
 * Ticket reads/writes now route through the TicketProvider layer (PRLT-1319);
 * the storage handle is only used for shared infrastructure
 * (workspace_settings, agent_work, etc.).
 */
export type PRServiceStorage = ProviderStorage

/**
 * Callback for resolving a ticket provider given a ticket ID and project ID.
 * Injected by the CLI command so the service never imports the resolver.
 */
export type ProviderResolver = (ticketId: string, projectId: string) => Promise<TicketProvider>

export class PRService {
  constructor(
    private readonly db: Database.Database,
    private readonly storage: PRServiceStorage,
    private readonly resolveProvider: ProviderResolver,
  ) {}

  /**
   * Create a pull request, optionally linked to a ticket.
   *
   * Handles: title/body generation, branch push, PR creation, ticket metadata update.
   */
  async createPR(options: CreatePROptions = {}): Promise<CreatePRServiceResult> {
    this.requireGH()

    const { ticketId, title, body, baseBranch, draft, cwd } = options

    // Resolve ticket if provided — local PMO store is dead (PRLT-1299), so
    // go through the provider layer.
    let ticket: Ticket | null = null
    if (ticketId) {
      try {
        const provider = await this.resolveProvider(ticketId, '')
        const res = await provider.getTicket(ticketId)
        ticket = (res.success && res.ticket) ? res.ticket : null
      } catch {
        ticket = null
      }
    }

    // Get current branch
    const currentBranch = this.getCurrentBranch(cwd)
    if (!currentBranch) {
      throw new ServiceError('PRECONDITION_FAILED', 'Not on a git branch')
    }

    // Generate title/body
    let prTitle = title
    if (!prTitle) {
      if (ticket) {
        prTitle = generatePRTitle(ticket.id, ticket.title)
      } else {
        const parts = currentBranch.split('/')
        prTitle = parts[parts.length - 1].replace(/-/g, ' ')
      }
    }

    let prBody = body
    if (!prBody && ticket) {
      const commits = getCommitLog(baseBranch || 'main', cwd)
      prBody = generatePRBody({
        ticketId: ticket.id,
        ticketTitle: ticket.title,
        ticketDescription: ticket.description,
        commits: commits.slice(0, 10),
      })
    }

    // Ensure remote is up to date
    ensureRemoteUpToDate(cwd, undefined)

    // Push branch if needed
    if (!hasBranchBeenPushed(currentBranch, cwd)) {
      if (!pushBranch(currentBranch, cwd)) {
        throw new ServiceError('EXTERNAL_FAILURE', 'Failed to push branch to origin')
      }
    } else if (hasUnpushedCommits(currentBranch, cwd)) {
      if (!pushBranch(currentBranch, cwd)) {
        throw new ServiceError('EXTERNAL_FAILURE', 'Failed to push commits to origin')
      }
    }

    // Create PR
    const result = libCreatePR({
      title: prTitle,
      body: prBody,
      base: baseBranch,
      draft,
      cwd,
    })

    if (!result.success) {
      throw new ServiceError('EXTERNAL_FAILURE', `Failed to create PR: ${result.error}`)
    }

    // Link PR to ticket — through the provider layer (PRLT-1319)
    if (ticket && result.url) {
      try {
        const provider = await this.resolveProvider(ticket.id, ticket.projectId || '')
        await provider.updateTicket(ticket.id, {
          metadata: {
            ...ticket.metadata,
            pr_url: result.url,
            pr_number: String(result.number),
          },
        })
      } catch {
        // Non-fatal — PR was created, metadata update is best-effort
      }
    }

    return {
      success: true,
      url: result.url,
      number: result.number,
      ticket: ticket ?? undefined,
    }
  }

  /**
   * Merge a PR by number.
   */
  mergePR(options: MergePROptions): MergePRServiceResult {
    this.requireGH()

    const { prNumber, method = 'squash', deleteBranch = true, admin = false, cwd } = options

    const result = libMergePR(prNumber, {
      method,
      deleteBranch,
      admin,
      cwd,
    })

    if (!result.success) {
      throw new ServiceError(
        'EXTERNAL_FAILURE',
        `Failed to merge PR #${prNumber}: ${result.error}`,
      )
    }

    return {
      success: true,
      method,
    }
  }

  /**
   * Check CI status for a PR.
   */
  checkCI(options: CheckCIOptions): CheckCIResult {
    this.requireGH()

    const checks = getPRChecks(options.prNumber, options.cwd)

    const failed = checks.filter(c => c.conclusion === 'FAILURE' || c.conclusion === 'ERROR')
    const pending = checks.filter(c => c.status === 'IN_PROGRESS' || c.status === 'QUEUED' || !c.conclusion)
    const _passed = checks.filter(c => c.conclusion === 'SUCCESS')

    return {
      passed: failed.length === 0 && pending.length === 0 && checks.length > 0,
      pending: pending.length > 0,
      failed: failed.length > 0,
      checks: checks.map(c => ({
        name: c.name,
        status: c.status,
        conclusion: c.conclusion,
      })),
    }
  }

  /**
   * Get PR info by number.
   */
  getPR(prNumber: number, cwd?: string): PRInfo | null {
    return getPRByNumber(prNumber, cwd)
  }

  /**
   * Get PR info for a branch.
   */
  getPRForBranch(branch: string, cwd?: string): PRInfo | null {
    return getPRForBranch(branch, cwd)
  }

  /**
   * Find PR for a ticket by searching across common patterns.
   */
  findPRForTicket(ticketIds: string[], cwd?: string): PRInfo | null {
    return findPRForTicket(ticketIds, cwd)
  }

  /**
   * List all open PRs.
   */
  listOpenPRs(cwd?: string): PRInfo[] {
    return listOpenPRs(cwd)
  }

  /**
   * Resolve the linked ticket for a PR.
   *
   * Lookup order:
   * 1. PR metadata (pr_number / pr_url) on tickets
   * 2. agent_work table (branch → ticket_id)
   * 3. PR branch name parsing (extract ticket ID from conventional branch format)
   */
  async resolveLinkedTicket(
    prNumber: number,
    headBranch: string,
    projectId?: string,
  ): Promise<LinkedTicketResult> {
    void prNumber
    // The local PMO ticket store was removed (PRLT-1299 / PRLT-1319), so we
    // can no longer scan local tickets by PR metadata. Resolve via the branch
    // → ticket-ID mapping (agent_work + branch name) and then go through the
    // provider to fetch the actual ticket record.

    // 1. agent_work table (still live) — branch → ticket ID
    try {
      const row = this.db.prepare(
        `SELECT ticket_id FROM ${PMO_TABLES.agent_work} WHERE branch = ? LIMIT 1`
      ).get(headBranch) as { ticket_id: string } | undefined
      if (row?.ticket_id) {
        const provider = await this.resolveProvider(row.ticket_id, projectId ?? '')
        const res = await provider.getTicket(row.ticket_id)
        if (res.success && res.ticket) return { ticket: res.ticket, source: 'agent_work' }
      }
    } catch {
      // agent_work lookup failed, continue
    }

    // 2. Parse ticket ID from branch name
    const branchResult = validateBranchName(headBranch)
    if (branchResult.valid && branchResult.parts?.ticketId) {
      const parsedTicketId = branchResult.parts.ticketId
      try {
        const provider = await this.resolveProvider(parsedTicketId, projectId ?? '')
        const res = await provider.getTicket(parsedTicketId)
        if (res.success && res.ticket) return { ticket: res.ticket, source: 'branch_name' }
      } catch {
        // Non-fatal — provider may not be configured
      }
    }

    return { ticket: null }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private requireGH(): void {
    if (!isGHInstalled()) {
      throw new ServiceError(
        'PRECONDITION_FAILED',
        'GitHub CLI (gh) is not installed. Install it: https://cli.github.com',
      )
    }
    if (!isGHAuthenticated()) {
      throw new ServiceError(
        'PRECONDITION_FAILED',
        'GitHub CLI is not authenticated. Run: gh auth login',
      )
    }
  }

  private getCurrentBranch(cwd?: string): string | null {
    try {
      const { execSync } = require('node:child_process')
      return execSync('git rev-parse --abbrev-ref HEAD', {
        encoding: 'utf-8',
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim() || null
    } catch {
      return null
    }
  }
}

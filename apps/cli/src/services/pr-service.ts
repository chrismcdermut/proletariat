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
import type { ProviderStorage } from '../lib/providers/types.js'
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
 */
export interface PRServiceStorage extends ProviderStorage {
  listTickets(projectId: string | undefined, filter?: unknown): Promise<Ticket[]>
  updateTicket(id: string, changes: Partial<Ticket>): Promise<Ticket>
}

export class PRService {
  constructor(
    private readonly db: Database.Database,
    private readonly storage: PRServiceStorage,
  ) {}

  /**
   * Create a pull request, optionally linked to a ticket.
   *
   * Handles: title/body generation, branch push, PR creation, ticket metadata update.
   */
  async createPR(options: CreatePROptions = {}): Promise<CreatePRServiceResult> {
    this.requireGH()

    const { ticketId, title, body, baseBranch, draft, cwd } = options

    // Resolve ticket if provided
    let ticket: Ticket | null = null
    if (ticketId) {
      ticket = await this.storage.getTicket(ticketId)
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
    ensureRemoteUpToDate(cwd)

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

    // Link PR to ticket
    if (ticket && result.url) {
      try {
        await this.storage.updateTicket(ticket.id, {
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
    // 1. Find by PR metadata on tickets
    const allTickets = await this.storage.listTickets(projectId)
    const byMetadata = allTickets.find(t =>
      t.metadata?.pr_number === String(prNumber) ||
      t.metadata?.pr_url?.endsWith(`/pull/${prNumber}`) ||
      t.metadata?.pr_url?.endsWith(`/${prNumber}`)
    )
    if (byMetadata) return { ticket: byMetadata, source: 'metadata' }

    // 2. Look up from agent_work table by branch name
    try {
      const row = this.db.prepare(
        `SELECT ticket_id FROM ${PMO_TABLES.agent_work} WHERE branch = ? LIMIT 1`
      ).get(headBranch) as { ticket_id: string } | undefined
      if (row?.ticket_id) {
        const ticket = await this.storage.getTicket(row.ticket_id)
        if (ticket) return { ticket, source: 'agent_work' }
      }
    } catch {
      // agent_work lookup failed, continue
    }

    // 3. Parse ticket ID from branch name
    const branchResult = validateBranchName(headBranch)
    if (branchResult.valid && branchResult.parts?.ticketId) {
      const parsedTicketId = branchResult.parts.ticketId

      // Try direct lookup
      const directTicket = await this.storage.getTicket(parsedTicketId)
      if (directTicket) return { ticket: directTicket, source: 'branch_name' }

      // Search by external_key
      const byExternalKey = allTickets.find(t =>
        t.metadata?.external_key === parsedTicketId
      )
      if (byExternalKey) return { ticket: byExternalKey, source: 'branch_name' }
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

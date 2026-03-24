/**
 * Orchestrate External Event Poller
 *
 * Polls external systems (GitHub, database) and fires orchestrate events
 * when conditions are detected. This bridges external state changes into
 * the internal event bus.
 *
 * Supported polls:
 * - GitHub: open PR CI status, merge conflicts
 * - Database: ready tickets, agent lifecycle states
 */

import { execSync } from 'node:child_process'
import type Database from 'better-sqlite3'
import { isGHInstalled, isGHAuthenticated, listOpenPRs, getPRChecks, getPRByNumber } from '../pr/index.js'
import type { OrchestrateEngine } from './engine.js'

// =============================================================================
// Types
// =============================================================================

export interface PollerOptions {
  engine: OrchestrateEngine
  db: Database.Database
  log: (msg: string) => void
  /** Working directory for gh CLI commands */
  cwd?: string
}

interface TrackedPR {
  number: number
  lastCIState: 'pending' | 'success' | 'failure' | 'unknown'
  lastMergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
}

// =============================================================================
// Poller
// =============================================================================

export class OrchestratePoller {
  private engine: OrchestrateEngine
  private db: Database.Database
  private log: (msg: string) => void
  private cwd?: string

  /** Tracks known PR state to detect transitions. */
  private trackedPRs = new Map<number, TrackedPR>()

  /** Track which tickets we've already fired on_ticket_ready for. */
  private firedReadyTickets = new Set<string>()

  /** Track known agent lifecycle states. */
  private lastAgentStates = new Map<string, string>()

  private ghAvailable: boolean | null = null

  constructor(options: PollerOptions) {
    this.engine = options.engine
    this.db = options.db
    this.log = options.log
    this.cwd = options.cwd
  }

  /**
   * Run one poll cycle. Called by the daemon on each interval.
   */
  async poll(): Promise<void> {
    await this.pollReadyTickets()
    await this.pollAgentLifecycle()
    await this.pollGitHubPRs()
  }

  // ===========================================================================
  // Ticket Polling
  // ===========================================================================

  /**
   * Check for tickets in "Ready" (todo) status with no active agent.
   * Fires on_ticket_ready for each.
   */
  private async pollReadyTickets(): Promise<void> {
    try {
      const readyTickets = this.db.prepare(`
        SELECT t.id, t.title
        FROM pmo_tickets t
        JOIN pmo_workflow_statuses ws ON t.status_id = ws.id
        WHERE ws.category = 'todo'
          AND t.assignee IS NULL
          AND t.id NOT IN (
            SELECT ticket_id FROM agent_work WHERE status IN ('starting', 'running')
          )
        LIMIT 10
      `).all() as Array<{ id: string; title: string }>

      for (const ticket of readyTickets) {
        if (this.firedReadyTickets.has(ticket.id)) continue
        this.firedReadyTickets.add(ticket.id)

        this.log(`[poll] Detected ready ticket: ${ticket.id}`)
        await this.engine.fireEvent('on_ticket_ready', {
          event: 'on_ticket_ready',
          ticket: ticket.id,
        })
      }
    } catch {
      // Non-fatal polling error
    }
  }

  // ===========================================================================
  // Agent Lifecycle Polling
  // ===========================================================================

  /**
   * Check agent_work table for lifecycle state changes.
   * Fires on_agent_died, on_agent_completed, on_agent_idle as appropriate.
   */
  private async pollAgentLifecycle(): Promise<void> {
    try {
      const agents = this.db.prepare(`
        SELECT id, ticket_id, agent_name, status, lifecycle_state, container_id, last_heartbeat
        FROM agent_work
        WHERE status IN ('starting', 'running', 'error')
        LIMIT 50
      `).all() as Array<{
        id: string
        ticket_id: string
        agent_name: string
        status: string
        lifecycle_state: string | null
        container_id: string | null
        last_heartbeat: string | null
      }>

      for (const agent of agents) {
        const prevState = this.lastAgentStates.get(agent.id)
        const currentState = agent.lifecycle_state || agent.status

        if (prevState === currentState) continue
        this.lastAgentStates.set(agent.id, currentState)

        // Skip the first observation (we only fire on transitions)
        if (!prevState) continue

        const ctx = {
          event: '',
          ticket: agent.ticket_id,
          agent: agent.agent_name,
          container: agent.container_id || undefined,
          executionId: agent.id,
        }

        if (currentState === 'died' || (agent.status === 'error' && prevState !== 'error')) {
          this.log(`[poll] Agent died: ${agent.agent_name} (${agent.ticket_id})`)
          await this.engine.fireEvent('on_agent_died', { ...ctx, event: 'on_agent_died' })
        } else if (currentState === 'completed') {
          this.log(`[poll] Agent completed: ${agent.agent_name} (${agent.ticket_id})`)
          await this.engine.fireEvent('on_agent_completed', { ...ctx, event: 'on_agent_completed' })
        } else if (currentState === 'idle') {
          this.log(`[poll] Agent idle: ${agent.agent_name} (${agent.ticket_id})`)
          await this.engine.fireEvent('on_agent_idle', { ...ctx, event: 'on_agent_idle' })
        }
      }

      // Detect idle agents by heartbeat timeout (5 minutes)
      try {
        const idleAgents = this.db.prepare(`
          SELECT id, ticket_id, agent_name, container_id
          FROM agent_work
          WHERE status = 'running'
            AND last_heartbeat IS NOT NULL
            AND datetime(last_heartbeat) < datetime('now', '-5 minutes')
            AND (lifecycle_state IS NULL OR lifecycle_state = 'healthy')
          LIMIT 10
        `).all() as Array<{ id: string; ticket_id: string; agent_name: string; container_id: string | null }>

        for (const agent of idleAgents) {
          const prevState = this.lastAgentStates.get(agent.id)
          if (prevState === 'idle') continue
          this.lastAgentStates.set(agent.id, 'idle')

          if (prevState) {
            this.log(`[poll] Agent idle (heartbeat timeout): ${agent.agent_name}`)
            await this.engine.fireEvent('on_agent_idle', {
              event: 'on_agent_idle',
              ticket: agent.ticket_id,
              agent: agent.agent_name,
              container: agent.container_id || undefined,
              executionId: agent.id,
            })
          }
        }
      } catch {
        // last_heartbeat column might not exist yet
      }
    } catch {
      // Non-fatal polling error
    }
  }

  // ===========================================================================
  // GitHub PR Polling
  // ===========================================================================

  /**
   * Check GitHub PRs for CI completion and merge conflicts.
   * Fires on_ci_green, on_ci_failed, on_pr_conflicting, on_pr_merged.
   */
  private async pollGitHubPRs(): Promise<void> {
    if (this.ghAvailable === null) {
      this.ghAvailable = isGHInstalled() && isGHAuthenticated()
    }
    if (!this.ghAvailable) return

    try {
      const openPRs = listOpenPRs(this.cwd)

      for (const pr of openPRs) {
        const tracked = this.trackedPRs.get(pr.number)
        const ticketId = this.extractTicketFromBranch(pr.headBranch)

        // --- CI Status ---
        const checks = getPRChecks(pr.number, this.cwd)
        let ciState: TrackedPR['lastCIState'] = 'unknown'

        if (checks.length > 0) {
          const allDone = checks.every(c => c.status === 'COMPLETED' || c.conclusion)
          if (allDone) {
            const allPassed = checks.every(c =>
              c.conclusion === 'SUCCESS' || c.conclusion === 'NEUTRAL' || c.conclusion === 'SKIPPED'
            )
            ciState = allPassed ? 'success' : 'failure'
          } else {
            ciState = 'pending'
          }
        }

        // Fire CI events on state transition
        if (tracked && ciState !== tracked.lastCIState && ciState !== 'pending' && ciState !== 'unknown') {
          if (ciState === 'success') {
            this.log(`[poll] CI green: PR #${pr.number}`)
            await this.engine.fireEvent('on_ci_green', {
              event: 'on_ci_green',
              pr: pr.number,
              branch: pr.headBranch,
              ticket: ticketId,
              prUrl: pr.url,
            })
          } else if (ciState === 'failure') {
            this.log(`[poll] CI failed: PR #${pr.number}`)
            await this.engine.fireEvent('on_ci_failed', {
              event: 'on_ci_failed',
              pr: pr.number,
              branch: pr.headBranch,
              ticket: ticketId,
              prUrl: pr.url,
            })
          }
        }

        // --- Merge Conflicts ---
        let mergeable: TrackedPR['lastMergeable'] = 'UNKNOWN'
        try {
          const mergeableResult = execSync(
            `gh pr view ${pr.number} --json mergeable -q .mergeable`,
            { cwd: this.cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
          ).trim()
          if (mergeableResult === 'CONFLICTING') {
            mergeable = 'CONFLICTING'
          } else if (mergeableResult === 'MERGEABLE') {
            mergeable = 'MERGEABLE'
          }
        } catch {
          // gh command failed
        }

        if (
          tracked &&
          mergeable === 'CONFLICTING' &&
          tracked.lastMergeable !== 'CONFLICTING'
        ) {
          this.log(`[poll] PR conflicting: PR #${pr.number}`)
          await this.engine.fireEvent('on_pr_conflicting', {
            event: 'on_pr_conflicting',
            pr: pr.number,
            branch: pr.headBranch,
            ticket: ticketId,
            prUrl: pr.url,
          })
        }

        // Update tracking
        this.trackedPRs.set(pr.number, {
          number: pr.number,
          lastCIState: ciState,
          lastMergeable: mergeable,
        })
      }

      // Detect merged/closed PRs (were tracked but no longer open)
      for (const [prNum, tracked] of this.trackedPRs) {
        if (!openPRs.some(p => p.number === prNum)) {
          // PR was open, now it's not — check if merged
          const pr = getPRByNumber(prNum, this.cwd)
          if (pr?.state === 'MERGED') {
            const ticketId = this.extractTicketFromBranch(pr.headBranch)
            this.log(`[poll] PR merged: PR #${prNum}`)
            await this.engine.fireEvent('on_pr_merged', {
              event: 'on_pr_merged',
              pr: prNum,
              branch: pr.headBranch,
              ticket: ticketId,
              prUrl: pr.url,
            })
          }
          this.trackedPRs.delete(prNum)
        }
      }
    } catch {
      // Non-fatal GitHub polling error
    }
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  /**
   * Extract ticket ID from branch name.
   * Branch format: {ticketId}/{type}/{owner}/{agent}/{description}
   */
  private extractTicketFromBranch(branch: string): string | undefined {
    // Match patterns like PRLT-123/... or TKT-456/...
    const match = branch.match(/^([A-Z]+-\d+|TKT-\d+)\//)
    return match ? match[1] : undefined
  }
}

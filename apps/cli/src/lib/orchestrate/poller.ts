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
import * as path from 'node:path'
import type Database from 'better-sqlite3'
import { isGHInstalled, isGHAuthenticated, listOpenPRs, getPRChecks, getPRByNumber, getPRReviewDecision } from '../pr/index.js'
import type { PRReviewDecision } from '../pr/index.js'
import { runSyncCycle, type SyncReport } from '../sync/engine.js'
import { SQLiteStorage } from '../pmo/storage-sqlite.js'
import type { OrchestrateEngine } from './engine.js'
import { getWorkflowConfig } from '../work-lifecycle/settings.js'

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
  lastReviewDecision: PRReviewDecision
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

  /** Track tickets with active conflict resolution to prevent duplicate agent spawns. */
  private activeConflictResolutions = new Set<string>()

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
    await this.pollBoardReconciliation()
  }

  // ===========================================================================
  // Ticket Polling
  // ===========================================================================

  /**
   * Check for tickets in the configured "ready" status with no active agent.
   * Fires on_ticket_ready for each.
   *
   * Uses the configured ready/planned column name from pmo_settings.
   * Falls back to category-based matching if no config is available.
   */
  private async pollReadyTickets(): Promise<void> {
    try {
      // Resolve configured ready status name
      let readyStatusName: string | null = null
      try {
        const config = getWorkflowConfig(this.db)
        readyStatusName = config.planned
      } catch {
        // pmo_settings may not exist yet
      }

      // PRLT-1299: Use ticket_refs instead of dead pmo_tickets/pmo_workflow_statuses tables
      const readyTickets = readyStatusName
        ? this.db.prepare(`
            SELECT tr.id, tr.title
            FROM ticket_refs tr
            WHERE LOWER(tr.status) = LOWER(?)
              AND tr.assignee IS NULL
              AND tr.id NOT IN (
                SELECT ticket_id FROM agent_work WHERE status IN ('starting', 'running')
              )
            LIMIT 10
          `).all(readyStatusName) as Array<{ id: string; title: string }>
        : this.db.prepare(`
            SELECT tr.id, tr.title
            FROM ticket_refs tr
            WHERE tr.category = 'unstarted'
              AND tr.assignee IS NULL
              AND tr.id NOT IN (
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

        // --- Review Decision ---
        const reviewDecision = getPRReviewDecision(pr.number, this.cwd)
        if (tracked && reviewDecision && reviewDecision !== tracked.lastReviewDecision) {
          if (reviewDecision === 'APPROVED') {
            this.log(`[poll] Review approved: PR #${pr.number}`)
            await this.engine.fireEvent('on_review_approved', {
              event: 'on_review_approved',
              pr: pr.number,
              branch: pr.headBranch,
              ticket: ticketId,
              prUrl: pr.url,
            })
          } else if (reviewDecision === 'CHANGES_REQUESTED') {
            this.log(`[poll] Changes requested: PR #${pr.number}`)
            await this.engine.fireEvent('on_changes_requested', {
              event: 'on_changes_requested',
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
          // gh command failed — preserve previous mergeable state to avoid
          // CONFLICTING→UNKNOWN→CONFLICTING re-fire cycles
          mergeable = tracked?.lastMergeable ?? 'UNKNOWN'
        }

        // Clear conflict resolution tracking when PR becomes mergeable
        if (mergeable === 'MERGEABLE' && ticketId) {
          this.activeConflictResolutions.delete(ticketId)
        }

        // Fire on_pr_conflicting on first observation or when transitioning to CONFLICTING
        const isNewConflict = mergeable === 'CONFLICTING' && (!tracked || tracked.lastMergeable !== 'CONFLICTING')
        if (isNewConflict) {
          // Dedup: skip if we already have an active conflict resolution for this ticket
          if (ticketId && this.activeConflictResolutions.has(ticketId)) {
            this.log(`[poll] PR #${pr.number} conflicting but resolution already active for ${ticketId}, skipping`)
          } else {
            if (ticketId) {
              this.activeConflictResolutions.add(ticketId)
            }
            this.log(`[poll] PR conflicting: PR #${pr.number}`)
            await this.engine.fireEvent('on_pr_conflicting', {
              event: 'on_pr_conflicting',
              pr: pr.number,
              branch: pr.headBranch,
              ticket: ticketId,
              prUrl: pr.url,
            })
          }
        }

        // Update tracking
        this.trackedPRs.set(pr.number, {
          number: pr.number,
          lastCIState: ciState,
          lastMergeable: mergeable,
          lastReviewDecision: reviewDecision,
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
  // Board Reconciliation
  // ===========================================================================

  /**
   * Run board reconciliation — deterministic rules that sync ticket state
   * from GitHub without LLM involvement.
   *
   * Rules:
   * 1. PR merged → ticket to Done
   * 2. PR opened → ticket to Review
   * 3. Agent spawned → ticket to In Progress
   * 4. Detect duplicate tickets
   * 5. Flag stale Triage tickets that match merged PRs
   */
  private async pollBoardReconciliation(): Promise<void> {
    try {
      // Get the workspace db path from the database file path
      const dbPath = this.getDbPath()
      if (!dbPath) return

      const storage = new SQLiteStorage(dbPath)

      // PRLT-1299: Use pmo_projects if it exists, otherwise use ticket_refs project_id
      let projects: Array<{ id: string }> = []
      try {
        projects = this.db.prepare(`
          SELECT id FROM pmo_projects WHERE is_archived = 0
          LIMIT 20
        `).all() as Array<{ id: string }>
      } catch {
        // pmo_projects may not exist — fall back to distinct project_ids from ticket_refs
        try {
          projects = this.db.prepare(`
            SELECT DISTINCT project_id AS id FROM ticket_refs
            WHERE project_id IS NOT NULL
            LIMIT 20
          `).all() as Array<{ id: string }>
        } catch {
          // ticket_refs may not exist either — skip reconciliation
        }
      }

      for (const project of projects) {
        try {
          const report = await runSyncCycle(this.db, storage as any, project.id, {
            cwd: this.cwd,
            log: (msg: string) => this.log(`[reconcile] ${msg}`),
            dryRun: false,
          })

          // Fire events for applied reconciliation actions
          await this.fireReconciliationEvents(report)
        } catch (err) {
          this.log(`[reconcile] Error reconciling project ${project.id}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    } catch {
      // Non-fatal board reconciliation error
    }
  }

  /**
   * Fire orchestrate events based on reconciliation results.
   * This bridges deterministic reconciliation into the event-driven hook system.
   */
  private async fireReconciliationEvents(report: SyncReport): Promise<void> {
    for (const action of report.applied) {
      try {
        switch (action.type) {
          case 'move_to_done':
            this.log(`[reconcile] Fired on_pr_merged for ${action.ticketId}`)
            await this.engine.fireEvent('on_pr_merged', {
              event: 'on_pr_merged',
              ticket: action.ticketId,
            })
            break

          case 'move_to_review':
            this.log(`[reconcile] Fired on_pr_opened for ${action.ticketId}`)
            await this.engine.fireEvent('on_pr_opened', {
              event: 'on_pr_opened',
              ticket: action.ticketId,
            })
            break

          case 'move_to_in_progress':
            this.log(`[reconcile] Fired on_agent_spawned for ${action.ticketId}`)
            await this.engine.fireEvent('on_agent_spawned', {
              event: 'on_agent_spawned',
              ticket: action.ticketId,
            })
            break

          case 'flag_stale':
          case 'flag_stale_triage':
            this.log(`[reconcile] Stale: ${action.ticketId} — ${action.reason}`)
            break

          case 'flag_duplicate':
            this.log(`[reconcile] Duplicate: ${action.ticketId} — ${action.reason}`)
            break

          case 'move_to_backlog':
            this.log(`[reconcile] Moved to backlog: ${action.ticketId} — ${action.reason}`)
            break
        }
      } catch (err) {
        this.log(`[reconcile] Error firing event for ${action.ticketId}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // Log failures
    for (const failure of report.failed) {
      this.log(`[reconcile] Failed: ${failure.action.ticketId} — ${failure.error}`)
    }
  }

  /**
   * Get the database file path from the current database connection.
   * Derives it from cwd/.proletariat/workspace.db.
   */
  private getDbPath(): string | null {
    if (this.cwd) {
      return path.join(this.cwd, '.proletariat', 'workspace.db')
    }
    return null
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  /**
   * Extract ticket ID from branch name.
   * Branch format: {ticketId}/{type}/{description}
   */
  private extractTicketFromBranch(branch: string): string | undefined {
    // Match patterns like PRLT-123/... or TKT-456/...
    const match = branch.match(/^([A-Z]+-\d+|TKT-\d+)\//)
    return match ? match[1] : undefined
  }
}

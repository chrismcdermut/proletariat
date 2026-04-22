/**
 * Simple Poller — Stateless state reporter for the `prlt watch` command.
 *
 * Polls GitHub PRs, Linear/board tickets, and running agents/containers.
 * Returns the FULL current state on every poll cycle as a human-readable
 * report. No diffing, no baseline tracking.
 *
 * The orchestrator is an LLM — it receives the full state snapshot each
 * cycle and determines what changed and what to do. This eliminates the
 * entire class of diff/baseline bugs (PRLT-1346).
 */

import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type Database from 'better-sqlite3'
import { isGHInstalled, isGHAuthenticated, listOpenPRs, getPRChecks } from '../pr/index.js'
import {
  type AgentHealthState,
  detectState,
  countByState,
  formatHealthSummary,
} from '../session/health-detector.js'
import {
  getHostTmuxSessionNames,
  getContainerTmuxSessionMap,
  findSessionForExecution,
  findContainerSessionsByPrefix,
  captureTmuxPane,
} from '../execution/session-utils.js'
import { getWorkflowConfig } from '../work-lifecycle/settings.js'
import { SQLiteStorage } from '../pmo/storage-sqlite.js'
import { resolveProjectProvider } from '../providers/resolver.js'

// =============================================================================
// Types
// =============================================================================

/** A ticket from the board with full status info for board state reporting. */
export interface BoardTicketInfo {
  id: string
  title: string
  statusName: string
  statusCategory?: string
  assignee?: string
  updatedAt?: Date
}

export interface SimplePollerOptions {
  db: Database.Database
  log: (msg: string) => void
  /** Working directory for gh CLI commands */
  cwd?: string
  /**
   * Override board ticket fetching for testing.
   * When provided, replaces the default live-provider query.
   * Returns all tickets with status info for full board state reporting.
   */
  fetchBoardTickets?: () => Promise<BoardTicketInfo[]>
  /**
   * @deprecated Use fetchBoardTickets instead. Kept for backward compatibility.
   * When fetchBoardTickets is not provided, falls back to this (ready-only mode).
   */
  fetchReadyTickets?: (readyNames: Set<string>) => Promise<Array<{ id: string; title: string }>>
}

/** A single item in the state report. */
export interface StateItem {
  category: 'github' | 'board' | 'agents' | 'anomaly'
  summary: string
  /** Health state for agent items (from tmux pane inspection). */
  healthState?: AgentHealthState
}

/** Column count entry for the board state summary. */
export interface ColumnCount {
  statusName: string
  count: number
}

/** Anomaly types detected during board state analysis. */
export type AnomalyType = 'no_agent' | 'merged_pr' | 'stale'

/** Result of a poll cycle. Message is always a formatted state report. */
export interface PollResult {
  items: StateItem[]
  message: string
}

// Keep old name as alias for backward compatibility in re-exports
export type PollChange = StateItem

// =============================================================================
// Simple Poller
// =============================================================================

export class SimplePoller {
  private db: Database.Database
  private log: (msg: string) => void
  private cwd?: string
  private fetchBoardTicketsFn?: () => Promise<BoardTicketInfo[]>
  private fetchReadyTicketsFn?: (readyNames: Set<string>) => Promise<Array<{ id: string; title: string }>>

  /** Git repo directories to poll for PRs. Resolved from cwd on construction. */
  private repoDirs: string[]

  /** Whether GitHub CLI is available. */
  private ghAvailable: boolean | null = null

  constructor(options: SimplePollerOptions) {
    this.db = options.db
    this.log = options.log
    this.cwd = options.cwd
    this.fetchBoardTicketsFn = options.fetchBoardTickets
    this.fetchReadyTicketsFn = options.fetchReadyTickets
    this.repoDirs = SimplePoller.resolveRepoDirs(options.cwd, options.log)
  }

  /**
   * Resolve git repo directories to poll for PRs.
   *
   * If cwd is itself a git repo, use it directly.
   * If cwd has a repos/ subdirectory (HQ workspace), scan for git repos inside.
   * Otherwise, return empty (no GitHub polling possible).
   */
  static resolveRepoDirs(cwd?: string, log?: (msg: string) => void): string[] {
    if (!cwd) return []

    // Check if cwd itself is a git repo
    if (SimplePoller.isGitRepo(cwd)) {
      return [cwd]
    }

    // HQ workspace: check for repos/ subdirectory
    const reposDir = path.join(cwd, 'repos')
    if (fs.existsSync(reposDir)) {
      try {
        const entries = fs.readdirSync(reposDir, { withFileTypes: true })
        const dirs = entries
          .filter(e => e.isDirectory())
          .map(e => path.join(reposDir, e.name))
          .filter(d => SimplePoller.isGitRepo(d))

        if (dirs.length > 0) {
          log?.(`[watch] Discovered ${dirs.length} repo(s) in ${reposDir}`)
          return dirs
        }
      } catch {
        // Non-fatal
      }
    }

    log?.(`[watch] Warning: ${cwd} is not a git repo and no repos/ subdirectory found. GitHub polling disabled.`)
    return []
  }

  /** Check if a directory is inside a git repository. */
  private static isGitRepo(dir: string): boolean {
    try {
      execSync('git rev-parse --git-dir', {
        cwd: dir,
        stdio: ['pipe', 'pipe', 'pipe'],
        encoding: 'utf-8',
      })
      return true
    } catch {
      return false
    }
  }

  /**
   * Run one poll cycle. Returns full current state as a report.
   * Every call gathers fresh state — no diffing, no baseline.
   */
  async poll(): Promise<PollResult> {
    const items: StateItem[] = []

    const githubItems = this.gatherGitHubPRState()
    items.push(...githubItems)
    items.push(...this.gatherAgentState())
    items.push(...await this.gatherBoardState(githubItems))

    const message = this.formatStateMessage(items)
    return { items, message }
  }

  // ===========================================================================
  // GitHub PR State
  // ===========================================================================

  private gatherGitHubPRState(): StateItem[] {
    if (this.ghAvailable === null) {
      this.ghAvailable = isGHInstalled() && isGHAuthenticated()
    }
    if (!this.ghAvailable) return []
    if (this.repoDirs.length === 0) return []

    const items: StateItem[] = []

    for (const repoDir of this.repoDirs) {
      try {
        const openPRs = listOpenPRs(repoDir)
        this.log(`[watch] Polled ${openPRs.length} open PR(s) from ${path.basename(repoDir)}`)

        for (const pr of openPRs) {
          const repoName = path.basename(repoDir)
          const ticketId = this.extractTicketFromBranch(pr.headBranch)

          // Get CI status
          let ciState: 'pending' | 'success' | 'failure' | 'unknown' = 'unknown'
          try {
            const checks = getPRChecks(pr.number, repoDir)
            if (checks.length > 0) {
              const allDone = checks.every(c => c.status === 'COMPLETED' || c.conclusion)
              if (allDone) {
                const allPassed = checks.every(c =>
                  c.conclusion === 'SUCCESS' || c.conclusion === 'NEUTRAL' || c.conclusion === 'SKIPPED',
                )
                ciState = allPassed ? 'success' : 'failure'
              } else {
                ciState = 'pending'
              }
            }
          } catch {
            // Non-fatal
          }

          // Get mergeable state
          let mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN' = 'UNKNOWN'
          try {
            const result = execSync(
              `gh pr view ${pr.number} --json mergeable -q .mergeable`,
              { cwd: repoDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
            ).trim()
            if (result === 'CONFLICTING') mergeable = 'CONFLICTING'
            else if (result === 'MERGEABLE') mergeable = 'MERGEABLE'
          } catch {
            // Non-fatal
          }

          // Get review decision
          let reviewDecision: string | null = null
          try {
            const result = execSync(
              `gh pr view ${pr.number} --json reviewDecision -q .reviewDecision`,
              { cwd: repoDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
            ).trim()
            if (result) reviewDecision = result
          } catch {
            // Non-fatal
          }

          // Build state summary
          const summary = SimplePoller.formatPRSummary({
            repoName,
            prNumber: pr.number,
            title: pr.title,
            ticketId,
            ciState,
            mergeable,
            reviewDecision,
          })

          items.push({ category: 'github', summary })
        }
      } catch (err) {
        this.log(`[watch] GitHub poll error for ${path.basename(repoDir)}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    return items
  }

  // ===========================================================================
  // Agent / Container State
  // ===========================================================================

  private gatherAgentState(): StateItem[] {
    const items: StateItem[] = []

    try {
      const agents = this.db.prepare(`
        SELECT id, ticket_id, agent_name, status, lifecycle_state, container_id, session_id, environment
        FROM agent_work
        WHERE status IN ('starting', 'running', 'error', 'completed', 'failed', 'stopped')
        ORDER BY started_at DESC
        LIMIT 50
      `).all() as Array<{
        id: string
        ticket_id: string
        agent_name: string
        status: string
        lifecycle_state: string | null
        container_id: string | null
        session_id: string | null
        environment: string | null
      }>

      // Discover live tmux sessions for pane-based state detection
      let hostSessions: string[] = []
      let containerSessionMap: Map<string, string[]> = new Map()
      try {
        hostSessions = getHostTmuxSessionNames()
        containerSessionMap = getContainerTmuxSessionMap()
      } catch {
        // tmux/docker not available — fall back to DB state
      }

      for (const agent of agents) {
        const label = `${agent.agent_name} (${agent.ticket_id})`
        const isContainer = agent.environment === 'devcontainer' || agent.environment === 'docker'

        // For terminal agents (starting/running), try to detect state via tmux pane
        let healthState: AgentHealthState = 'UNKNOWN'
        if (agent.status === 'starting' || agent.status === 'running') {
          healthState = this.detectAgentHealth(
            agent.ticket_id,
            agent.agent_name,
            agent.session_id,
            isContainer ? (agent.container_id ?? undefined) : undefined,
            isContainer,
            hostSessions,
            containerSessionMap,
          )
        } else if (agent.status === 'completed') {
          healthState = 'DONE'
        } else if (agent.status === 'error' || agent.status === 'failed') {
          healthState = 'IDLE' // terminal state — not actively working
        } else if (agent.status === 'stopped') {
          healthState = 'IDLE'
        }

        items.push({
          category: 'agents',
          summary: `${label}: ${healthState}`,
          healthState,
        })
      }
    } catch {
      // Non-fatal DB error
    }

    return items
  }

  /**
   * Detect an agent's health state by capturing its tmux pane content.
   * Falls back to UNKNOWN if the tmux session can't be found.
   */
  private detectAgentHealth(
    ticketId: string,
    agentName: string,
    sessionId: string | null,
    containerId: string | undefined,
    isContainer: boolean,
    hostSessions: string[],
    containerSessionMap: Map<string, string[]>,
  ): AgentHealthState {
    try {
      let actualSessionId: string | null = sessionId

      if (isContainer && containerId) {
        const containerSessions = findContainerSessionsByPrefix(containerSessionMap, containerId)
        if (actualSessionId && containerSessions.includes(actualSessionId)) {
          // exact match
        } else {
          actualSessionId = findSessionForExecution(ticketId, agentName, containerSessions)
        }
        if (actualSessionId) {
          const pane = captureTmuxPane(actualSessionId, 10, containerId)
          return detectState(pane)
        }
      } else {
        if (actualSessionId && hostSessions.includes(actualSessionId)) {
          // exact match
        } else {
          actualSessionId = findSessionForExecution(ticketId, agentName, hostSessions)
        }
        if (actualSessionId) {
          const pane = captureTmuxPane(actualSessionId, 10)
          return detectState(pane)
        }
      }
    } catch {
      // Non-fatal — fall through to UNKNOWN
    }
    return 'UNKNOWN'
  }

  // ===========================================================================
  // Board State (PRLT-1358: full board state, not just ready tickets)
  // ===========================================================================

  /** Status names considered "ready" for unassigned ticket reporting. */
  private getReadyNames(): Set<string> {
    const readyNames = new Set(['ready', 'planned', 'todo'])
    try {
      const config = getWorkflowConfig(this.db)
      readyNames.add(config.planned.toLowerCase())
    } catch {
      // pmo_settings may not exist yet
    }
    return readyNames
  }

  /** Get ticket IDs that have active agents (starting or running). */
  private getActiveAgentTicketIds(): Set<string> {
    try {
      return new Set(
        (this.db.prepare(
          `SELECT ticket_id FROM agent_work WHERE status IN ('starting', 'running')`,
        ).all() as Array<{ ticket_id: string }>).map(r => r.ticket_id),
      )
    } catch {
      return new Set()
    }
  }

  /**
   * Gather full board state from the live provider (PRLT-1358).
   * Reports ticket counts by column and flags anomalies:
   * - Tickets In Progress with no agent
   * - Tickets in Review with merged PRs
   * - Tickets stuck in a column for >24h
   */
  private async gatherBoardState(githubItems: StateItem[]): Promise<StateItem[]> {
    const items: StateItem[] = []

    try {
      const readyNames = this.getReadyNames()
      const activeAgentTickets = this.getActiveAgentTicketIds()

      // Fetch tickets — prefer full board, fall back to ready-only for backward compat
      let allTickets: BoardTicketInfo[]
      if (this.fetchBoardTicketsFn) {
        allTickets = await this.fetchBoardTicketsFn()
      } else if (this.fetchReadyTicketsFn) {
        // Legacy path: only ready tickets available
        const readyTickets = await this.fetchReadyTicketsFn(readyNames)
        allTickets = readyTickets.map(t => ({
          id: t.id,
          title: t.title,
          statusName: 'Ready',
          statusCategory: 'unstarted',
          assignee: undefined,
        }))
      } else {
        allTickets = await this.fetchBoardTicketsFromProvider()
      }

      // Exclude terminal states from active board reporting
      const terminalCategories = new Set(['completed', 'canceled'])
      const activeTickets = allTickets.filter(
        t => !terminalCategories.has(t.statusCategory ?? ''),
      )

      // Group by status name for column counts
      const columnCounts = new Map<string, number>()
      for (const ticket of activeTickets) {
        const status = ticket.statusName || 'Unknown'
        columnCounts.set(status, (columnCounts.get(status) ?? 0) + 1)
      }

      // Emit board summary item
      if (columnCounts.size > 0) {
        const countParts = Array.from(columnCounts.entries())
          .map(([name, count]) => `${name}: ${count}`)
          .join(', ')
        items.push({
          category: 'board',
          summary: `columns: ${countParts}`,
        })
      }

      // Emit individual ready/unassigned tickets (orchestrator needs these to assign agents)
      for (const ticket of activeTickets) {
        const statusLower = (ticket.statusName || '').toLowerCase()
        if (readyNames.has(statusLower) && !ticket.assignee && !activeAgentTickets.has(ticket.id)) {
          items.push({ category: 'board', summary: `${ticket.id} "${ticket.title}": ready, unassigned` })
        }
      }

      // Detect anomalies
      items.push(...this.detectAnomalies(activeTickets, activeAgentTickets, githubItems))
    } catch {
      // Non-fatal error
    }

    return items
  }

  /**
   * Detect board anomalies (PRLT-1358).
   * Exposed as static-like for testability.
   */
  private detectAnomalies(
    tickets: BoardTicketInfo[],
    activeAgentTickets: Set<string>,
    githubItems: StateItem[],
  ): StateItem[] {
    const items: StateItem[] = []
    const now = Date.now()
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000

    // Build set of ticket IDs that have open PRs
    const ticketsWithOpenPRs = new Set<string>()
    for (const item of githubItems) {
      const match = item.summary.match(/\(([A-Z]+-\d+|TKT-\d+)\)/)
      if (match) ticketsWithOpenPRs.add(match[1])
    }

    // In Progress categories: 'started'
    const startedNames = new Set(['in progress', 'in development', 'developing', 'working', 'active', 'started'])
    // Review categories
    const reviewNames = new Set(['review', 'in review', 'code review', 'peer review', 'needs review'])

    for (const ticket of tickets) {
      const statusLower = (ticket.statusName || '').toLowerCase()
      const isStarted = ticket.statusCategory === 'started' || startedNames.has(statusLower)
      const isReview = reviewNames.has(statusLower)

      // Anomaly: In Progress with no active agent
      if (isStarted && !activeAgentTickets.has(ticket.id) && !isReview) {
        items.push({
          category: 'anomaly',
          summary: `${ticket.id} "${ticket.title}": in progress with no active agent`,
        })
      }

      // Anomaly: In Review but no open PR (PR may have been merged already)
      if (isReview && !ticketsWithOpenPRs.has(ticket.id)) {
        items.push({
          category: 'anomaly',
          summary: `${ticket.id} "${ticket.title}": in review with no open PR`,
        })
      }

      // Anomaly: Stuck in column >24h (non-terminal, non-backlog)
      if (ticket.updatedAt) {
        const age = now - ticket.updatedAt.getTime()
        const isNonTrivialColumn = ticket.statusCategory === 'started' || isReview
        if (age > TWENTY_FOUR_HOURS && isNonTrivialColumn) {
          const hours = Math.floor(age / (60 * 60 * 1000))
          const days = Math.floor(hours / 24)
          const timeStr = days > 0 ? `${days}d` : `${hours}h`
          items.push({
            category: 'anomaly',
            summary: `${ticket.id} "${ticket.title}": stuck in ${ticket.statusName} for ${timeStr}`,
          })
        }
      }
    }

    return items
  }

  /**
   * Default implementation: query live provider for all active tickets.
   */
  private async fetchBoardTicketsFromProvider(): Promise<BoardTicketInfo[]> {
    if (!this.cwd) return []

    const dbPath = path.join(this.cwd, '.proletariat', 'workspace.db')
    let storage: InstanceType<typeof SQLiteStorage>
    try {
      storage = new SQLiteStorage(dbPath)
    } catch {
      return []
    }

    let projects: Array<{ id: string }> = []
    try {
      projects = this.db.prepare(
        `SELECT id FROM pmo_projects WHERE is_archived = 0 LIMIT 20`,
      ).all() as Array<{ id: string }>
    } catch {
      return []
    }

    const tickets: BoardTicketInfo[] = []

    for (const project of projects) {
      try {
        const provider = resolveProjectProvider(this.db, storage, project.id)
        const result = await provider.listTickets(project.id)
        if (!result.success) continue

        for (const ticket of result.tickets) {
          tickets.push({
            id: ticket.id,
            title: ticket.title,
            statusName: ticket.statusName || '',
            statusCategory: ticket.statusCategory,
            assignee: ticket.assignee,
            updatedAt: ticket.updatedAt,
          })
        }
      } catch {
        // Non-fatal: skip project on error
      }
    }

    return tickets
  }

  // ===========================================================================
  // Message Formatting
  // ===========================================================================

  private formatStateMessage(items: StateItem[]): string {
    const sections: string[] = []

    const githubItems = items.filter(c => c.category === 'github')
    const boardItems = items.filter(c => c.category === 'board')
    const agentItems = items.filter(c => c.category === 'agents')
    const anomalyItems = items.filter(c => c.category === 'anomaly')

    // --- GitHub PRs ---
    if (githubItems.length > 0) {
      sections.push(`GitHub PRs (${githubItems.length} open):`)
      for (const c of githubItems) {
        sections.push(`- ${c.summary}`)
      }
    } else {
      sections.push('GitHub PRs: none')
    }

    // --- Board State ---
    // Separate column summary from individual ready tickets
    const columnSummary = boardItems.find(c => c.summary.startsWith('columns:'))
    const readyTickets = boardItems.filter(c => !c.summary.startsWith('columns:'))

    if (columnSummary) {
      sections.push('')
      sections.push(`Board state: ${columnSummary.summary.replace('columns: ', '')}`)
    }

    if (readyTickets.length > 0) {
      sections.push('')
      sections.push(`Ready tickets (${readyTickets.length} unassigned):`)
      for (const c of readyTickets) {
        sections.push(`- ${c.summary}`)
      }
    } else if (!columnSummary) {
      sections.push('')
      sections.push('Board: no active tickets')
    }

    // --- Anomalies ---
    if (anomalyItems.length > 0) {
      sections.push('')
      sections.push(`Anomalies (${anomalyItems.length}):`)
      for (const c of anomalyItems) {
        sections.push(`- ${c.summary}`)
      }
    }

    // --- Active Agents ---
    if (agentItems.length > 0) {
      const states = agentItems.map(c => c.healthState ?? 'UNKNOWN' as AgentHealthState)
      const counts = countByState(states)
      const summary = formatHealthSummary(counts)
      sections.push('')
      sections.push(`Active agents (${agentItems.length}): ${summary}`)

      // Only list agents that need attention (working, hung) or have errors
      const noteworthy = agentItems.filter(c =>
        c.healthState === 'WORKING' || c.healthState === 'HUNG'
      )
      for (const c of noteworthy) {
        sections.push(`- ${c.summary}`)
      }
    } else {
      sections.push('')
      sections.push('Active agents: none')
    }

    return sections.join('\n')
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  /**
   * Extract ticket ID from branch name.
   * Branch format: {ticketId}/{type}/{description}
   */
  private extractTicketFromBranch(branch: string): string | undefined {
    const match = branch.match(/^([A-Z]+-\d+|TKT-\d+)\//)
    return match ? match[1] : undefined
  }

  /**
   * Format a single PR's state summary line.
   *
   * Format: `repo#number (TICKET-ID): title — ...` when ticket is linked,
   *         `repo#number: title — no linked ticket — ...` otherwise.
   *
   * Exposed as static for testability (PRLT-1353).
   */
  static formatPRSummary(options: {
    repoName: string
    prNumber: number
    title: string
    ticketId?: string
    ciState: 'pending' | 'success' | 'failure' | 'unknown'
    mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
    reviewDecision: string | null
  }): string {
    const { repoName, prNumber, title, ticketId, ciState, mergeable, reviewDecision } = options
    const label = ticketId
      ? `${repoName}#${prNumber} (${ticketId})`
      : `${repoName}#${prNumber}`

    const parts = [`${label}: ${title}`]
    if (!ticketId) parts.push('no linked ticket')
    parts.push(`CI: ${ciState}`)
    if (mergeable === 'CONFLICTING') {
      parts.push('has merge conflicts')
    } else if (mergeable === 'MERGEABLE') {
      parts.push('mergeable')
    }
    if (reviewDecision) {
      parts.push(`review: ${reviewDecision}`)
    } else {
      parts.push('no review')
    }

    return parts.join(' — ')
  }
}

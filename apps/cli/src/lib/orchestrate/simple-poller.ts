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
import { getWorkflowConfig } from '../work-lifecycle/settings.js'
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

// =============================================================================
// Types
// =============================================================================

export interface SimplePollerOptions {
  db: Database.Database
  log: (msg: string) => void
  /** Working directory for gh CLI commands */
  cwd?: string
}

/** A single item in the state report. */
export interface StateItem {
  category: 'github' | 'board' | 'agents'
  summary: string
  /** Health state for agent items (from tmux pane inspection). */
  healthState?: AgentHealthState
}

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

  /** Git repo directories to poll for PRs. Resolved from cwd on construction. */
  private repoDirs: string[]

  /** Whether GitHub CLI is available. */
  private ghAvailable: boolean | null = null

  constructor(options: SimplePollerOptions) {
    this.db = options.db
    this.log = options.log
    this.cwd = options.cwd
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

    items.push(...this.gatherGitHubPRState())
    items.push(...this.gatherAgentState())
    items.push(...this.gatherReadyTicketState())

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
          const ticketId = this.extractTicketFromBranch(pr.headBranch)
          const label = `#${pr.number}${ticketId ? ` (${ticketId})` : ''}`

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
          const parts = [`${label}: "${pr.title}"`]
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

          items.push({ category: 'github', summary: parts.join(' — ') })
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
  // Board / Ready Ticket State
  // ===========================================================================

  private gatherReadyTicketState(): StateItem[] {
    const items: StateItem[] = []

    try {
      // Build list of status names that represent "ready" tickets.
      // Include the configured planned column name and common synonyms
      // that external providers use (e.g. Linear uses "Ready", "Todo").
      const readyNames = new Set(['ready', 'planned', 'todo'])
      try {
        const config = getWorkflowConfig(this.db)
        readyNames.add(config.planned.toLowerCase())
      } catch {
        // pmo_settings may not exist yet
      }

      const nameList = [...readyNames]
      const placeholders = nameList.map(() => '?').join(', ')

      // Query ticket_refs (runtime ticket cache) instead of the dropped
      // pmo_tickets / pmo_workflow_statuses tables (PRLT-1350).
      const readyTickets = this.db.prepare(`
        SELECT id, title
        FROM ticket_refs
        WHERE LOWER(status) IN (${placeholders})
          AND (assignee IS NULL OR assignee = '')
          AND id NOT IN (
            SELECT ticket_id FROM agent_work WHERE status IN ('starting', 'running')
          )
        LIMIT 20
      `).all(...nameList) as Array<{ id: string; title: string }>

      for (const ticket of readyTickets) {
        items.push({ category: 'board', summary: `${ticket.id} "${ticket.title}": ready, unassigned` })
      }
    } catch {
      // Non-fatal DB error (table may not exist)
    }

    return items
  }

  // ===========================================================================
  // Message Formatting
  // ===========================================================================

  private formatStateMessage(items: StateItem[]): string {
    const sections: string[] = []

    const githubItems = items.filter(c => c.category === 'github')
    const boardItems = items.filter(c => c.category === 'board')
    const agentItems = items.filter(c => c.category === 'agents')

    if (githubItems.length > 0) {
      sections.push(`GitHub PRs (${githubItems.length} open):`)
      for (const c of githubItems) {
        sections.push(`- ${c.summary}`)
      }
    } else {
      sections.push('GitHub PRs: none')
    }

    if (boardItems.length > 0) {
      sections.push('')
      sections.push(`Ready tickets (${boardItems.length} unassigned):`)
      for (const c of boardItems) {
        sections.push(`- ${c.summary}`)
      }
    } else {
      sections.push('')
      sections.push('Ready tickets: none')
    }

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
}

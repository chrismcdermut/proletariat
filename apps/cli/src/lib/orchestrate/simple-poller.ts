/**
 * Simple Poller — Minimal MVP poller for the `prlt watch` command.
 *
 * Polls GitHub PRs, Linear/board tickets, and running agents/containers.
 * Diffs state against last poll and returns a human-readable summary
 * of changes for poking an orchestrator agent.
 *
 * This is intentionally simple: poll → diff → format message.
 * No hooks, no presets, no action engine. The LLM orchestrator decides.
 */

import { execSync } from 'node:child_process'
import type Database from 'better-sqlite3'
import { isGHInstalled, isGHAuthenticated, listOpenPRs, getPRChecks } from '../pr/index.js'

// =============================================================================
// Types
// =============================================================================

export interface SimplePollerOptions {
  db: Database.Database
  log: (msg: string) => void
  /** Working directory for gh CLI commands */
  cwd?: string
}

/** Tracked PR state for diffing. */
interface PRState {
  number: number
  title: string
  headBranch: string
  url: string
  ciState: 'pending' | 'success' | 'failure' | 'unknown'
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
  reviewDecision: string | null
}

/** Tracked agent state for diffing. */
interface AgentState {
  id: string
  ticketId: string
  agentName: string
  status: string
  lifecycleState: string | null
  containerId: string | null
}

/** Tracked ready ticket. */
interface ReadyTicket {
  id: string
  title: string
}

/** A single change detected by the poller. */
export interface PollChange {
  category: 'github' | 'board' | 'agents'
  summary: string
}

/** Result of a poll cycle. */
export interface PollResult {
  changes: PollChange[]
  message: string | null
}

// =============================================================================
// Simple Poller
// =============================================================================

export class SimplePoller {
  private db: Database.Database
  private log: (msg: string) => void
  private cwd?: string

  /** Last-seen PR states. */
  private lastPRs = new Map<number, PRState>()

  /** Last-seen agent states. */
  private lastAgents = new Map<string, AgentState>()

  /** Last-seen ready ticket IDs. */
  private lastReadyTicketIds = new Set<string>()

  /** Whether GitHub CLI is available. */
  private ghAvailable: boolean | null = null

  /** Whether we've completed at least one poll (to avoid firing on initial state). */
  private initialized = false

  constructor(options: SimplePollerOptions) {
    this.db = options.db
    this.log = options.log
    this.cwd = options.cwd
  }

  /**
   * Run one poll cycle. Returns changes since last poll.
   * On the first poll, captures baseline state and returns no changes.
   */
  async poll(): Promise<PollResult> {
    const changes: PollChange[] = []

    const prChanges = this.pollGitHubPRs()
    const agentChanges = this.pollAgents()
    const boardChanges = this.pollReadyTickets()

    if (this.initialized) {
      changes.push(...prChanges, ...agentChanges, ...boardChanges)
    }

    this.initialized = true

    const message = changes.length > 0 ? this.formatPokeMessage(changes) : null
    return { changes, message }
  }

  // ===========================================================================
  // GitHub PR Polling
  // ===========================================================================

  private pollGitHubPRs(): PollChange[] {
    if (this.ghAvailable === null) {
      this.ghAvailable = isGHInstalled() && isGHAuthenticated()
    }
    if (!this.ghAvailable) return []

    const changes: PollChange[] = []

    try {
      const openPRs = listOpenPRs(this.cwd)
      const currentPRNumbers = new Set<number>()

      for (const pr of openPRs) {
        currentPRNumbers.add(pr.number)
        const ticketId = this.extractTicketFromBranch(pr.headBranch)
        const label = `#${pr.number}${ticketId ? ` (${ticketId})` : ''}`

        // Get CI status
        let ciState: PRState['ciState'] = 'unknown'
        try {
          const checks = getPRChecks(pr.number, this.cwd)
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
        let mergeable: PRState['mergeable'] = 'UNKNOWN'
        try {
          const result = execSync(
            `gh pr view ${pr.number} --json mergeable -q .mergeable`,
            { cwd: this.cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
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
            { cwd: this.cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
          ).trim()
          if (result) reviewDecision = result
        } catch {
          // Non-fatal
        }

        const current: PRState = {
          number: pr.number,
          title: pr.title,
          headBranch: pr.headBranch,
          url: pr.url,
          ciState,
          mergeable,
          reviewDecision,
        }

        // Diff against last state
        const prev = this.lastPRs.get(pr.number)
        if (prev) {
          if (prev.ciState !== ciState && ciState !== 'unknown') {
            if (ciState === 'success') {
              changes.push({ category: 'github', summary: `${label}: CI green, ${mergeable === 'MERGEABLE' ? 'mergeable' : mergeable === 'CONFLICTING' ? 'has merge conflicts' : 'mergeable state unknown'}` })
            } else if (ciState === 'failure') {
              changes.push({ category: 'github', summary: `${label}: CI failed` })
            }
          }
          if (prev.mergeable !== 'CONFLICTING' && mergeable === 'CONFLICTING') {
            changes.push({ category: 'github', summary: `${label}: now has merge conflicts` })
          }
          if (prev.mergeable === 'CONFLICTING' && mergeable === 'MERGEABLE') {
            changes.push({ category: 'github', summary: `${label}: conflicts resolved, now mergeable` })
          }
          if (prev.reviewDecision !== reviewDecision && reviewDecision) {
            changes.push({ category: 'github', summary: `${label}: review ${reviewDecision}` })
          }
        }

        this.lastPRs.set(pr.number, current)
      }

      // Detect PRs that disappeared (merged or closed)
      for (const [prNum, prev] of this.lastPRs) {
        if (!currentPRNumbers.has(prNum)) {
          const ticketId = this.extractTicketFromBranch(prev.headBranch)
          const label = `#${prNum}${ticketId ? ` (${ticketId})` : ''}`

          // Check if it was merged
          try {
            const result = execSync(
              `gh pr view ${prNum} --json state -q .state`,
              { cwd: this.cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
            ).trim()
            if (result === 'MERGED') {
              changes.push({ category: 'github', summary: `${label}: merged since last poll` })
            } else {
              changes.push({ category: 'github', summary: `${label}: closed since last poll` })
            }
          } catch {
            changes.push({ category: 'github', summary: `${label}: no longer open` })
          }

          this.lastPRs.delete(prNum)
        }
      }
    } catch (err) {
      this.log(`[watch] GitHub poll error: ${err instanceof Error ? err.message : String(err)}`)
    }

    return changes
  }

  // ===========================================================================
  // Agent / Container Polling
  // ===========================================================================

  private pollAgents(): PollChange[] {
    const changes: PollChange[] = []

    try {
      const agents = this.db.prepare(`
        SELECT id, ticket_id, agent_name, status, lifecycle_state, container_id
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
      }>

      const currentAgentIds = new Set<string>()

      for (const agent of agents) {
        currentAgentIds.add(agent.id)
        const label = `${agent.agent_name} (${agent.ticket_id})`

        const current: AgentState = {
          id: agent.id,
          ticketId: agent.ticket_id,
          agentName: agent.agent_name,
          status: agent.status,
          lifecycleState: agent.lifecycle_state,
          containerId: agent.container_id,
        }

        const prev = this.lastAgents.get(agent.id)
        if (prev) {
          const prevEffective = prev.lifecycleState || prev.status
          const currEffective = agent.lifecycle_state || agent.status

          if (prevEffective !== currEffective) {
            if (currEffective === 'completed') {
              changes.push({ category: 'agents', summary: `${label}: completed` })
            } else if (currEffective === 'failed' || currEffective === 'error' || currEffective === 'died') {
              changes.push({ category: 'agents', summary: `${label}: died/failed` })
            } else if (currEffective === 'stopped') {
              changes.push({ category: 'agents', summary: `${label}: stopped` })
            } else if (currEffective === 'idle') {
              changes.push({ category: 'agents', summary: `${label}: idle` })
            } else if (currEffective === 'running' && prevEffective === 'starting') {
              changes.push({ category: 'agents', summary: `${label}: now running` })
            }
          }
        }

        this.lastAgents.set(agent.id, current)
      }

      // Also check for stopped containers via docker ps (agents that crashed outside DB tracking)
      try {
        const dockerOutput = execSync(
          'docker ps --format "{{.ID}}\t{{.Names}}\t{{.Status}}"',
          { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10_000 },
        ).trim()

        if (dockerOutput) {
          for (const line of dockerOutput.split('\n')) {
            const [containerId, name, status] = line.split('\t')
            if (!containerId) continue

            // Check if any tracked agent's container has exited
            for (const [agentId, prev] of this.lastAgents) {
              if (prev.containerId === containerId && status && /exited/i.test(status)) {
                const label = `${prev.agentName} (${prev.ticketId})`
                changes.push({ category: 'agents', summary: `${label}: container stopped` })
              }
            }
          }
        }
      } catch {
        // Docker not available or command failed — non-fatal
      }
    } catch {
      // Non-fatal DB error
    }

    return changes
  }

  // ===========================================================================
  // Board / Ready Ticket Polling
  // ===========================================================================

  private pollReadyTickets(): PollChange[] {
    const changes: PollChange[] = []

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
        LIMIT 20
      `).all() as ReadyTicket[]

      const currentReadyIds = new Set(readyTickets.map(t => t.id))

      // Detect newly ready tickets
      for (const ticket of readyTickets) {
        if (!this.lastReadyTicketIds.has(ticket.id)) {
          changes.push({ category: 'board', summary: `${ticket.id} "${ticket.title}" moved to Ready, no agent assigned` })
        }
      }

      // Detect tickets that left Ready (assigned or moved)
      for (const prevId of this.lastReadyTicketIds) {
        if (!currentReadyIds.has(prevId)) {
          changes.push({ category: 'board', summary: `${prevId} no longer in Ready (assigned or moved)` })
        }
      }

      this.lastReadyTicketIds = currentReadyIds
    } catch {
      // Non-fatal DB error (table may not exist)
    }

    return changes
  }

  // ===========================================================================
  // Message Formatting
  // ===========================================================================

  private formatPokeMessage(changes: PollChange[]): string {
    const sections: string[] = []

    const githubChanges = changes.filter(c => c.category === 'github')
    const boardChanges = changes.filter(c => c.category === 'board')
    const agentChanges = changes.filter(c => c.category === 'agents')

    if (githubChanges.length > 0) {
      sections.push('GitHub PR update:')
      for (const c of githubChanges) {
        sections.push(`- ${c.summary}`)
      }
    }

    if (boardChanges.length > 0) {
      if (sections.length > 0) sections.push('')
      sections.push('Board:')
      for (const c of boardChanges) {
        sections.push(`- ${c.summary}`)
      }
    }

    if (agentChanges.length > 0) {
      if (sections.length > 0) sections.push('')
      sections.push('Agents:')
      for (const c of agentChanges) {
        sections.push(`- ${c.summary}`)
      }
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

/**
 * Tier 2→3 Escalation Bridge (PRLT-1282)
 *
 * When the deterministic reconciler can't resolve a state, this module
 * detects "weird" states, formats human/LLM-readable alerts, and pokes
 * the orchestrator session so an LLM can make a judgment call.
 *
 * Design:
 * - Pure detection logic (no DB, no IO) is in detectWeirdStates()
 * - Alert formatting is in formatAlert()
 * - Cooldown/dedup tracking is in EscalationTracker
 * - Poke dispatch shells out to `prlt session poke` (fire-and-forget)
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { PRInfo } from '../pr/index.js'
import type { LinkedPR, ReconcileTicket } from './types.js'

const execFileAsync = promisify(execFile)

// =============================================================================
// Types
// =============================================================================

/**
 * Issue types the escalation module can detect.
 */
export type EscalationIssueType =
  | 'pr_closed_not_merged'
  | 'pr_stale_conflict'
  | 'no_pr_stalled'
  | 'multiple_open_prs'
  | 'session_idle'
  | 'ticket_backward'

/**
 * A detected weird state that should be escalated to the LLM.
 */
export interface EscalationIssue {
  ticketId: string
  ticketTitle: string
  issueType: EscalationIssueType
  /** One-line description of what's weird */
  summary: string
  /** Current ticket status */
  currentState: string
  /** Linked PR info (if relevant) */
  pr?: { number: number; state: PRInfo['state']; url: string }
  /** Age description (human-readable) */
  age: string
  /** 2-3 suggested actions for the LLM */
  suggestedActions: string[]
}

/**
 * Configurable thresholds for weird state detection.
 */
export interface EscalationThresholds {
  /** Days before a stale/conflicting PR triggers escalation (default: 3) */
  conflictDays: number
  /** Days before a ticket with no PR triggers escalation (default: 2) */
  noPrDays: number
  /** Minutes before an idle session triggers escalation (default: 30) */
  idleSessionMinutes: number
}

/**
 * Context about a ticket needed for weird state detection beyond what
 * ReconcileTicket and LinkedPR provide.
 */
export interface EscalationContext {
  /** When the ticket last changed state (ISO string or undefined) */
  ticketUpdatedAt?: string
  /** Running agent sessions associated with this ticket */
  activeExecutions?: Array<{
    agentName: string
    startedAt: Date
    sessionId?: string
  }>
  /** The ticket's external key (e.g. PRLT-1282) for alert formatting */
  externalKey?: string
}

/**
 * Result of an escalation attempt.
 */
export interface EscalationResult {
  /** Issues that were poked to the orchestrator */
  escalated: EscalationIssue[]
  /** Issues skipped due to cooldown */
  cooledDown: EscalationIssue[]
  /** Issues detected but not poked (dry-run) */
  dryRun: EscalationIssue[]
}

export const DEFAULT_THRESHOLDS: EscalationThresholds = {
  conflictDays: 3,
  noPrDays: 2,
  idleSessionMinutes: 30,
}

// =============================================================================
// Weird State Detection — pure logic, no IO
// =============================================================================

/**
 * Detect weird/ambiguous states that the deterministic reconciler can't resolve.
 *
 * This function should only be called for tickets where `deriveExpectedState()`
 * returned null — i.e., the deterministic rules found nothing to do.
 *
 * Returns an array of issues (usually 0 or 1, but a ticket can have multiple).
 */
export function detectWeirdStates(
  ticket: ReconcileTicket,
  linkedPRs: LinkedPR[],
  context: EscalationContext = {},
  thresholds: EscalationThresholds = DEFAULT_THRESHOLDS,
  now: Date = new Date(),
): EscalationIssue[] {
  const issues: EscalationIssue[] = []
  const ticketLabel = context.externalKey ?? ticket.id
  const currentState = ticket.statusName ?? ticket.statusCategory ?? 'unknown'

  // Case 1: PR closed but not merged (for non-review tickets)
  // Rule 2 handles review tickets with all-closed PRs → In Progress.
  // Everything else with a closed PR is ambiguous.
  const closedPRs = linkedPRs.filter(lp => lp.pr.state === 'CLOSED')
  const hasOpenPR = linkedPRs.some(lp => lp.pr.state === 'OPEN')
  if (closedPRs.length > 0 && !hasOpenPR && !isReviewCategory(ticket)) {
    const pr = closedPRs[0].pr
    issues.push({
      ticketId: ticketLabel,
      ticketTitle: ticket.title ?? '',
      issueType: 'pr_closed_not_merged',
      summary: `PR #${pr.number} was closed without merging while ticket is in ${currentState}`,
      currentState,
      pr: { number: pr.number, state: pr.state, url: pr.url },
      age: formatAge(pr.updatedAt, now),
      suggestedActions: [
        `Reopen PR or create a new one: prlt work start ${ticketLabel} --action implement`,
        `Close ticket and move to Backlog: prlt ticket move ${ticketLabel} Backlog`,
        `Escalate to human (reply in conversation)`,
      ],
    })
  }

  // Case 2: PR stale/conflicting for >N days
  const openPRs = linkedPRs.filter(lp => lp.pr.state === 'OPEN')
  for (const lp of openPRs) {
    const daysSinceUpdate = daysBetween(lp.pr.updatedAt, now)
    if (daysSinceUpdate >= thresholds.conflictDays) {
      issues.push({
        ticketId: ticketLabel,
        ticketTitle: ticket.title ?? '',
        issueType: 'pr_stale_conflict',
        summary: `PR #${lp.pr.number} has had no activity for ${Math.floor(daysSinceUpdate)} days (possible merge conflicts)`,
        currentState,
        pr: { number: lp.pr.number, state: lp.pr.state, url: lp.pr.url },
        age: `${Math.floor(daysSinceUpdate)} days since last activity`,
        suggestedActions: [
          `Spawn rebase agent: prlt work start ${ticketLabel} --action implement`,
          `Close PR and move ticket to Backlog: gh pr close ${lp.pr.number} && prlt ticket move ${ticketLabel} Backlog`,
          `Escalate to human (reply in conversation)`,
        ],
      })
    }
  }

  // Case 3: Ticket in progress with no PR for >N days
  if (
    ticket.statusCategory === 'started' &&
    linkedPRs.length === 0 &&
    context.ticketUpdatedAt
  ) {
    const daysSinceUpdate = daysBetween(context.ticketUpdatedAt, now)
    if (daysSinceUpdate >= thresholds.noPrDays) {
      issues.push({
        ticketId: ticketLabel,
        ticketTitle: ticket.title ?? '',
        issueType: 'no_pr_stalled',
        summary: `Ticket has been in ${currentState} for ${Math.floor(daysSinceUpdate)} days with no linked PR`,
        currentState,
        age: `${Math.floor(daysSinceUpdate)} days in ${currentState}`,
        suggestedActions: [
          `Check for stuck agent and restart: prlt work start ${ticketLabel} --action implement`,
          `Move to Backlog for re-triage: prlt ticket move ${ticketLabel} Backlog`,
          `Escalate to human (reply in conversation)`,
        ],
      })
    }
  }

  // Case 4: Multiple open PRs for the same ticket
  if (openPRs.length > 1) {
    const prList = openPRs.map(lp => `#${lp.pr.number}`).join(', ')
    issues.push({
      ticketId: ticketLabel,
      ticketTitle: ticket.title ?? '',
      issueType: 'multiple_open_prs',
      summary: `${openPRs.length} open PRs found (${prList}) — which is canonical?`,
      currentState,
      pr: { number: openPRs[0].pr.number, state: openPRs[0].pr.state, url: openPRs[0].pr.url },
      age: formatAge(openPRs[0].pr.updatedAt, now),
      suggestedActions: [
        ...openPRs.map(
          lp => `Keep PR #${lp.pr.number} and close the others`,
        ),
        `Escalate to human (reply in conversation)`,
      ],
    })
  }

  // Case 5: Agent session alive but idle for >N minutes
  if (context.activeExecutions) {
    for (const exec of context.activeExecutions) {
      const minutesSinceStart = minutesBetween(exec.startedAt, now)
      if (minutesSinceStart >= thresholds.idleSessionMinutes) {
        issues.push({
          ticketId: ticketLabel,
          ticketTitle: ticket.title ?? '',
          issueType: 'session_idle',
          summary: `Agent session "${exec.agentName}" has been running for ${Math.floor(minutesSinceStart)} minutes with no ticket progress`,
          currentState,
          age: `${Math.floor(minutesSinceStart)} minutes since session started`,
          suggestedActions: [
            `Check agent session: prlt session list`,
            `Stop and restart agent: prlt session stop ${exec.sessionId ?? exec.agentName} && prlt work start ${ticketLabel} --action implement`,
            `Escalate to human (reply in conversation)`,
          ],
        })
      }
    }
  }

  // Case 6: Ticket moved backward externally
  // Detect when a ticket has evidence of prior completion (merged PR backfill,
  // completed_at metadata) but is now in a non-terminal, pre-done state
  // and the deterministic reconciler didn't fire (meaning we can't find
  // the merged PR anymore or something is off).
  const md = ticket.metadata ?? {}
  const hadMergedPR = md.pr_number !== undefined && md.pr_url !== undefined
  const hasMergedLinked = linkedPRs.some(lp => lp.pr.state === 'MERGED')
  // If we have PR metadata suggesting prior merge but no currently-linked
  // merged PR, and the ticket isn't terminal, that's backward movement.
  if (
    hadMergedPR &&
    !hasMergedLinked &&
    ticket.statusCategory !== 'completed' &&
    ticket.statusCategory !== 'canceled'
  ) {
    issues.push({
      ticketId: ticketLabel,
      ticketTitle: ticket.title ?? '',
      issueType: 'ticket_backward',
      summary: `Ticket was previously linked to a merged PR but is now in ${currentState} — possible backward movement`,
      currentState,
      age: context.ticketUpdatedAt ? formatAge(context.ticketUpdatedAt, now) : 'unknown',
      suggestedActions: [
        `Verify PR status and move to Done if merged: prlt ticket move ${ticketLabel} Done`,
        `Investigate if ticket was intentionally reopened`,
        `Escalate to human (reply in conversation)`,
      ],
    })
  }

  return issues
}

// =============================================================================
// Alert Formatting
// =============================================================================

/**
 * Format an escalation issue into the structured text alert format
 * specified in the ticket. Human/LLM-readable, NOT JSON.
 */
export function formatAlert(issue: EscalationIssue): string {
  const lines: string[] = []

  lines.push(`Reconciler alert: ${issue.ticketId}`)
  lines.push(`State: ${issue.currentState}`)

  if (issue.pr) {
    lines.push(
      `PR: #${issue.pr.number} (${issue.pr.state}) — ${issue.pr.url}`,
    )
  } else {
    lines.push(`PR: none`)
  }

  lines.push(`Age: ${issue.age}`)
  lines.push(`Issue: ${issue.summary}`)
  lines.push(`Suggested actions:`)

  for (let i = 0; i < issue.suggestedActions.length; i++) {
    lines.push(`  ${i + 1}. ${issue.suggestedActions[i]}`)
  }

  return lines.join('\n')
}

// =============================================================================
// Cooldown / Dedup Tracker
// =============================================================================

/**
 * Tracks which ticket+issue combinations have been poked recently to
 * prevent spamming the orchestrator. In-memory — resets on process restart.
 */
export class EscalationTracker {
  private readonly cooldownMs: number
  private readonly lastPoked = new Map<string, number>()

  constructor(cooldownMinutes: number = 30) {
    this.cooldownMs = cooldownMinutes * 60 * 1000
  }

  /**
   * Build a dedup key from a ticket ID and issue type.
   */
  private key(ticketId: string, issueType: EscalationIssueType): string {
    return `${ticketId}::${issueType}`
  }

  /**
   * Check if an issue is within cooldown (was poked recently).
   */
  isInCooldown(
    ticketId: string,
    issueType: EscalationIssueType,
    now: Date = new Date(),
  ): boolean {
    const k = this.key(ticketId, issueType)
    const last = this.lastPoked.get(k)
    if (last === undefined) return false
    return now.getTime() - last < this.cooldownMs
  }

  /**
   * Record that an issue was poked.
   */
  recordPoke(
    ticketId: string,
    issueType: EscalationIssueType,
    now: Date = new Date(),
  ): void {
    const k = this.key(ticketId, issueType)
    this.lastPoked.set(k, now.getTime())
  }

  /**
   * Clear all cooldown state. Useful for testing.
   */
  clear(): void {
    this.lastPoked.clear()
  }
}

// =============================================================================
// Poke Dispatch (fire-and-forget)
// =============================================================================

/**
 * Send a poke to the orchestrator session with the given alert text.
 * Fire-and-forget: we don't wait for the LLM to respond.
 *
 * Uses `prlt session poke <session> <alert>` without --wait.
 */
export async function sendEscalationPoke(
  session: string,
  alert: string,
  options: { binary?: string; cwd?: string } = {},
): Promise<{ success: boolean; error?: string }> {
  const binary = options.binary ?? 'prlt'
  try {
    await execFileAsync(binary, ['session', 'poke', session, alert], {
      cwd: options.cwd,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    })
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

// =============================================================================
// Helpers
// =============================================================================

function isReviewCategory(ticket: ReconcileTicket): boolean {
  if (ticket.statusCategory !== 'started') return false
  const name = (ticket.statusName ?? '').toLowerCase()
  return name.includes('review')
}

function daysBetween(isoOrDate: string | Date, now: Date): number {
  const then = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate
  return (now.getTime() - then.getTime()) / (1000 * 60 * 60 * 24)
}

function minutesBetween(from: Date, now: Date): number {
  return (now.getTime() - from.getTime()) / (1000 * 60)
}

function formatAge(isoOrDate: string | Date, now: Date): string {
  const days = daysBetween(isoOrDate, now)
  if (days >= 1) {
    return `${Math.floor(days)} day${Math.floor(days) === 1 ? '' : 's'} since last activity`
  }
  const hours = days * 24
  if (hours >= 1) {
    return `${Math.floor(hours)} hour${Math.floor(hours) === 1 ? '' : 's'} since last activity`
  }
  const minutes = hours * 60
  return `${Math.floor(minutes)} minute${Math.floor(minutes) === 1 ? '' : 's'} since last activity`
}

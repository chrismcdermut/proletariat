/**
 * Board Sync Reconciler
 *
 * Core reconciliation logic that detects drift between GitHub PR state
 * and ticket provider state, then produces corrective actions.
 *
 * Provider-agnostic: works with any ticket provider (Linear, PMO, etc.)
 * and any git host that exposes PR info.
 *
 * Reconciliation rules:
 * 1. Merged PR + ticket not Done → move to Done
 * 2. Green CI + ticket In Progress → move to Review
 * 3. Ticket In Progress + no active agent → flag as stale
 * 4. Ticket In Review + PR closed (not merged) → move to Backlog
 */

import type { PRInfo, PRCheck } from '../pr/index.js'
import type { Ticket, StateCategory } from '../pmo/types.js'

// =============================================================================
// Types
// =============================================================================

export type ReconcileActionType =
  | 'move_to_done'
  | 'move_to_review'
  | 'move_to_in_progress'
  | 'flag_stale'
  | 'flag_stale_triage'
  | 'flag_duplicate'
  | 'move_to_backlog'

export interface ReconcileAction {
  type: ReconcileActionType
  ticketId: string
  ticketTitle: string
  reason: string
  /** Target status name to move to (for move actions) */
  targetStatus?: string
}

export interface ReconcileContext {
  ticket: Ticket
  pr: PRInfo | null
  checks: PRCheck[]
  hasActiveExecution: boolean
}

export interface ReconcileResult {
  actions: ReconcileAction[]
  checked: number
  errors: Array<{ ticketId: string; error: string }>
}

// =============================================================================
// Reconciler
// =============================================================================

/**
 * Determine reconciliation actions for a single ticket.
 */
export function reconcileTicket(ctx: ReconcileContext): ReconcileAction | null {
  const { ticket, pr, checks, hasActiveExecution } = ctx
  const category = ticket.statusCategory

  // Rule 1: Merged PR + ticket not Done → move to Done
  if (pr?.state === 'MERGED' && category !== 'completed' && category !== 'canceled') {
    return {
      type: 'move_to_done',
      ticketId: ticket.id,
      ticketTitle: ticket.title,
      reason: `PR #${pr.number} is merged but ticket is still in ${ticket.statusName ?? category}`,
      targetStatus: 'Done',
    }
  }

  // Rule 4: Ticket in review + PR closed (not merged) → move to Backlog
  // Check this before rule 2 since a closed PR should take precedence
  if (pr?.state === 'CLOSED' && category === 'started' && isReviewStatus(ticket)) {
    return {
      type: 'move_to_backlog',
      ticketId: ticket.id,
      ticketTitle: ticket.title,
      reason: `PR #${pr.number} was closed without merging`,
      targetStatus: 'Backlog',
    }
  }

  // Rule 2a: Green CI + ticket In Progress → move to Review
  if (
    pr?.state === 'OPEN' &&
    !pr.isDraft &&
    category === 'started' &&
    !isReviewStatus(ticket) &&
    checks.length > 0 &&
    allChecksGreen(checks)
  ) {
    return {
      type: 'move_to_review',
      ticketId: ticket.id,
      ticketTitle: ticket.title,
      reason: `PR #${pr.number} has all CI checks passing`,
      targetStatus: 'Review',
    }
  }

  // Rule 2b: PR opened (not draft) + ticket In Progress → move to Review
  // Fires even without CI checks — the PR being opened signals readiness for review
  if (
    pr?.state === 'OPEN' &&
    !pr.isDraft &&
    category === 'started' &&
    !isReviewStatus(ticket)
  ) {
    return {
      type: 'move_to_review',
      ticketId: ticket.id,
      ticketTitle: ticket.title,
      reason: `PR #${pr.number} opened for review`,
      targetStatus: 'Review',
    }
  }

  // Rule 3: Ticket In Progress + no active agent + no open PR → flag as stale
  if (
    category === 'started' &&
    !isReviewStatus(ticket) &&
    !hasActiveExecution &&
    (!pr || pr.state === 'CLOSED')
  ) {
    return {
      type: 'flag_stale',
      ticketId: ticket.id,
      ticketTitle: ticket.title,
      reason: 'No active agent and no open PR',
    }
  }

  return null
}

/**
 * Check if all CI checks have passed.
 */
function allChecksGreen(checks: PRCheck[]): boolean {
  return checks.every(
    c => c.conclusion === 'SUCCESS' || c.conclusion === 'NEUTRAL' || c.conclusion === 'SKIPPED'
  )
}

/**
 * Check if a ticket is in a review-like status.
 */
function isReviewStatus(ticket: Ticket): boolean {
  const name = (ticket.statusName ?? '').toLowerCase()
  return name.includes('review') || name.includes('in review')
}

// =============================================================================
// Board-Level Reconciliation
// =============================================================================

/**
 * Context for board-level reconciliation that operates across all tickets.
 */
export interface BoardReconcileContext {
  /** All tickets on the board (any status) */
  tickets: Ticket[]
  /** Branches with merged PRs (from GitHub) */
  mergedBranches: Set<string>
  /** Ticket IDs that have active agent executions */
  activeAgentTicketIds: Set<string>
}

/**
 * Detect tickets whose agent has been spawned but status is still in triage/backlog.
 * Rule: Agent spawned → ticket should be In Progress.
 */
export function reconcileAgentSpawned(
  tickets: Ticket[],
  activeAgentTicketIds: Set<string>,
): ReconcileAction[] {
  const actions: ReconcileAction[] = []

  for (const ticket of tickets) {
    const category = ticket.statusCategory
    // If an agent is running for this ticket but the ticket is still in backlog/todo
    if (
      activeAgentTicketIds.has(ticket.id) &&
      (category === 'backlog' || category === 'unstarted' || category === 'triage')
    ) {
      actions.push({
        type: 'move_to_in_progress',
        ticketId: ticket.id,
        ticketTitle: ticket.title,
        reason: 'Agent is actively working on this ticket',
        targetStatus: 'In Progress',
      })
    }
  }

  return actions
}

/**
 * Detect duplicate tickets — tickets with the same title and similar descriptions.
 * Returns flag_duplicate actions for each duplicate found (flags the newer one).
 */
export function detectDuplicates(tickets: Ticket[]): ReconcileAction[] {
  const actions: ReconcileAction[] = []
  const seen = new Map<string, Ticket>()

  for (const ticket of tickets) {
    // Skip completed/canceled tickets — they're done
    if (ticket.statusCategory === 'completed' || ticket.statusCategory === 'canceled') {
      continue
    }

    const key = normalizeForDuplicateCheck(ticket.title)
    if (!key) continue

    const existing = seen.get(key)
    if (existing) {
      // Flag the newer ticket as a duplicate of the older one
      const [newer, older] = ticket.createdAt > existing.createdAt
        ? [ticket, existing]
        : [existing, ticket]

      actions.push({
        type: 'flag_duplicate',
        ticketId: newer.id,
        ticketTitle: newer.title,
        reason: `Possible duplicate of ${older.id} "${older.title}"`,
      })
    } else {
      seen.set(key, ticket)
    }
  }

  return actions
}

/**
 * Detect stale Triage tickets that have branches matching merged PRs.
 * These tickets should have been moved to Done when the PR merged.
 */
export function detectStaleTriage(
  tickets: Ticket[],
  mergedBranches: Set<string>,
): ReconcileAction[] {
  const actions: ReconcileAction[] = []

  for (const ticket of tickets) {
    const category = ticket.statusCategory
    // Only check backlog/todo (triage) tickets
    if (category !== 'backlog' && category !== 'unstarted' && category !== 'triage') continue
    // Must have a branch linked
    if (!ticket.branch) continue

    if (mergedBranches.has(ticket.branch)) {
      actions.push({
        type: 'flag_stale_triage',
        ticketId: ticket.id,
        ticketTitle: ticket.title,
        reason: `Branch "${ticket.branch}" has a merged PR but ticket is still in ${ticket.statusName ?? category}`,
      })
    }
  }

  return actions
}

/**
 * Normalize a ticket title for duplicate comparison.
 * Strips whitespace, lowercases, removes common prefixes like ticket IDs.
 */
function normalizeForDuplicateCheck(title: string): string {
  return title
    .toLowerCase()
    .trim()
    // Remove ticket ID prefixes like "PRLT-123:" or "[BUG]"
    .replace(/^[A-Z]+-\d+[:\s]+/i, '')
    .replace(/^\[.*?\]\s*/, '')
    .replace(/\s+/g, ' ')
}

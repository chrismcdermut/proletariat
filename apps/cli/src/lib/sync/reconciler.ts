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
  | 'flag_stale'
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

  // Rule 2: Green CI + ticket In Progress → move to Review
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

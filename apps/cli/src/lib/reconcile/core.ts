/**
 * Tier 2 State Reconciler — Pure core (PRLT-1280)
 *
 * This module holds the deterministic, provider-agnostic, side-effect-free
 * logic of the reconciler. It answers a single question:
 *
 *   Given a ticket and the live state of its linked PR(s), what target
 *   column should the ticket be in, and is that different from its
 *   current column?
 *
 * Splitting this out from the IO-heavy runner keeps the rules trivially
 * unit-testable without spinning up a database or the gh CLI.
 */

import type { PRInfo } from '../pr/index.js'
import type { WorkflowConfig } from '../work-lifecycle/settings.js'
import type { LinkedPR, ReconcileTicket, ReconcileTransition } from './types.js'

/**
 * Derive the expected state for a ticket given its linked PRs.
 *
 * Rules (mirrors the Tier 2 spec in PRLT-1280):
 *   1. Any linked PR is MERGED → ticket belongs in Done
 *   2. Ticket is currently in "review" category AND every open PR has been
 *      CLOSED without merging → move back to In Progress so humans can
 *      resume work. (Rule 4 in the existing sync reconciler uses Backlog,
 *      but PRLT-1280 explicitly asks for "back to In Progress or a review
 *      queue" — In Progress matches the active work better than Backlog.)
 *   3. Otherwise: no expected transition.
 *
 * `null` means "leave the ticket alone". The reconciler MUST treat `null`
 * as the idempotent path — that's how "second run is a no-op" works.
 */
export function deriveExpectedState(
  ticket: ReconcileTicket,
  linkedPRs: LinkedPR[],
  config?: WorkflowConfig,
): { targetState: string; reason: string; driver: LinkedPR } | null {
  const category = ticket.statusCategory
  const doneStatus = config?.done ?? 'Done'
  const inProgressStatus = config?.in_progress ?? 'In Progress'

  // Terminal states are load-bearing: we never pull a ticket back out of
  // Done or Canceled. A human may have marked it closed for a reason.
  if (category === 'completed' || category === 'canceled') {
    return null
  }

  // Rule 1: any merged PR wins. Even if another linked PR is still open,
  // a merged PR means the ticket's work shipped.
  const merged = linkedPRs.find(lp => lp.pr.state === 'MERGED')
  if (merged) {
    // Idempotency: if the ticket is already sitting in the done column
    // name we resolved, there is nothing to do.
    if (statusMatches(ticket.statusName, doneStatus)) {
      return null
    }
    return {
      targetState: doneStatus,
      reason:
        `GitHub PR #${merged.pr.number} is MERGED (merged upstream), ` +
        `expected ${doneStatus}, was ${ticket.statusName ?? category ?? 'unknown'}`,
      driver: merged,
    }
  }

  // Rule 2: ticket is in review-land, but every linked PR is closed without
  // merging. Pull it back to In Progress so it gets picked up again.
  const hasLinkedPRs = linkedPRs.length > 0
  const allClosedNoMerge =
    hasLinkedPRs && linkedPRs.every(lp => lp.pr.state === 'CLOSED')
  const inReview = category === 'started' && isReviewStatus(ticket.statusName, config)

  if (allClosedNoMerge && inReview) {
    if (statusMatches(ticket.statusName, inProgressStatus)) {
      return null
    }
    const closed = linkedPRs[0]
    return {
      targetState: inProgressStatus,
      reason:
        `GitHub PR #${closed.pr.number} is CLOSED without merging, ` +
        `expected ${inProgressStatus}, was ${ticket.statusName ?? category ?? 'unknown'}`,
      driver: closed,
    }
  }

  return null
}

/**
 * Build a {@link ReconcileTransition} record from a derived expected-state
 * decision. Factored out so the runner and the tests both produce the
 * same transition shape.
 */
export function buildTransition(params: {
  ticket: ReconcileTicket
  provider: string
  targetState: string
  reason: string
  driver?: LinkedPR
  now?: Date
}): ReconcileTransition {
  const { ticket, provider, targetState, reason, driver, now } = params
  return {
    ticketId: ticket.id,
    ticketTitle: ticket.title ?? '',
    projectId: ticket.projectId ?? '',
    provider,
    fromState: ticket.statusName ?? null,
    toState: targetState,
    prNumber: driver?.pr.number,
    prState: driver?.pr.state,
    reason,
    decidedAt: (now ?? new Date()).toISOString(),
  }
}

/**
 * Format a transition for the structured log line required by the AC.
 * The format is stable so scripts and tests can grep on it.
 *
 * Example:
 *   [reconcile] TKT-142: In Review → Done | PR #321 MERGED @ 2026-04-08T00:00:00Z | reason: ...
 */
export function formatTransitionLogLine(t: ReconcileTransition): string {
  const prPart =
    t.prNumber !== undefined
      ? `PR #${t.prNumber} ${t.prState ?? ''}`.trim() + ` @ ${t.decidedAt}`
      : `no PR @ ${t.decidedAt}`
  const from = t.fromState ?? 'unknown'
  return `[reconcile] ${t.ticketId}: ${from} → ${t.toState} | ${prPart} | reason: ${t.reason}`
}

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function statusMatches(current: string | null | undefined, target: string): boolean {
  if (!current) return false
  return current.toLowerCase() === target.toLowerCase()
}

/**
 * Match the existing sync reconciler's notion of "review status" so the
 * Tier 2 reconciler treats the same columns as review that Tier 1 does.
 * When a WorkflowConfig is provided, matches exactly against the
 * configured review column; otherwise falls back to substring matching.
 */
function isReviewStatus(
  statusName: string | null | undefined,
  config?: WorkflowConfig,
): boolean {
  const name = (statusName ?? '').toLowerCase()
  if (!name) return false
  if (config?.review) {
    return name === config.review.toLowerCase()
  }
  return name.includes('review')
}

/**
 * Re-export for callers that want a direct PRInfo tuple without the
 * LinkedPR wrapper.
 */
export function toLinkedPR(pr: PRInfo, source: LinkedPR['source']): LinkedPR {
  return { pr, source }
}

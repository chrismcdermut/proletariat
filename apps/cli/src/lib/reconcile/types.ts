/**
 * Tier 2 State Reconciler — Types (PRLT-1280)
 *
 * The reconciler is the safety net that fixes board drift when Tier 1
 * (event-driven hooks) misses an event. It polls the provider (GitHub for
 * PR state) and fires normal ticket transitions when it detects drift.
 *
 * Design constraints:
 * - Provider-agnostic: the reconciler core does not branch on provider type.
 *   It routes every transition through the existing provider adapter layer.
 * - Idempotent: running twice back-to-back must be safe. Every check asks
 *   "is current == expected?" and no-ops when they match.
 * - No LLM, no supervision tree, no daemon rewrite. One function on a timer.
 */

import type { PRInfo } from '../pr/index.js'
import type { Ticket } from '../pmo/types.js'

/**
 * Source of a linked PR. Used for logging and to decide which PMO mapping
 * to touch when the reconciler sees a transition is needed.
 */
export type LinkedPRSource =
  | 'ticket_branch' // PR resolved from the ticket's linked branch
  | 'external_map' // PR URL stored in pmo_external_execution_prs for this ticket's external id
  | 'branch_search' // PR discovered via GitHub search by branch name pattern (head:<ticket-id>/)

/**
 * A PR linked to a ticket, along with its provenance.
 */
export interface LinkedPR {
  /** Live PR info as reported by GitHub at the time of the reconcile cycle */
  pr: PRInfo
  /** How this PR was discovered for the ticket */
  source: LinkedPRSource
}

/**
 * A single transition the reconciler is about to apply (or would apply in dry-run).
 */
export interface ReconcileTransition {
  /** Ticket being moved */
  ticketId: string
  /** Ticket display title (for logging) */
  ticketTitle: string
  /** The project the ticket belongs to */
  projectId: string
  /** Provider name that owns this ticket (from resolver) */
  provider: string
  /** Ticket's state before the transition */
  fromState: string | null
  /** Ticket's state after the transition (target column name) */
  toState: string
  /** PR number that drove this transition, when available */
  prNumber?: number
  /** PR state that drove this transition (MERGED, CLOSED, OPEN) */
  prState?: PRInfo['state']
  /** Human-readable reason for the transition */
  reason: string
  /** ISO timestamp the reconciler decided on this transition */
  decidedAt: string
}

/**
 * Options for running a reconcile cycle.
 */
export interface ReconcileOptions {
  /** If true, compute transitions but do not apply them */
  dryRun?: boolean
  /** Working directory for GitHub CLI calls (git remote, gh pr view) */
  cwd?: string
  /** Optional callback for human-readable logs */
  log?: (msg: string) => void
  /**
   * Restrict reconciliation to a specific project. When omitted the
   * reconciler runs workspace-wide across every project.
   */
  projectId?: string
  /**
   * Injectable PR lookup. Tests use this to avoid the real gh CLI.
   * Implementations must query live — the reconciler is not allowed to
   * depend on a local PR cache.
   */
  prLookup?: PRLookupFn
  /**
   * Injectable branch search. Used when a ticket has no linked PRs
   * from branch or external map — falls back to searching GitHub by
   * branch name pattern. Tests use this to avoid the real gh CLI.
   */
  branchSearch?: BranchSearchFn
}

/**
 * Function signature for live PR lookup.
 *
 * The reconciler calls this once per PR reference. Implementations must
 * hit the remote GitHub API (gh CLI or the REST client) — a stale local
 * cache defeats the whole point of a Tier 2 reconciler.
 */
export type PRLookupFn = (ref: PRLookupRef, cwd?: string) => PRInfo | null

/**
 * A PR reference that can be resolved to a PRInfo.
 *
 * Tickets link to PRs via either their ticket branch (common for
 * prlt-managed work) or via a stored URL in the external execution
 * mapping table (common when the PR was opened outside prlt).
 */
export type PRLookupRef =
  | { kind: 'branch'; branch: string }
  | { kind: 'number'; number: number }
  | { kind: 'url'; url: string }

/**
 * Function signature for searching GitHub by branch name prefix.
 *
 * When a ticket has no `pr_number` metadata, no branch, and no entries
 * in the external execution map, the reconciler falls back to searching
 * GitHub for PRs whose head branch starts with any of the ticket's
 * known identifiers (e.g. `PRLT-1234/`, `TKT-081/`).
 *
 * Returns ALL matching PRs so the reconciler can evaluate them all.
 */
export type BranchSearchFn = (ticketIds: string[], cwd?: string) => PRInfo[]

/**
 * Report returned after a reconcile cycle completes.
 */
export interface ReconcileReport {
  /** Total number of tickets considered (across all scanned projects) */
  checked: number
  /** Transitions that were applied (or would be applied in dry-run) */
  applied: ReconcileTransition[]
  /** Transitions that the reconciler decided on but did not execute because of --dry-run */
  skipped: ReconcileTransition[]
  /** Transitions that failed to apply */
  failed: Array<{ transition: ReconcileTransition; error: string }>
  /** Non-fatal errors encountered while gathering state */
  errors: Array<{ ticketId: string; error: string }>
  /** ISO timestamp when the cycle started */
  startedAt: string
  /** ISO timestamp when the cycle finished */
  finishedAt: string
}

/**
 * Minimal view of a ticket the reconciler actually reads. Narrow surface
 * makes the reconciler easy to unit-test without fabricating full Ticket
 * objects.
 */
export type ReconcileTicket = Pick<
  Ticket,
  'id' | 'title' | 'projectId' | 'statusName' | 'statusCategory' | 'branch' | 'metadata'
>

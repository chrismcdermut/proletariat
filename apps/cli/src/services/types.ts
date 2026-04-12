/**
 * Service Layer Types
 *
 * Typed errors, result types, and common interfaces for the service layer.
 * Services sit between lib/ (data/infra) and commands (CLI/web/LLM).
 *
 * Contract:
 * - Services accept plain objects (not oclif flags)
 * - Services return structured results (not formatted strings)
 * - Services throw typed errors (not process.exit)
 * - Services have no dependency on oclif, inquirer, or any CLI framework
 */

import type { Ticket, TicketFilter, Board } from '../lib/pmo/types.js'
import type { PRInfo } from '../lib/pr/index.js'
import type { ReconcileReport } from '../lib/reconcile/types.js'
import type {
  UnifiedSession,
  CollectOptions,
  GroupedSessions,
} from '../lib/session/renderer.js'
import type { TicketProviderName } from '../lib/providers/types.js'

// =============================================================================
// Service Errors
// =============================================================================

/**
 * Error codes for service-layer errors.
 */
export type ServiceErrorCode =
  | 'NOT_FOUND'           // Resource not found
  | 'VALIDATION'          // Input validation failed
  | 'CONFLICT'            // State conflict (e.g., PR already merged)
  | 'PRECONDITION_FAILED' // Pre-condition not met (e.g., CI not green)
  | 'EXTERNAL_FAILURE'    // External system failure (GitHub, Linear, etc.)
  | 'PERMISSION_DENIED'   // Insufficient permissions
  | 'ABORTED'             // Operation aborted (e.g., user cancelled via callback)
  | 'INTERNAL'            // Unexpected internal error

/**
 * Base error class for all service-layer errors.
 * CLI commands catch these and format them for the user.
 * Web routes catch these and map to HTTP status codes.
 */
export class ServiceError extends Error {
  constructor(
    public readonly code: ServiceErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ServiceError'
  }
}

// =============================================================================
// Work Service Types
// =============================================================================

/**
 * Options for starting work on a ticket.
 * All interactive decisions (agent, environment, permissions) must be resolved
 * before calling the service — the service never prompts.
 */
export interface StartWorkOptions {
  /** Ticket ID to work on */
  ticketId: string
  /** Project ID (resolved from ticket or flag) */
  projectId?: string
  /** Agent name or 'ephemeral' for a throwaway agent */
  agent?: string
  /** Action ID to execute */
  actionId?: string
  /** Custom prompt (overrides action prompt) */
  prompt?: string
  /** Execution environment */
  environment?: 'host' | 'devcontainer'
  /** Permission mode */
  permissionMode?: 'danger' | 'safe'
  /** Display mode */
  displayMode?: 'terminal' | 'background' | 'foreground'
  /** PR mode: create PR on completion or not */
  prMode?: 'create-pr' | 'no-pr'
  /** Review gate mode */
  reviewGate?: 'required' | 'auto' | 'post'
  /** Merge method for auto PRs */
  mergeMethod?: 'merge' | 'squash' | 'rebase'
  /** Base branch for PR */
  baseBranch?: string
  /** Skip blockers check */
  skipBlockers?: boolean
  /** Additional network domains to allowlist */
  networkAllowlist?: string[]
  /** Model override */
  model?: string
  /** Executor type */
  executor?: string
  /** Maximum context window size */
  maxContext?: number
  /** Branch name override */
  branch?: string
  /** Whether to reuse an existing branch */
  reuseBranch?: boolean
  /** External issue reference (e.g., 'linear:PRLT-123') */
  fromIssue?: string
  /** Dry run — validate and report without spawning */
  dryRun?: boolean
}

/**
 * Result of starting work.
 */
export interface StartWorkResult {
  /** Whether the work was started successfully */
  success: boolean
  /** Ticket that work was started on */
  ticket: Ticket
  /** Agent name used */
  agentName: string
  /** Session ID (tmux session name) */
  sessionId?: string
  /** Execution environment used */
  environment: string
  /** Branch created/used */
  branch?: string
  /** Action that was executed */
  actionName?: string
  /** Dry-run report (only if dryRun was true) */
  dryRunReport?: DryRunReport
}

/**
 * Dry-run preflight report.
 */
export interface DryRunReport {
  passed: boolean
  checks: Array<{
    name: string
    passed: boolean
    message?: string
  }>
}

/**
 * Options for shipping work (merging PR, transitioning ticket).
 */
export interface ShipWorkOptions {
  /** Ticket ID to ship */
  ticketId?: string
  /** PR number (alternative to ticket — looks up linked ticket) */
  prNumber?: number
  /** Merge method */
  method?: 'merge' | 'squash' | 'rebase'
  /** Wait for CI to pass before merging */
  wait?: boolean
  /** Watch CI and auto-merge when green */
  whenGreen?: boolean
  /** Dry run — show what would happen */
  dryRun?: boolean
  /** Delete remote branch after merge */
  deleteBranch?: boolean
  /** Use admin privileges for merge */
  admin?: boolean
  /** Rebase sibling PRs after merge */
  rebaseSiblings?: boolean
  /** Skip ticket state transition */
  noTransition?: boolean
  /** Fail on conflicts instead of auto-rebasing */
  noRebase?: boolean
  /** Working directory for git/gh operations */
  cwd?: string
}

/**
 * Result of shipping work.
 */
export interface ShipWorkResult {
  success: boolean
  /** The ticket that was shipped */
  ticket?: Ticket
  /** PR that was merged */
  pr?: PRInfo
  /** Whether the PR was already merged before this call */
  alreadyMerged?: boolean
  /** Merge method used */
  method?: string
  /** Whether sibling PRs were rebased */
  siblingsRebased?: boolean
  /** Number of sibling PRs rebased */
  siblingCount?: number
  /** New ticket state after transition */
  newState?: string
  /** Dry-run details */
  dryRunDetails?: ShipDryRunDetails
}

/**
 * Dry-run details for ship.
 */
export interface ShipDryRunDetails {
  ticket?: Ticket
  pr?: PRInfo
  ciStatus: 'passed' | 'pending' | 'failed'
  hasConflicts: boolean
  actions: string[]
}

/**
 * Options for shipping all green PRs.
 */
export interface ShipAllOptions {
  /** Merge method */
  method?: 'merge' | 'squash' | 'rebase'
  /** Watch and auto-merge when green */
  whenGreen?: boolean
  /** Delete remote branches */
  deleteBranch?: boolean
  /** Rebase siblings */
  rebaseSiblings?: boolean
  /** Working directory */
  cwd?: string
}

/**
 * Result of shipping all green PRs.
 */
export interface ShipAllResult {
  success: boolean
  shipped: Array<{ ticket?: Ticket; pr: PRInfo }>
  skipped: Array<{ pr: PRInfo; reason: string }>
  failed: Array<{ pr: PRInfo; error: string }>
}

// =============================================================================
// Ticket Service Types
// =============================================================================

/**
 * Options for listing tickets.
 */
export interface ListTicketsOptions {
  /** Project ID to scope to */
  projectId?: string
  /** Filter options */
  filter?: TicketFilter
  /** Pagination limit */
  limit?: number
  /** Pagination offset */
  offset?: number
  /** Provider source override */
  source?: 'auto' | 'pmo' | 'linear'
  /** Linear team key */
  team?: string
}

/**
 * Result of listing tickets.
 */
export interface ListTicketsResult {
  success: boolean
  tickets: Ticket[]
  provider: TicketProviderName
  /** Board info for single-project views */
  board?: Board
  /** Total count before pagination */
  totalCount: number
}

/**
 * Result of getting a single ticket.
 */
export interface GetTicketResult {
  success: boolean
  ticket: Ticket | null
  provider: TicketProviderName
}

// =============================================================================
// Session Service Types
// =============================================================================

/**
 * Options for listing sessions.
 */
export interface ListSessionsOptions extends CollectOptions {
  /** Whether to include sessions from all HQs */
  allHqs?: boolean
}

/**
 * Result of listing sessions.
 */
export interface ListSessionsResult {
  success: boolean
  sessions: UnifiedSession[]
  grouped: GroupedSessions
}

// =============================================================================
// Reconcile Service Types
// =============================================================================

/**
 * Options for running reconciliation (extends lib options).
 */
export interface RunReconcileOptions {
  /** If true, compute transitions but do not apply */
  dryRun?: boolean
  /** Restrict to a specific project */
  projectId?: string
  /** Working directory for gh commands */
  cwd?: string
  /** Optional log callback */
  log?: (msg: string) => void
}

/**
 * Options for watch mode reconciliation.
 */
export interface WatchReconcileOptions extends RunReconcileOptions {
  /** Interval between cycles in ms (default: 5 min) */
  intervalMs?: number
  /** Callback to stop the loop */
  shouldStop?: () => boolean
  /** Callback after each cycle */
  onCycle?: (report: ReconcileReport) => void
}

// =============================================================================
// PR Service Types
// =============================================================================

/**
 * Options for creating a PR.
 */
export interface CreatePROptions {
  /** Ticket linked to this PR */
  ticketId?: string
  /** PR title */
  title?: string
  /** PR body/description */
  body?: string
  /** Base branch (defaults to repo default) */
  baseBranch?: string
  /** Create as draft */
  draft?: boolean
  /** Working directory for git/gh operations */
  cwd?: string
}

/**
 * Result of creating a PR.
 */
export interface CreatePRServiceResult {
  success: boolean
  pr?: PRInfo
  url?: string
  number?: number
  /** Ticket that was linked */
  ticket?: Ticket
  error?: string
}

/**
 * Options for merging a PR.
 */
export interface MergePROptions {
  /** PR number to merge */
  prNumber: number
  /** Merge method */
  method?: 'merge' | 'squash' | 'rebase'
  /** Delete branch after merge */
  deleteBranch?: boolean
  /** Use admin privileges */
  admin?: boolean
  /** Working directory */
  cwd?: string
}

/**
 * Result of merging a PR.
 */
export interface MergePRServiceResult {
  success: boolean
  pr?: PRInfo
  method?: string
  error?: string
}

/**
 * Options for checking CI status.
 */
export interface CheckCIOptions {
  /** PR number */
  prNumber: number
  /** Wait for CI to complete */
  wait?: boolean
  /** Working directory */
  cwd?: string
}

/**
 * Result of checking CI.
 */
export interface CheckCIResult {
  passed: boolean
  pending: boolean
  failed: boolean
  checks: Array<{
    name: string
    status: string
    conclusion?: string
  }>
}

/**
 * Result of resolving a linked ticket for a PR.
 */
export interface LinkedTicketResult {
  ticket: Ticket | null
  source?: 'metadata' | 'agent_work' | 'branch_name'
}

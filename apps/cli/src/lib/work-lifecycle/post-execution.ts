/**
 * Post-Execution Transition Hook
 *
 * Handles automatic ticket state transitions after an action execution completes.
 * Primary use case: when the implement action completes and a PR was created,
 * automatically move the ticket from In Progress to Review.
 *
 * Includes commit validation (PRLT-984): before auto-transitioning, checks that
 * meaningful code was committed on the branch. Prevents agents that only wrote
 * boilerplate (README) from being marked as ready for review.
 *
 * Uses the provider abstraction to write directly to the configured provider
 * (Linear, Jira, etc.) — not through the local PMO as a cache layer.
 * The local PMO is just the default provider for users without integrations.
 */

import Database from 'better-sqlite3'
import { getWorkColumnSetting, findColumnByName } from '../pmo/utils.js'
import type { StateCategory } from '../pmo/types.js'
import { resolveTicketProvider } from '../providers/resolver.js'
import type { TicketProvider, ProviderMoveResult, ProviderStorage } from '../providers/types.js'
import { tryValidateCommits, type CommitValidationResult } from '../execution/commit-validation.js'
import { getEventBus } from '../events/event-bus.js'

export interface PostExecutionContext {
  ticketId: string
  actionId?: string
  /** Agent name — used to resolve the agent's repository for commit validation */
  agentName?: string
  /** Branch name — used for commit validation */
  branch?: string
  /** Agent directory path — used to find the git repository */
  agentDir?: string
  /** Repo worktree names within agentDir */
  repoWorktrees?: string[]
}

export interface PostExecutionResult {
  transitioned: boolean
  fromState?: string
  toState?: string
  /** Which provider handled the transition */
  provider?: string
  /** Error from the provider (transition may have partially succeeded) */
  providerError?: string
  /** Commit validation result (PRLT-984) — present when validation was attempted */
  validation?: CommitValidationResult
  /** True if the transition was blocked by commit validation */
  blockedByValidation?: boolean
}

/**
 * Minimal storage interface for post-execution transitions.
 * @deprecated Use ProviderStorage from providers/types.ts instead.
 */
export interface PostExecutionStorage {
  getTicket: (id: string) => Promise<{
    id: string
    projectId?: string
    statusName?: string
    statusCategory?: StateCategory | null
    metadata?: Record<string, string> | null
  } | null>
  getProjectBoard: (projectId: string) => Promise<{
    columns: Array<{ name: string }>
  } | null>
  moveTicket: (projectId: string, ticketId: string, columnName: string) => Promise<unknown>
}

/**
 * Check if a completed execution should trigger an automatic state transition.
 *
 * When an execution completes and the ticket:
 * 1. Is in a "started" category (e.g., In Progress)
 * 2. Has a PR URL in its metadata
 * 3. Has meaningful code committed (not just boilerplate) — PRLT-984
 *
 * Then automatically move the ticket to the Review column via the appropriate
 * provider (Linear, Jira, or local PMO).
 *
 * Provider resolution:
 * - If the ticket has an external_source (e.g., 'linear') and that provider
 *   is configured, write directly to that provider's API.
 * - Otherwise, write to the local PMO (default for users without integrations).
 *
 * @param context - Execution context with ticket and optional action/agent info
 * @param storage - PMO storage instance for ticket operations
 * @param db - Database for work column settings and provider config
 * @returns Result indicating whether a transition occurred
 */
export async function handlePostExecutionTransition(
  context: PostExecutionContext,
  storage: PostExecutionStorage | ProviderStorage,
  db: Database.Database,
): Promise<PostExecutionResult> {
  // Get the ticket to check current state and PR status
  const ticket = await storage.getTicket(context.ticketId)
  if (!ticket || !ticket.projectId) {
    return { transitioned: false }
  }

  // Only auto-transition tickets that are in the "started" category (In Progress)
  if (ticket.statusCategory !== 'started') {
    return { transitioned: false }
  }

  // Check if a PR was created (PR URL exists in ticket metadata)
  const prUrl = ticket.metadata?.pr_url
  if (!prUrl) {
    return { transitioned: false }
  }

  // PRLT-984: Validate that meaningful code was committed before transitioning.
  // If agent info is available (branch + agentDir), run commit validation.
  // If validation fails, block the auto-transition.
  let validation: CommitValidationResult | undefined
  if (context.branch && context.agentDir) {
    try {
      const result = tryValidateCommits(
        context.agentDir,
        context.branch,
        context.repoWorktrees,
      )
      if (result) {
        validation = result
        if (!result.passed) {
          // Emit validation failed event for hooks
          if (context.agentName && context.branch) {
            getEventBus().emit('work:validation_failed', {
              workItemId: context.ticketId,
              executionId: context.actionId || '',
              agentName: context.agentName,
              branch: context.branch,
              validation: result,
              timestamp: new Date(),
            })
          }
          return {
            transitioned: false,
            fromState: ticket.statusName,
            validation,
            blockedByValidation: true,
          }
        }
      }
    } catch {
      // Non-fatal: validation failure shouldn't block everything.
      // If we can't validate, allow the transition to proceed.
    }
  }

  // Get the Review column name
  const targetColumnName = getWorkColumnSetting(db, 'review')

  // Get board columns to find the review column
  const board = await storage.getProjectBoard(ticket.projectId)
  if (!board) {
    return { transitioned: false }
  }

  const columnNames = board.columns.map(col => col.name)
  const reviewColumn = findColumnByName(columnNames, targetColumnName)
  if (!reviewColumn) {
    return { transitioned: false }
  }

  // Already in Review — skip
  if (ticket.statusName === reviewColumn) {
    return { transitioned: false }
  }

  // Resolve the appropriate provider for this ticket
  // Cast to ProviderStorage — at runtime the actual object is SQLiteStorage
  // which implements the full interface. For post-execution, only moveTicket is used.
  const provider = resolveTicketProvider(
    context.ticketId,
    ticket.projectId,
    db,
    storage as ProviderStorage,
    ticket.metadata,
  )

  // Move ticket via the provider
  const previousState = ticket.statusName
  const moveResult = await provider.moveTicket(context.ticketId, reviewColumn)

  if (!moveResult.success) {
    return {
      transitioned: false,
      fromState: previousState,
      toState: reviewColumn,
      provider: moveResult.provider,
      providerError: moveResult.error,
      validation,
    }
  }

  return {
    transitioned: true,
    fromState: previousState,
    toState: reviewColumn,
    provider: moveResult.provider,
    validation,
  }
}

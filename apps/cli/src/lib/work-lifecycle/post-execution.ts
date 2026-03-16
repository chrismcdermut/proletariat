/**
 * Post-Execution Transition Hook
 *
 * Handles automatic ticket state transitions after an action execution completes.
 * Primary use case: when the implement action completes and a PR was created,
 * automatically move the ticket from In Progress to Review.
 *
 * This hook replaces the need for a separate "create-pr" action. The implement
 * action's endPrompt handles PR creation via `prlt work ready --pr`, and this
 * hook ensures the state transition happens systematically.
 */

import Database from 'better-sqlite3'
import { getWorkColumnSetting, findColumnByName } from '../pmo/utils.js'
import type { StateCategory } from '../pmo/types.js'

export interface PostExecutionContext {
  ticketId: string
  actionId?: string
}

export interface PostExecutionResult {
  transitioned: boolean
  fromState?: string
  toState?: string
}

/** Minimal storage interface for post-execution transitions. */
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
 *
 * Then automatically move the ticket to the Review column.
 * If no PR was created, the ticket stays in its current state.
 *
 * @param context - Execution context with ticket and optional action info
 * @param storage - PMO storage instance for ticket operations
 * @param db - Database for work column settings
 * @returns Result indicating whether a transition occurred
 */
export async function handlePostExecutionTransition(
  context: PostExecutionContext,
  storage: PostExecutionStorage,
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

  // Move ticket to Review
  const previousState = ticket.statusName
  await storage.moveTicket(ticket.projectId, context.ticketId, reviewColumn)

  return {
    transitioned: true,
    fromState: previousState,
    toState: reviewColumn,
  }
}

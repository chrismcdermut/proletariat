/**
 * Work Transition Helper
 *
 * Shared logic for intent-based ticket transitions used by all work commands.
 * Each work command specifies a transition intent, and this module resolves
 * it to the correct provider state and moves the ticket.
 *
 * This replaces the old pattern of hardcoding column names via
 * getWorkColumnSetting() + findColumnByName() in each command.
 *
 * Transition is best-effort: if no mapping exists, the operation still runs.
 */

import type Database from 'better-sqlite3'
/**
 * Minimal ticket shape needed for intent-based transitions.
 * Accepts both full Ticket objects and partial objects from batch spawn paths.
 */
export interface TransitionTicket {
  id: string
  projectId?: string
  statusName?: string
}
import type { ProviderStorage, TicketProvider } from '../providers/types.js'
import type { TransitionIntent } from '../providers/state-intents.js'
import { TransitionMapStore } from '../providers/transition-map.js'
import { getWorkColumnSetting, findColumnByName, type WorkColumnType } from './settings.js'

/**
 * Result of attempting a ticket transition.
 */
export interface TransitionResult {
  /** Whether the ticket was moved successfully */
  moved: boolean
  /** The resolved target column name, if any */
  targetColumn?: string
  /** The previous column name */
  previousColumn?: string
  /** Human-readable explanation of what happened */
  message?: string
}

/**
 * Map from transition intents to the legacy WorkColumnType settings keys.
 * Used as a fallback when no transition map exists.
 */
const INTENT_TO_COLUMN_TYPE: Partial<Record<TransitionIntent, WorkColumnType>> = {
  started: 'in_progress',
  needs_review: 'review',
  completed: 'done',
  ready: 'planned',
}

/**
 * Resolve an intent to a target column name on the board.
 *
 * Resolution order:
 * 1. pmo_transition_map — explicit user-confirmed mappings
 * 2. Legacy column settings (column_in_progress, column_review, column_done)
 * 3. Built-in default column names
 *
 * This only resolves the name — it does not move the ticket.
 */
export function resolveIntentToColumn(
  db: Database.Database,
  intent: TransitionIntent,
  providerName: string,
  columnNames: string[],
): string | null {
  // 1. Check pmo_transition_map
  try {
    const store = new TransitionMapStore(db)
    const mappedName = store.resolveIntent(providerName, intent)
    if (mappedName) {
      const match = findColumnByName(columnNames, mappedName)
      if (match) return match
    }
  } catch {
    // Table may not exist yet — fall through
  }

  // 2. Fall back to legacy column settings
  const columnType = INTENT_TO_COLUMN_TYPE[intent]
  if (columnType) {
    const settingName = getWorkColumnSetting(db, columnType)
    const match = findColumnByName(columnNames, settingName)
    if (match) return match
  }

  return null
}

/**
 * Move a ticket based on a transition intent.
 *
 * This is the primary function work commands should call for transitions.
 * It resolves the intent to a column name, moves the ticket in the local PMO,
 * and optionally syncs to the external provider.
 *
 * @param opts.db - Database instance
 * @param opts.storage - PMO storage instance
 * @param opts.ticket - The ticket to move
 * @param opts.intent - The transition intent
 * @param opts.providerName - Provider name for transition map lookup
 * @param opts.resolveProvider - Function to resolve the external ticket provider
 * @param opts.log - Optional logging callback
 * @returns TransitionResult
 */
export async function moveTicketByIntent(opts: {
  db: Database.Database
  storage: ProviderStorage
  ticket: TransitionTicket
  intent: TransitionIntent
  providerName: string
  resolveProvider?: (ticketId: string, projectId: string) => Promise<TicketProvider>
  log?: (msg: string) => void
}): Promise<TransitionResult> {
  const { db, storage, ticket, intent, providerName, resolveProvider, log } = opts

  if (!ticket.projectId) {
    return { moved: false, message: 'Ticket has no project' }
  }

  const board = await storage.getProjectBoard(ticket.projectId)
  const columnNames = board ? board.columns.map(col => col.name) : []

  const targetColumn = resolveIntentToColumn(db, intent, providerName, columnNames)
  if (!targetColumn) {
    return { moved: false, message: `No column found for intent '${intent}'` }
  }

  const previousColumn = ticket.statusName

  // Skip if already in target state
  if (previousColumn && previousColumn.toLowerCase() === targetColumn.toLowerCase()) {
    return { moved: false, targetColumn, previousColumn, message: 'Already in target state' }
  }

  // Determine which provider handles this ticket
  let resolvedProvider: TicketProvider | null = null
  if (resolveProvider) {
    try {
      resolvedProvider = await resolveProvider(ticket.id, ticket.projectId)
    } catch {
      // Fall through to local PMO
    }
  }

  const isExternalProvider = resolvedProvider && resolvedProvider.name !== 'pmo'

  // For external providers (Linear, etc.), go directly to the provider — no local PMO mirror
  if (isExternalProvider && resolvedProvider) {
    try {
      const result = await resolvedProvider.moveTicket(ticket.id, targetColumn)
      if (result.success) {
        if (log) log(`Moved via ${result.provider}: ${targetColumn}`)
        return { moved: true, targetColumn, previousColumn }
      }
      return {
        moved: false,
        targetColumn,
        previousColumn,
        message: `Provider move failed: ${result.error}`,
      }
    } catch (error) {
      return {
        moved: false,
        targetColumn,
        previousColumn,
        message: `Failed to move via provider: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  // For local PMO provider, move in local storage
  try {
    await storage.moveTicket(ticket.projectId, ticket.id, targetColumn)
  } catch (error) {
    const code = (error as { code?: string }).code
    if (code === 'SQLITE_READONLY') {
      // PRLT-1183: In container environments the HQ database is mounted read-only.
      if (log) log('Local PMO update skipped (read-only database)')
      return { moved: false, targetColumn, previousColumn, message: 'Read-only database' }
    }
    return {
      moved: false,
      targetColumn,
      previousColumn,
      message: `Failed to move: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  return {
    moved: true,
    targetColumn,
    previousColumn,
  }
}

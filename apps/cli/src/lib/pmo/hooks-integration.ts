/**
 * Hooks Integration for PMO
 *
 * Provides hooks-aware wrappers for PMO storage operations.
 * Commands can use these functions to automatically emit events
 * when tickets/epics are created, updated, moved, or deleted.
 */

import * as path from 'path'
import {
  HooksManager,
  initializeHooks,
  isHooksManagerInitialized,
  getHooksManager,
} from '../hooks/index.js'
import {
  emitTicketCreated,
  emitTicketMoved,
  emitTicketUpdated,
  emitTicketStatusChanged,
  emitTicketDeleted,
  emitTicketCompleted,
  emitEpicCreated,
  emitEpicUpdated,
  emitEpicStatusChanged,
  emitEpicDeleted,
  determineTicketEvents,
  determineEpicEvents,
  isCompletedStatus,
} from '../hooks/storage-hooks.js'
import { SQLiteStorage } from './storage-sqlite.js'
import { Ticket, Epic, TicketStatus, EpicStatus } from './types.js'
import Database from 'better-sqlite3'

// =============================================================================
// Hooks Manager Initialization
// =============================================================================

/**
 * Get or initialize the hooks manager for a workspace.
 * Safe to call multiple times - will return existing manager if initialized.
 */
export function getOrInitHooksManager(options: {
  workspacePath: string
  pmoPath: string
  db?: Database.Database
  log?: (message: string) => void
}): HooksManager | null {
  const { workspacePath, pmoPath, db, log = () => {} } = options

  try {
    if (isHooksManagerInitialized()) {
      return getHooksManager()
    }
    return initializeHooks({ workspacePath, pmoPath, db, log })
  } catch {
    // Hooks initialization failed - return null to indicate hooks are not available
    return null
  }
}

// =============================================================================
// Hooks-Aware Storage Operations
// =============================================================================

/**
 * Create a ticket and emit hooks event
 */
export async function createTicketWithHooks(
  storage: SQLiteStorage,
  ticketData: Partial<Ticket>,
  hooksManager: HooksManager | null
): Promise<Ticket> {
  const ticket = await storage.createTicket(ticketData)
  const projectId = storage.getCurrentProjectId()

  if (hooksManager) {
    await emitTicketCreated(hooksManager, ticket, projectId)
  }

  return ticket
}

/**
 * Update a ticket and emit appropriate hooks events
 */
export async function updateTicketWithHooks(
  storage: SQLiteStorage,
  ticketId: string,
  changes: Partial<Ticket>,
  hooksManager: HooksManager | null
): Promise<Ticket> {
  // Get original ticket for comparison
  const originalTicket = await storage.getTicket(ticketId)

  // Perform the update
  const updatedTicket = await storage.updateTicket(ticketId, changes)
  const projectId = storage.getCurrentProjectId()

  if (hooksManager && originalTicket) {
    const events = determineTicketEvents(originalTicket, changes)

    // Emit updated event
    if (events.emitUpdated) {
      const previousValues: Partial<Ticket> = {}
      for (const key of Object.keys(changes)) {
        previousValues[key as keyof Ticket] = originalTicket[key as keyof Ticket] as never
      }
      await emitTicketUpdated(hooksManager, updatedTicket, changes, previousValues, projectId)
    }

    // Emit status changed event
    if (events.emitStatusChanged && events.toStatus) {
      await emitTicketStatusChanged(
        hooksManager,
        updatedTicket,
        events.fromStatus,
        events.toStatus,
        projectId
      )
    }

    // Emit completed event
    if (events.emitCompleted) {
      await emitTicketCompleted(hooksManager, updatedTicket, projectId)
    }
  }

  return updatedTicket
}

/**
 * Move a ticket and emit hooks events
 */
export async function moveTicketWithHooks(
  storage: SQLiteStorage,
  ticketId: string,
  targetColumn: string,
  position: number | undefined,
  hooksManager: HooksManager | null
): Promise<Ticket> {
  // Get original ticket for comparison
  const originalTicket = await storage.getTicket(ticketId)
  const fromColumn = originalTicket?.column || ''

  // Perform the move
  const movedTicket = await storage.moveTicket(ticketId, targetColumn, position)
  const projectId = storage.getCurrentProjectId()

  if (hooksManager && fromColumn !== targetColumn) {
    await emitTicketMoved(hooksManager, movedTicket, fromColumn, targetColumn, projectId)
  }

  return movedTicket
}

/**
 * Delete a ticket and emit hooks event
 */
export async function deleteTicketWithHooks(
  storage: SQLiteStorage,
  ticketId: string,
  hooksManager: HooksManager | null
): Promise<void> {
  // Get ticket snapshot before deletion
  const ticket = await storage.getTicket(ticketId)
  const projectId = storage.getCurrentProjectId()

  // Perform deletion
  await storage.deleteTicket(ticketId)

  if (hooksManager && ticket) {
    await emitTicketDeleted(hooksManager, ticketId, ticket, projectId)
  }
}

/**
 * Create an epic and emit hooks event
 */
export async function createEpicWithHooks(
  storage: SQLiteStorage,
  epicData: Partial<Epic>,
  hooksManager: HooksManager | null
): Promise<Epic> {
  const epic = await storage.createEpic(epicData)
  const projectId = storage.getCurrentProjectId()

  if (hooksManager) {
    await emitEpicCreated(hooksManager, epic, projectId)
  }

  return epic
}

/**
 * Update an epic and emit appropriate hooks events
 */
export async function updateEpicWithHooks(
  storage: SQLiteStorage,
  epicId: string,
  changes: Partial<Epic>,
  hooksManager: HooksManager | null
): Promise<Epic> {
  // Get original epic for comparison
  const originalEpic = await storage.getEpic(epicId)

  // Perform the update
  const updatedEpic = await storage.updateEpic(epicId, changes)
  const projectId = storage.getCurrentProjectId()

  if (hooksManager && originalEpic) {
    const events = determineEpicEvents(originalEpic, changes)

    // Emit updated event
    if (events.emitUpdated) {
      const previousValues: Partial<Epic> = {}
      for (const key of Object.keys(changes)) {
        previousValues[key as keyof Epic] = originalEpic[key as keyof Epic] as never
      }
      await emitEpicUpdated(hooksManager, updatedEpic, changes, previousValues, projectId)
    }

    // Emit status changed event
    if (events.emitStatusChanged && events.toStatus) {
      await emitEpicStatusChanged(
        hooksManager,
        updatedEpic,
        events.fromStatus,
        events.toStatus,
        projectId
      )
    }
  }

  return updatedEpic
}

/**
 * Delete an epic and emit hooks event
 */
export async function deleteEpicWithHooks(
  storage: SQLiteStorage,
  epicId: string,
  hooksManager: HooksManager | null
): Promise<void> {
  // Get epic snapshot before deletion
  const epic = await storage.getEpic(epicId)
  const projectId = storage.getCurrentProjectId()

  // Perform deletion
  await storage.deleteEpic(epicId)

  if (hooksManager && epic) {
    await emitEpicDeleted(hooksManager, epicId, epic, projectId)
  }
}

// =============================================================================
// Extended PMO Context with Hooks
// =============================================================================

/**
 * Extended PMO context that includes hooks manager
 */
export interface PMOContextWithHooks {
  pmoPath: string
  storage: SQLiteStorage
  columns: string[]
  storageType: 'sqlite' | 'git'
  projectId: string
  projectName: string
  hooksManager: HooksManager | null
  workspacePath: string
}

/**
 * Find workspace path from PMO path
 * The workspace.db is at {workspace}/.proletariat/workspace.db
 * PMO could be at {workspace}/pmo or {workspace}/repos/{repo}/pmo
 */
export function findWorkspaceFromPMO(pmoPath: string): string {
  // Walk up to find .proletariat directory
  let current = pmoPath
  while (current !== path.dirname(current)) {
    const proletariatPath = path.join(current, '.proletariat')
    if (require('fs').existsSync(proletariatPath)) {
      return current
    }
    current = path.dirname(current)
  }
  // Default to parent of PMO
  return path.dirname(pmoPath)
}

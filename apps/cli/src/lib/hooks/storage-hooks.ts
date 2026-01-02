/**
 * Storage Hooks Integration
 *
 * Provides event emission for PMO storage operations.
 * This module wraps storage operations to emit hooks events
 * without modifying the core storage implementation.
 */

import {
  TicketCreatedPayload,
  TicketMovedPayload,
  TicketUpdatedPayload,
  TicketStatusChangedPayload,
  TicketDeletedPayload,
  TicketCompletedPayload,
  EpicCreatedPayload,
  EpicUpdatedPayload,
  EpicStatusChangedPayload,
  EpicDeletedPayload,
} from './types.js'
import { HooksManager } from './manager.js'
import { Ticket, Epic, TicketStatus, EpicStatus } from '../pmo/types.js'

// =============================================================================
// Ticket Events
// =============================================================================

/**
 * Emit ticket.created event
 */
export async function emitTicketCreated(
  manager: HooksManager,
  ticket: Ticket,
  projectId: string
): Promise<void> {
  const payload: TicketCreatedPayload = {
    timestamp: new Date(),
    projectId,
    ticket,
  }
  await manager.emit('ticket.created', payload)
}

/**
 * Emit ticket.moved event
 */
export async function emitTicketMoved(
  manager: HooksManager,
  ticket: Ticket,
  fromColumn: string,
  toColumn: string,
  projectId: string
): Promise<void> {
  const payload: TicketMovedPayload = {
    timestamp: new Date(),
    projectId,
    ticket,
    fromColumn,
    toColumn,
  }
  await manager.emit('ticket.moved', payload)
}

/**
 * Emit ticket.updated event
 */
export async function emitTicketUpdated(
  manager: HooksManager,
  ticket: Ticket,
  changes: Partial<Ticket>,
  previousValues: Partial<Ticket>,
  projectId: string
): Promise<void> {
  const payload: TicketUpdatedPayload = {
    timestamp: new Date(),
    projectId,
    ticket,
    changes,
    previousValues,
  }
  await manager.emit('ticket.updated', payload)
}

/**
 * Emit ticket.status_changed event
 */
export async function emitTicketStatusChanged(
  manager: HooksManager,
  ticket: Ticket,
  fromStatus: TicketStatus | undefined,
  toStatus: TicketStatus,
  projectId: string
): Promise<void> {
  const payload: TicketStatusChangedPayload = {
    timestamp: new Date(),
    projectId,
    ticket,
    fromStatus,
    toStatus,
  }
  await manager.emit('ticket.status_changed', payload)
}

/**
 * Emit ticket.deleted event
 */
export async function emitTicketDeleted(
  manager: HooksManager,
  ticketId: string,
  ticket: Ticket,
  projectId: string
): Promise<void> {
  const payload: TicketDeletedPayload = {
    timestamp: new Date(),
    projectId,
    ticketId,
    ticket,
  }
  await manager.emit('ticket.deleted', payload)
}

/**
 * Emit ticket.completed event
 */
export async function emitTicketCompleted(
  manager: HooksManager,
  ticket: Ticket,
  projectId: string
): Promise<void> {
  const payload: TicketCompletedPayload = {
    timestamp: new Date(),
    projectId,
    ticket,
  }
  await manager.emit('ticket.completed', payload)
}

// =============================================================================
// Epic Events
// =============================================================================

/**
 * Emit epic.created event
 */
export async function emitEpicCreated(
  manager: HooksManager,
  epic: Epic,
  projectId: string
): Promise<void> {
  const payload: EpicCreatedPayload = {
    timestamp: new Date(),
    projectId,
    epic,
  }
  await manager.emit('epic.created', payload)
}

/**
 * Emit epic.updated event
 */
export async function emitEpicUpdated(
  manager: HooksManager,
  epic: Epic,
  changes: Partial<Epic>,
  previousValues: Partial<Epic>,
  projectId: string
): Promise<void> {
  const payload: EpicUpdatedPayload = {
    timestamp: new Date(),
    projectId,
    epic,
    changes,
    previousValues,
  }
  await manager.emit('epic.updated', payload)
}

/**
 * Emit epic.status_changed event
 */
export async function emitEpicStatusChanged(
  manager: HooksManager,
  epic: Epic,
  fromStatus: EpicStatus | undefined,
  toStatus: EpicStatus,
  projectId: string
): Promise<void> {
  const payload: EpicStatusChangedPayload = {
    timestamp: new Date(),
    projectId,
    epic,
    fromStatus,
    toStatus,
  }
  await manager.emit('epic.status_changed', payload)
}

/**
 * Emit epic.deleted event
 */
export async function emitEpicDeleted(
  manager: HooksManager,
  epicId: string,
  epic: Epic,
  projectId: string
): Promise<void> {
  const payload: EpicDeletedPayload = {
    timestamp: new Date(),
    projectId,
    epicId,
    epic,
  }
  await manager.emit('epic.deleted', payload)
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Check if a status indicates completion
 */
export function isCompletedStatus(status: TicketStatus): boolean {
  return status === 'done' || status === 'cancelled'
}

/**
 * Determine which events to emit based on changes
 */
export function determineTicketEvents(
  originalTicket: Ticket | null,
  changes: Partial<Ticket>
): {
  emitUpdated: boolean
  emitStatusChanged: boolean
  emitCompleted: boolean
  emitMoved: boolean
  fromStatus?: TicketStatus
  toStatus?: TicketStatus
  fromColumn?: string
  toColumn?: string
} {
  const result = {
    emitUpdated: Object.keys(changes).length > 0,
    emitStatusChanged: false,
    emitCompleted: false,
    emitMoved: false,
    fromStatus: undefined as TicketStatus | undefined,
    toStatus: undefined as TicketStatus | undefined,
    fromColumn: undefined as string | undefined,
    toColumn: undefined as string | undefined,
  }

  // Check for status change
  if (changes.status && originalTicket?.status !== changes.status) {
    result.emitStatusChanged = true
    result.fromStatus = originalTicket?.status
    result.toStatus = changes.status

    // Check if completed
    if (isCompletedStatus(changes.status) && (!originalTicket || !isCompletedStatus(originalTicket.status))) {
      result.emitCompleted = true
    }
  }

  // Check for column change
  if (changes.column && originalTicket?.column !== changes.column) {
    result.emitMoved = true
    result.fromColumn = originalTicket?.column
    result.toColumn = changes.column
  }

  return result
}

/**
 * Determine which events to emit for epic changes
 */
export function determineEpicEvents(
  originalEpic: Epic | null,
  changes: Partial<Epic>
): {
  emitUpdated: boolean
  emitStatusChanged: boolean
  fromStatus?: EpicStatus
  toStatus?: EpicStatus
} {
  const result = {
    emitUpdated: Object.keys(changes).length > 0,
    emitStatusChanged: false,
    fromStatus: undefined as EpicStatus | undefined,
    toStatus: undefined as EpicStatus | undefined,
  }

  // Check for status change
  if (changes.status && originalEpic?.status !== changes.status) {
    result.emitStatusChanged = true
    result.fromStatus = originalEpic?.status
    result.toStatus = changes.status
  }

  return result
}

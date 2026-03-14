/**
 * Execution Runtime Event Definitions
 *
 * Typed event payloads emitted by the execution runtime during agent lifecycle
 * and the PMO ticket system. These events enable workflow automation, logging,
 * orchestration hooks, and outbound sync to external issue trackers.
 */

import type { ExecutionStatus } from '../execution/types.js'
import type { StateCategory } from '../pmo/types.js'
import type {
  WorkStartedEvent,
  WorkStatusChangedEvent,
  WorkPRCreatedEvent,
  WorkCompletedEvent,
} from '../work-lifecycle/events.js'

// =============================================================================
// Event Payloads
// =============================================================================

/** Emitted when an agent session is spawned. */
export interface AgentSpawnedEvent {
  sessionId: string
  runner: string
  task: string
  workdir: string
  background: boolean
  timestamp: Date
}

/** Emitted when an agent session status changes. */
export interface AgentStatusChangeEvent {
  sessionId: string
  runner: string
  previousStatus: ExecutionStatus | 'running' | 'done' | 'error'
  newStatus: ExecutionStatus | 'running' | 'done' | 'error'
  timestamp: Date
}

/** Emitted when a message is sent to an agent session (poke). */
export interface AgentPokedEvent {
  sessionId: string
  runner: string
  message: string
  timestamp: Date
}

/** Emitted when an agent session is stopped. */
export interface AgentStoppedEvent {
  sessionId: string
  runner: string
  reason: 'manual' | 'completed' | 'error'
  timestamp: Date
}

/** Emitted when an agent session encounters an error. */
export interface AgentErrorEvent {
  sessionId: string
  runner: string
  error: string
  timestamp: Date
}

/** Emitted when agent output is captured (peek). */
export interface AgentOutputEvent {
  sessionId: string
  runner: string
  output: string
  lines: number
  timestamp: Date
}

// =============================================================================
// Ticket Events
// =============================================================================

/** Emitted when a ticket's status changes (moved to a different column/status). */
export interface TicketStatusChangedEvent {
  ticketId: string
  projectId: string
  previousStatusId: string | null
  previousStatusName: string | null
  previousStatusCategory: StateCategory | null
  newStatusId: string
  newStatusName: string | null
  newStatusCategory: StateCategory | null
  timestamp: Date
}

/** Emitted when a PR is linked to a ticket. */
export interface TicketPRLinkedEvent {
  ticketId: string
  projectId: string
  prUrl: string
  prTitle: string | null
  timestamp: Date
}

// =============================================================================
// Event Map
// =============================================================================

/**
 * Maps event names to their payload types.
 * Used by EventBus for type-safe subscriptions and emissions.
 */
export interface RuntimeEventMap {
  'agent:spawned': AgentSpawnedEvent
  'agent:status_change': AgentStatusChangeEvent
  'agent:poked': AgentPokedEvent
  'agent:stopped': AgentStoppedEvent
  'agent:error': AgentErrorEvent
  'agent:output': AgentOutputEvent
  'ticket:status_changed': TicketStatusChangedEvent
  'ticket:pr_linked': TicketPRLinkedEvent

  // Work-lifecycle domain events (provider-agnostic)
  'work:started': WorkStartedEvent
  'work:status_changed': WorkStatusChangedEvent
  'work:pr_created': WorkPRCreatedEvent
  'work:completed': WorkCompletedEvent
}

/** Union of all event names. */
export type RuntimeEventName = keyof RuntimeEventMap

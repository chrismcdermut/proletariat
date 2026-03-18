/**
 * Container GC — Event-Driven Garbage Collection for Docker Containers
 *
 * Subscribes to agent lifecycle events on the EventBus and triggers
 * container cleanup when agents complete, error, or are stopped.
 *
 * This is the integration layer between the event system and
 * the container-cleanup module.
 *
 * @see TKT-172 / PRLT-1005
 */

import { getEventBus, type EventBus } from '../events/event-bus.js'
import type { AgentStoppedEvent, AgentErrorEvent, AgentStatusChangeEvent } from '../events/events.js'
import { cleanupContainer, type ContainerCleanupResult } from './container-cleanup.js'
import { ExecutionStorage } from './storage.js'

// =============================================================================
// Types
// =============================================================================

export interface ContainerGCOptions {
  /** EventBus to subscribe to (defaults to global singleton) */
  bus?: EventBus
  /** ExecutionStorage for looking up container IDs from execution records */
  executionStorage?: ExecutionStorage
  /** Callback for logging cleanup events */
  onCleanup?: (event: {
    trigger: string
    containerId: string
    agentName?: string
    result: ContainerCleanupResult
  }) => void
}

// =============================================================================
// Container GC Handler
// =============================================================================

/**
 * Handles container cleanup by looking up the execution's container ID
 * and cleaning it up if the execution is in a terminal state.
 */
function handleAgentCompletion(
  sessionId: string,
  trigger: string,
  storage: ExecutionStorage | undefined,
  onCleanup?: ContainerGCOptions['onCleanup'],
): void {
  if (!storage) return

  // Find the execution by sessionId
  const runningExecutions = storage.listExecutions({ status: 'running' })
  const startingExecutions = storage.listExecutions({ status: 'starting' })
  const allActive = [...runningExecutions, ...startingExecutions]

  // Find the execution that matches this session
  const execution = allActive.find(e => e.sessionId === sessionId)
  if (!execution?.containerId) return

  // Don't cleanup if the execution environment isn't a container
  if (execution.environment !== 'devcontainer' && execution.environment !== 'docker') return

  const containerId = execution.containerId

  // Check if any OTHER active executions share this container
  const otherActive = allActive.filter(
    e => e.id !== execution.id &&
         e.containerId &&
         (e.containerId === containerId ||
          e.containerId.startsWith(containerId) ||
          containerId.startsWith(e.containerId))
  )

  if (otherActive.length > 0) {
    // Container still has active work — don't clean up
    return
  }

  // Clean up the container
  const result = cleanupContainer(containerId)

  onCleanup?.({
    trigger,
    containerId: execution.containerId,
    agentName: execution.agentName,
    result,
  })
}

// =============================================================================
// Public API
// =============================================================================

/** Unsubscribe functions returned by initContainerGC */
let _unsubscribers: Array<() => void> = []

/**
 * Initialize event-driven container garbage collection.
 *
 * Subscribes to agent lifecycle events and triggers container cleanup
 * when agents complete their work. Call stopContainerGC() to unsubscribe.
 *
 * Events that trigger cleanup:
 * - `agent:stopped` (reason: 'completed' | 'error' | 'manual')
 * - `agent:status_change` (when newStatus is 'done' or 'error')
 */
export function initContainerGC(options: ContainerGCOptions = {}): void {
  // Clean up any existing subscriptions first
  stopContainerGC()

  const bus = options.bus ?? getEventBus()
  const storage = options.executionStorage

  // Subscribe to agent:stopped events
  const unsubStopped = bus.on('agent:stopped', (event: AgentStoppedEvent) => {
    handleAgentCompletion(
      event.sessionId,
      `agent:stopped:${event.reason}`,
      storage,
      options.onCleanup,
    )
  })

  // Subscribe to agent:status_change for done/error transitions
  const unsubStatusChange = bus.on('agent:status_change', (event: AgentStatusChangeEvent) => {
    if (event.newStatus === 'done' || event.newStatus === 'error' ||
        event.newStatus === 'completed' || event.newStatus === 'failed' ||
        event.newStatus === 'stopped') {
      handleAgentCompletion(
        event.sessionId,
        `agent:status_change:${event.newStatus}`,
        storage,
        options.onCleanup,
      )
    }
  })

  // Subscribe to agent:error events
  const unsubError = bus.on('agent:error', (event: AgentErrorEvent) => {
    handleAgentCompletion(
      event.sessionId,
      'agent:error',
      storage,
      options.onCleanup,
    )
  })

  _unsubscribers = [unsubStopped, unsubStatusChange, unsubError]
}

/**
 * Stop event-driven container garbage collection.
 * Unsubscribes all event listeners.
 */
export function stopContainerGC(): void {
  for (const unsub of _unsubscribers) {
    unsub()
  }
  _unsubscribers = []
}

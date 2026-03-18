/**
 * Container Cleanup Listener — Event-driven Docker container GC
 *
 * Subscribes to agent completion events on the EventBus and triggers
 * container cleanup. Containers are removed when:
 *
 * 1. An agent is stopped (manual or completed)
 * 2. An agent encounters an error
 * 3. Work is completed (ticket moved to Done)
 * 4. A PR is created (work ready for review)
 *
 * This is triggered GC, NOT TTL-based cleanup.
 *
 * TKT-172 / PRLT-1005
 */

import type { EventBus } from '../events/event-bus.js'
import { getEventBus } from '../events/event-bus.js'
import { cleanupExecutionContainer, type ContainerCleanupResult } from './container-cleanup.js'
import type { ExecutionStorage } from '../execution/storage.js'

export interface CleanupListenerOptions {
  /** Optional logger for cleanup messages */
  log?: (message: string) => void
  /** EventBus instance (defaults to global singleton) */
  eventBus?: EventBus
  /** ExecutionStorage for looking up container IDs from execution records */
  executionStorage?: ExecutionStorage
}

/**
 * ContainerCleanupListener subscribes to agent lifecycle events
 * and cleans up Docker containers when agents complete their work.
 */
export class ContainerCleanupListener {
  private unsubscribers: Array<() => void> = []
  private bus: EventBus
  private log: (message: string) => void
  private executionStorage?: ExecutionStorage

  constructor(options?: CleanupListenerOptions) {
    this.bus = options?.eventBus ?? getEventBus()
    this.log = options?.log ?? (() => {})
    this.executionStorage = options?.executionStorage
  }

  /**
   * Start listening for agent completion events.
   * Call stop() to unsubscribe.
   */
  start(): void {
    // Listen for agent stopped events
    this.unsubscribers.push(
      this.bus.on('agent:stopped', (event) => {
        this.handleAgentCompletion(event.sessionId, `agent stopped (${event.reason})`)
      }),
    )

    // Listen for agent error events
    this.unsubscribers.push(
      this.bus.on('agent:error', (event) => {
        this.handleAgentCompletion(event.sessionId, `agent error: ${event.error}`)
      }),
    )

    // Listen for work completed events
    this.unsubscribers.push(
      this.bus.on('work:completed', (event) => {
        this.handleWorkCompletion(event.workItemId, 'work completed')
      }),
    )

    // Listen for PR created events (signals agent work is done)
    this.unsubscribers.push(
      this.bus.on('work:pr_created', (event) => {
        this.handleWorkCompletion(event.workItemId, 'PR created')
      }),
    )
  }

  /**
   * Stop listening and unsubscribe from all events.
   */
  stop(): void {
    for (const unsub of this.unsubscribers) {
      unsub()
    }
    this.unsubscribers = []
  }

  /**
   * Handle agent completion by looking up the container ID from the session/execution.
   */
  private handleAgentCompletion(sessionId: string, reason: string): void {
    if (!this.executionStorage) return

    // Try to find the execution by session ID
    const executions = this.executionStorage.listExecutions({ limit: 50 })
    const execution = executions.find(e => e.sessionId === sessionId)

    if (!execution?.containerId) return

    this.log(`Container cleanup triggered: ${reason} (container: ${execution.containerId.substring(0, 12)})`)
    const result = cleanupExecutionContainer(execution.containerId)
    this.logCleanupResult(result)
  }

  /**
   * Handle work completion by looking up the container from the ticket's execution.
   */
  private handleWorkCompletion(workItemId: string, reason: string): void {
    if (!this.executionStorage) return

    // Find the execution for this work item (ticket)
    const execution = this.executionStorage.getRunningExecution(workItemId)
    if (!execution?.containerId) return

    this.log(`Container cleanup triggered: ${reason} for ${workItemId} (container: ${execution.containerId.substring(0, 12)})`)
    const result = cleanupExecutionContainer(execution.containerId)
    this.logCleanupResult(result)
  }

  private logCleanupResult(result: ContainerCleanupResult): void {
    if (result.removed.length > 0) {
      this.log(`  Removed ${result.removed.length} container(s)`)
    }
    for (const err of result.errors) {
      this.log(`  Error cleaning ${err.containerId.substring(0, 12)}: ${err.error}`)
    }
  }
}

// =============================================================================
// Singleton
// =============================================================================

let _listener: ContainerCleanupListener | undefined

/**
 * Initialize the container cleanup listener.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function initContainerCleanupListener(
  options?: CleanupListenerOptions,
): ContainerCleanupListener {
  if (!_listener) {
    _listener = new ContainerCleanupListener(options)
    _listener.start()
  }
  return _listener
}

/**
 * Stop the container cleanup listener (primarily for testing).
 */
export function stopContainerCleanupListener(): void {
  if (_listener) {
    _listener.stop()
    _listener = undefined
  }
}

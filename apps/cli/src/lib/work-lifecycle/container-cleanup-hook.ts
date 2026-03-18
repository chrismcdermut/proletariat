/**
 * Container Cleanup Lifecycle Hook
 *
 * Subscribes to agent lifecycle events on the global EventBus and
 * automatically cleans up Docker containers when agents complete work.
 *
 * This is a triggered cleanup (not TTL-based): containers are removed
 * when the agent:stopped event fires or when stale executions are detected.
 */

import { getEventBus } from '../events/event-bus.js'
import { cleanupAgentContainer } from '../execution/container-cleanup.js'

/**
 * ContainerCleanupHook listens for agent completion events and
 * removes the associated Docker container.
 *
 * Cleanup is fire-and-forget: failures are logged but never block
 * the event emission chain.
 */
export class ContainerCleanupHook {
  private unsubscribers: Array<() => void> = []

  /**
   * Start listening for agent lifecycle events.
   */
  start(): void {
    const bus = getEventBus()

    // Clean up container when an agent is stopped
    this.unsubscribers.push(
      bus.on('agent:stopped', (payload) => {
        this.handleAgentStopped(payload as unknown as Record<string, unknown>)
      }),
    )
  }

  /**
   * Stop listening and clean up subscriptions.
   */
  stop(): void {
    for (const unsub of this.unsubscribers) {
      unsub()
    }
    this.unsubscribers = []
  }

  /**
   * Handle agent:stopped by cleaning up the agent's container.
   * Extracts agent name from the session ID or event data.
   */
  private handleAgentStopped(eventData: Record<string, unknown>): void {
    try {
      // The sessionId format is: {ticketId}-{action}-{agentName}
      // We need the agent name to find the container
      const sessionId = eventData.sessionId as string | undefined
      if (!sessionId) return

      // Extract agent name from session ID
      // Format: TKT-123-implement-agent-name or similar
      const agentName = extractAgentNameFromSessionId(sessionId)
      if (!agentName) return

      cleanupAgentContainer(agentName)
    } catch {
      // Container cleanup errors are non-fatal
    }
  }
}

/**
 * Extract agent name from a session ID.
 * Session IDs follow the format: {ticketId}-{action}-{agentName}
 * e.g., "TKT-100-implement-bold-turing" → "bold-turing"
 */
function extractAgentNameFromSessionId(sessionId: string): string | null {
  // Match pattern: TKT-NNN-action-agentname or similar
  // Agent names are typically two hyphenated words: adjective-noun
  const match = sessionId.match(/^(?:TKT-\d+|[A-Z]+-\d+)-\w+-(.+)$/)
  return match ? match[1] : null
}

// =============================================================================
// Singleton
// =============================================================================

let _hook: ContainerCleanupHook | undefined

/**
 * Initialize and start the container cleanup hook.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function initContainerCleanupHook(): ContainerCleanupHook {
  if (!_hook) {
    _hook = new ContainerCleanupHook()
    _hook.start()
  }
  return _hook
}

/**
 * Stop the container cleanup hook (primarily for testing).
 */
export function stopContainerCleanupHook(): void {
  if (_hook) {
    _hook.stop()
    _hook = undefined
  }
}

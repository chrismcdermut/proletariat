/**
 * Agent Cleanup Lifecycle Hook
 *
 * Subscribes to agent lifecycle events on the global EventBus and
 * automatically runs the full cascading cleanup when agents stop.
 *
 * This is Tier 1 of the cleanup system: event-driven cleanup that handles
 * the ~90% case when agents stop normally (manual stop, completion, error).
 *
 * The cascade order follows the ticket spec:
 *   1. CC/Claude session → 2. Tmux → 3. Container → 4. Worktree
 *   5. Agent directory → 6. Git branch → 7. Execution records → 8. DB status
 */

import { getEventBus } from '../events/event-bus.js'
import { cleanupAgentContainer } from '../execution/container-cleanup.js'
import { executeCascade, type CascadeTarget } from '../gc/cascade.js'

/**
 * ContainerCleanupHook listens for agent completion events and
 * runs the full cascading cleanup.
 *
 * Cleanup is fire-and-forget: failures are logged but never block
 * the event emission chain.
 */
export class ContainerCleanupHook {
  private unsubscribers: Array<() => void> = []
  private hqPath: string | undefined

  /**
   * Set the HQ path for full cascade cleanup (branch deletion, DB ops).
   * If not set, only container-level cleanup runs.
   */
  setHqPath(hqPath: string): void {
    this.hqPath = hqPath
  }

  /**
   * Start listening for agent lifecycle events.
   */
  start(): void {
    const bus = getEventBus()

    // Clean up agent resources when stopped
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
   * Handle agent:stopped by running cascading cleanup.
   * Extracts agent name from the session ID or event data.
   */
  private handleAgentStopped(eventData: Record<string, unknown>): void {
    try {
      // The sessionId format is: {ticketId}-{action}-{agentName}
      // We need the agent name to find the container
      const sessionId = eventData.sessionId as string | undefined
      if (!sessionId) return

      // Skip if this is from stale-cleanup to avoid recursive loops
      const runner = eventData.runner as string | undefined
      if (runner === 'cascade-cleanup') return

      // Extract agent name from session ID
      // Format: TKT-123-implement-agent-name or similar
      const agentName = extractAgentNameFromSessionId(sessionId)
      if (!agentName) {
        // Fall back to container-only cleanup if we can't extract agent name
        cleanupAgentContainer(agentName ?? sessionId)
        return
      }

      // If we have hqPath, run the full cascade
      if (this.hqPath) {
        const target: CascadeTarget = {
          agentName,
          sessionId,
          hqPath: this.hqPath,
        }

        // Try to resolve container ID from agent name
        target.containerId = findContainerIdForAgent(agentName)

        executeCascade(target, { execute: true })
      } else {
        // Minimal cleanup: just remove the container (backward compatible)
        cleanupAgentContainer(agentName)
      }
    } catch {
      // Cleanup errors are non-fatal
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

/**
 * Find the Docker container ID for an agent by name.
 * Returns null if no container is found.
 */
function findContainerIdForAgent(agentName: string): string | undefined {
  try {
    const { execSync } = require('node:child_process')
    const output = execSync(
      `docker ps -a --filter "name=prlt-agent-${agentName}" --format "{{.ID}}"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 },
    ).trim()
    return output || undefined
  } catch {
    return undefined
  }
}

// =============================================================================
// Singleton
// =============================================================================

let _hook: ContainerCleanupHook | undefined

/**
 * Initialize and start the container cleanup hook.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function initContainerCleanupHook(hqPath?: string): ContainerCleanupHook {
  if (!_hook) {
    _hook = new ContainerCleanupHook()
    if (hqPath) _hook.setHqPath(hqPath)
    _hook.start()
  } else if (hqPath) {
    _hook.setHqPath(hqPath)
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

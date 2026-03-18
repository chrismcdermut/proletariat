/**
 * Container Cleanup
 *
 * Provides triggered cleanup of Docker containers when agent work completes.
 * Tied to agent completion events (PR created, error, explicit stop), NOT a TTL.
 *
 * PRLT-1005: Docker containers sit idle at 0% CPU forever after agents finish.
 * This module provides both event-driven cleanup (via EventBus subscriptions)
 * and a manual cleanup function for the `prlt session cleanup` command.
 */

import { execSync } from 'node:child_process'
import { getEventBus } from '../events/event-bus.js'
import type { RuntimeEventName } from '../events/events.js'
import { sanitizeContainerId } from '../docker/resolve.js'

// =============================================================================
// Types
// =============================================================================

export interface ContainerCleanupResult {
  /** Containers that were stopped */
  stopped: string[]
  /** Containers that were removed */
  removed: string[]
  /** Errors encountered during cleanup */
  errors: string[]
}

export interface DeadContainer {
  id: string
  name: string
  status: string
  agentDir: string
  /** CPU usage percentage (0.00% = idle) */
  cpuPercent?: string
  /** How the container was identified as dead */
  reason: string
}

// =============================================================================
// Container Cleanup Logic
// =============================================================================

/**
 * Stop and remove a single Docker container.
 * Stops first if running, then removes.
 */
export function cleanupContainer(containerId: string): { success: boolean; error?: string } {
  try {
    const safeId = sanitizeContainerId(containerId)

    // Check if container exists
    try {
      execSync(`docker inspect ${safeId}`, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10000,
      })
    } catch {
      // Container doesn't exist, nothing to do
      return { success: true }
    }

    // Check if running and stop if so
    try {
      const running = execSync(
        `docker inspect -f '{{.State.Running}}' ${safeId}`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 },
      ).trim()

      if (running === 'true') {
        execSync(`docker stop ${safeId}`, {
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 30000,
        })
      }
    } catch {
      // If we can't check status, try to stop anyway
      try {
        execSync(`docker stop ${safeId}`, {
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 30000,
        })
      } catch {
        // Ignore stop errors — container may already be stopped
      }
    }

    // Remove the container
    execSync(`docker rm ${safeId}`, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
    })

    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Find dead containers — devcontainers with no active tmux sessions inside.
 * A container is considered dead if:
 * 1. It's a devcontainer (has the devcontainer.local_folder label)
 * 2. It has no tmux sessions running inside it (agent has finished)
 *
 * This is the authoritative check: if tmux is gone, the agent is done.
 */
export function findDeadContainers(): DeadContainer[] {
  const dead: DeadContainer[] = []

  try {
    // Get all devcontainers (running + stopped)
    const output = execSync(
      'docker ps -a --filter "label=devcontainer.local_folder" --format "{{.ID}}|{{.Names}}|{{.Status}}|{{.Label \\"devcontainer.local_folder\\"}}"',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 15000 },
    ).trim()

    if (!output) return dead

    for (const line of output.split('\n')) {
      const [id, name, status, agentDir] = line.split('|')
      if (!id || !name) continue

      // Only check running containers — stopped ones are already dead
      const isRunning = status?.includes('Up')

      if (!isRunning) {
        dead.push({
          id,
          name,
          status: status?.split(' ').slice(0, 2).join(' ') || 'exited',
          agentDir: agentDir || '',
          reason: 'Container is stopped',
        })
        continue
      }

      // Check if the container has any tmux sessions
      let hasTmuxSessions = false
      try {
        const safeId = sanitizeContainerId(id)
        const tmuxOutput = execSync(
          `docker exec ${safeId} tmux list-sessions -F "#{session_name}" 2>/dev/null`,
          { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 },
        ).trim()

        hasTmuxSessions = tmuxOutput.length > 0
      } catch {
        // No tmux sessions or tmux not installed — container is dead
      }

      if (!hasTmuxSessions) {
        dead.push({
          id,
          name,
          status: status?.split(' ').slice(0, 2).join(' ') || 'running',
          agentDir: agentDir || '',
          reason: 'No tmux sessions (agent completed)',
        })
      }
    }
  } catch {
    // Docker not available or command failed
  }

  return dead
}

/**
 * Clean up all dead containers.
 * Finds containers with no active agent sessions and removes them.
 */
export function cleanupDeadContainers(): ContainerCleanupResult {
  const result: ContainerCleanupResult = {
    stopped: [],
    removed: [],
    errors: [],
  }

  const deadContainers = findDeadContainers()

  for (const container of deadContainers) {
    const cleanup = cleanupContainer(container.id)

    if (cleanup.success) {
      if (container.status.includes('Up')) {
        result.stopped.push(container.id)
      }
      result.removed.push(container.id)
    } else {
      result.errors.push(`Failed to cleanup ${container.name} (${container.id}): ${cleanup.error}`)
    }
  }

  return result
}

/**
 * Clean up the container for a specific agent.
 * Called when an agent's work completes (PR created, error, or stop).
 */
export function cleanupAgentContainer(agentName: string): ContainerCleanupResult {
  const result: ContainerCleanupResult = {
    stopped: [],
    removed: [],
    errors: [],
  }

  // Find containers for this agent using the naming convention
  const containerName = `prlt-agent-${agentName.replace(/[^a-zA-Z0-9_-]/g, '-')}`

  try {
    // Find container by name
    const output = execSync(
      `docker ps -a --filter "name=^/${containerName}$" --format "{{.ID}}|{{.Status}}"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 },
    ).trim()

    if (!output) return result

    for (const line of output.split('\n')) {
      const [id, status] = line.split('|')
      if (!id) continue

      const cleanup = cleanupContainer(id)
      if (cleanup.success) {
        if (status?.includes('Up')) {
          result.stopped.push(id)
        }
        result.removed.push(id)
      } else {
        result.errors.push(`Failed to cleanup container ${id}: ${cleanup.error}`)
      }
    }
  } catch {
    // Docker not available
  }

  return result
}

// =============================================================================
// Event-Driven Cleanup
// =============================================================================

/** Unsubscribe functions for event listeners */
let _unsubscribers: Array<() => void> = []

/**
 * Start listening for agent completion events and trigger container cleanup.
 *
 * Subscribes to:
 * - agent:stopped — Agent was explicitly stopped or completed
 * - work:completed — Work item moved to completed state
 * - work:pr_created — PR was created (agent's primary task is done)
 *
 * Cleanup is fire-and-forget: failures are logged but never block the caller.
 */
export function startContainerCleanupListener(): void {
  if (_unsubscribers.length > 0) {
    // Already listening
    return
  }

  const bus = getEventBus()

  // Clean up when an agent is stopped (manual stop, completed, or error)
  _unsubscribers.push(
    bus.on('agent:stopped', (event) => {
      try {
        // Extract agent name from session ID (format: {ticketId}-{action}-{agentName})
        const parts = event.sessionId.split('-')
        if (parts.length >= 3) {
          // Agent name is typically the last segment(s) after ticket-action
          // But we can't reliably parse it from sessionId alone.
          // Instead, check if the container for this session has no more tmux sessions.
          scheduleContainerCheck(event.sessionId)
        }
      } catch {
        // Non-fatal
      }
    }),
  )

  // Clean up when work is completed (status moved to 'completed' category)
  _unsubscribers.push(
    bus.on('work:completed', () => {
      try {
        // Run a general dead container scan — the completed agent's container
        // will have no tmux sessions and will be cleaned up
        scheduleDeadContainerCleanup()
      } catch {
        // Non-fatal
      }
    }),
  )

  // Clean up when a PR is created (agent's primary task is done)
  _unsubscribers.push(
    bus.on('work:pr_created', () => {
      try {
        // After PR creation, the agent session typically ends shortly after.
        // Schedule a delayed cleanup to give the agent time to finish.
        scheduleDeadContainerCleanup(5000)
      } catch {
        // Non-fatal
      }
    }),
  )

  // Clean up when an agent encounters an error
  _unsubscribers.push(
    bus.on('agent:error', () => {
      try {
        // Agent errored out — its container may be left idle.
        // Schedule cleanup to remove dead containers.
        scheduleDeadContainerCleanup()
      } catch {
        // Non-fatal
      }
    }),
  )
}

/**
 * Stop listening for agent completion events.
 */
export function stopContainerCleanupListener(): void {
  for (const unsub of _unsubscribers) {
    unsub()
  }
  _unsubscribers = []
}

// =============================================================================
// Scheduled Cleanup
// =============================================================================

/** Pending cleanup timer */
let _cleanupTimer: ReturnType<typeof setTimeout> | undefined

/**
 * Schedule a dead container cleanup after a delay.
 * Debounces multiple rapid events into a single cleanup pass.
 */
function scheduleDeadContainerCleanup(delayMs = 2000): void {
  if (_cleanupTimer) {
    clearTimeout(_cleanupTimer)
  }

  _cleanupTimer = setTimeout(() => {
    _cleanupTimer = undefined
    try {
      cleanupDeadContainers()
    } catch {
      // Non-fatal: cleanup is best-effort
    }
  }, delayMs)
}

/**
 * Schedule a check for a specific session's container.
 * After a session ends, check if its container still has active sessions.
 */
function scheduleContainerCheck(_sessionId: string): void {
  // Use the general dead container scan — it checks all containers
  // for tmux sessions. This is simpler and catches edge cases.
  scheduleDeadContainerCleanup()
}

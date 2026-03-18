/**
 * Container Cleanup — Triggered GC for Docker containers
 *
 * Provides event-driven and manual cleanup of Docker containers when agents
 * complete their work. Containers are cleaned up on agent completion events
 * (PR created, error, explicit stop), NOT on a TTL.
 *
 * TKT-172 / PRLT-1005
 */

import { execSync } from 'node:child_process'
import { sanitizeContainerId } from './resolve.js'

// =============================================================================
// Types
// =============================================================================

export interface ContainerCleanupResult {
  /** Containers that were successfully stopped and removed */
  removed: string[]
  /** Containers that failed to be cleaned up, with error messages */
  errors: Array<{ containerId: string; error: string }>
  /** Containers that were already stopped/exited (just removed) */
  alreadyStopped: string[]
}

export interface ContainerInfo {
  id: string
  name: string
  status: string
  image: string
  /** Labels from the container */
  labels: Record<string, string>
}

// =============================================================================
// Core Cleanup Functions
// =============================================================================

/**
 * Stop and remove a single Docker container.
 * First attempts graceful stop (SIGTERM), then force-removes.
 *
 * @param containerId - Docker container ID or name
 * @param gracefulTimeoutSecs - Seconds to wait for graceful stop before force-killing (default: 10)
 * @returns true if container was removed, false on failure
 */
export function stopAndRemoveContainer(
  containerId: string,
  gracefulTimeoutSecs = 10,
): boolean {
  try {
    const safeId = sanitizeContainerId(containerId)

    // Check if container is running first
    const running = isContainerRunningById(safeId)

    if (running) {
      // Graceful stop
      execSync(`docker stop --time ${gracefulTimeoutSecs} ${safeId}`, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: (gracefulTimeoutSecs + 5) * 1000,
      })
    }

    // Remove the container (whether it was running or already stopped)
    execSync(`docker rm ${safeId}`, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30_000,
    })

    return true
  } catch {
    // Try force remove as fallback
    try {
      const safeId = sanitizeContainerId(containerId)
      execSync(`docker rm -f ${safeId}`, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 30_000,
      })
      return true
    } catch {
      return false
    }
  }
}

/**
 * Clean up containers for a specific execution.
 * Called when an agent completes work (PR created, error, or stop).
 *
 * @param containerId - The container ID associated with the execution
 * @returns Result with removed containers and any errors
 */
export function cleanupExecutionContainer(containerId: string): ContainerCleanupResult {
  const result: ContainerCleanupResult = {
    removed: [],
    errors: [],
    alreadyStopped: [],
  }

  if (!containerId) {
    return result
  }

  try {
    const safeId = sanitizeContainerId(containerId)
    const running = isContainerRunningById(safeId)

    if (!running) {
      result.alreadyStopped.push(containerId)
    }

    const success = stopAndRemoveContainer(containerId)
    if (success) {
      result.removed.push(containerId)
    } else {
      result.errors.push({
        containerId,
        error: 'Failed to stop and remove container',
      })
    }
  } catch (err) {
    result.errors.push({
      containerId,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  return result
}

/**
 * Find and clean up all dead containers (exited, not running) that belong
 * to the proletariat system (identified by the devcontainer.local_folder label
 * or prlt-agent- name prefix).
 *
 * This is the implementation behind `prlt session cleanup`.
 *
 * @returns Result with all removed containers and errors
 */
export function cleanupDeadContainers(): ContainerCleanupResult {
  const result: ContainerCleanupResult = {
    removed: [],
    errors: [],
    alreadyStopped: [],
  }

  const deadContainers = listDeadContainers()

  for (const container of deadContainers) {
    result.alreadyStopped.push(container.id)

    try {
      execSync(`docker rm ${container.id}`, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 30_000,
      })
      result.removed.push(container.id)
    } catch (err) {
      result.errors.push({
        containerId: container.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return result
}

/**
 * Find and clean up all idle containers (running at 0% CPU with no active
 * tmux sessions) that belong to the proletariat system.
 *
 * More aggressive than cleanupDeadContainers — also stops running containers
 * that have no active work.
 *
 * @returns Result with all removed containers and errors
 */
export function cleanupIdleContainers(): ContainerCleanupResult {
  const result: ContainerCleanupResult = {
    removed: [],
    errors: [],
    alreadyStopped: [],
  }

  // First, clean dead containers
  const deadResult = cleanupDeadContainers()
  result.removed.push(...deadResult.removed)
  result.errors.push(...deadResult.errors)
  result.alreadyStopped.push(...deadResult.alreadyStopped)

  // Then find idle running containers
  const idleContainers = listIdleContainers()

  for (const container of idleContainers) {
    const success = stopAndRemoveContainer(container.id)
    if (success) {
      result.removed.push(container.id)
    } else {
      result.errors.push({
        containerId: container.id,
        error: 'Failed to stop and remove idle container',
      })
    }
  }

  return result
}

// =============================================================================
// Container Discovery
// =============================================================================

/**
 * List all proletariat containers that are exited/dead.
 */
export function listDeadContainers(): ContainerInfo[] {
  try {
    const output = execSync(
      'docker ps -a --filter "status=exited" --filter "label=devcontainer.local_folder" --format "{{.ID}}\\t{{.Names}}\\t{{.Status}}\\t{{.Image}}"',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim()

    if (!output) {
      // Also check for prlt-agent- named containers
      return listDeadContainersByName()
    }

    const containers = parseContainerOutput(output)

    // Also include prlt-agent- named containers
    const namedContainers = listDeadContainersByName()
    const existingIds = new Set(containers.map(c => c.id))
    for (const c of namedContainers) {
      if (!existingIds.has(c.id)) {
        containers.push(c)
      }
    }

    return containers
  } catch {
    return []
  }
}

/**
 * List dead containers by the prlt-agent- name prefix.
 */
function listDeadContainersByName(): ContainerInfo[] {
  try {
    const output = execSync(
      'docker ps -a --filter "status=exited" --filter "name=prlt-agent-" --format "{{.ID}}\\t{{.Names}}\\t{{.Status}}\\t{{.Image}}"',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim()

    if (!output) return []
    return parseContainerOutput(output)
  } catch {
    return []
  }
}

/**
 * List all proletariat containers that are running but idle
 * (have no active tmux sessions inside them).
 */
export function listIdleContainers(): ContainerInfo[] {
  try {
    // Get all running prlt containers
    const output = execSync(
      'docker ps --filter "label=devcontainer.local_folder" --format "{{.ID}}\\t{{.Names}}\\t{{.Status}}\\t{{.Image}}"',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim()

    if (!output) {
      return listIdleContainersByName()
    }

    const containers = parseContainerOutput(output)

    // Also include prlt-agent- named running containers
    const namedContainers = listIdleContainersByName()
    const existingIds = new Set(containers.map(c => c.id))
    for (const c of namedContainers) {
      if (!existingIds.has(c.id)) {
        containers.push(c)
      }
    }

    // Filter to only those with no tmux sessions (truly idle)
    return containers.filter(c => !hasActiveTmuxSessions(c.id))
  } catch {
    return []
  }
}

/**
 * List idle running containers by the prlt-agent- name prefix.
 */
function listIdleContainersByName(): ContainerInfo[] {
  try {
    const output = execSync(
      'docker ps --filter "name=prlt-agent-" --format "{{.ID}}\\t{{.Names}}\\t{{.Status}}\\t{{.Image}}"',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim()

    if (!output) return []
    return parseContainerOutput(output)
  } catch {
    return []
  }
}

/**
 * List all proletariat containers (running + stopped).
 * Used by `prlt session cleanup --dry-run` to show what would be cleaned.
 */
export function listAllProletariatContainers(): ContainerInfo[] {
  try {
    const output = execSync(
      'docker ps -a --filter "label=devcontainer.local_folder" --format "{{.ID}}\\t{{.Names}}\\t{{.Status}}\\t{{.Image}}"',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim()

    const containers = output ? parseContainerOutput(output) : []

    // Also include prlt-agent- named containers
    const namedOutput = execSync(
      'docker ps -a --filter "name=prlt-agent-" --format "{{.ID}}\\t{{.Names}}\\t{{.Status}}\\t{{.Image}}"',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim()

    if (namedOutput) {
      const namedContainers = parseContainerOutput(namedOutput)
      const existingIds = new Set(containers.map(c => c.id))
      for (const c of namedContainers) {
        if (!existingIds.has(c.id)) {
          containers.push(c)
        }
      }
    }

    return containers
  } catch {
    return []
  }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Check if a container is currently running by its ID.
 */
function isContainerRunningById(containerId: string): boolean {
  try {
    const output = execSync(
      `docker inspect -f '{{.State.Running}}' ${containerId}`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim()
    return output === 'true'
  } catch {
    return false
  }
}

/**
 * Check if a container has active tmux sessions inside it.
 */
function hasActiveTmuxSessions(containerId: string): boolean {
  try {
    const output = execSync(
      `docker exec ${containerId} tmux list-sessions 2>/dev/null`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 },
    ).trim()
    return output.length > 0
  } catch {
    return false
  }
}

/**
 * Parse docker ps output into ContainerInfo array.
 */
function parseContainerOutput(output: string): ContainerInfo[] {
  return output
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [id, name, status, image] = line.split('\t')
      return {
        id: id?.trim() || '',
        name: name?.trim() || '',
        status: status?.trim() || '',
        image: image?.trim() || '',
        labels: {},
      }
    })
    .filter(c => c.id)
}

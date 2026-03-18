/**
 * Container Cleanup — Triggered GC for Docker Containers
 *
 * Provides event-driven container cleanup when agents complete work.
 * Containers are cleaned up when:
 * - Agent work completes (PR created, ticket moved to Review)
 * - Agent encounters an error
 * - Agent is explicitly stopped
 *
 * This is triggered GC, NOT TTL-based. Containers are only removed
 * in response to agent completion events.
 *
 * @see TKT-172 / PRLT-1005
 */

import { execSync } from 'node:child_process'
import { sanitizeContainerId } from '../docker/resolve.js'

// =============================================================================
// Types
// =============================================================================

export interface ContainerCleanupResult {
  containerId: string
  containerName: string | null
  stopped: boolean
  removed: boolean
  error?: string
}

export interface CleanupSummary {
  attempted: number
  stopped: number
  removed: number
  failed: number
  results: ContainerCleanupResult[]
}

export type CleanupTrigger = 'agent_completed' | 'agent_error' | 'agent_stopped' | 'manual'

export interface CleanupEvent {
  trigger: CleanupTrigger
  containerId: string
  agentName?: string
  executionId?: string
  timestamp: Date
}

// =============================================================================
// Core Cleanup Functions
// =============================================================================

/**
 * Stop and remove a single Docker container.
 * Safe to call on already-stopped or already-removed containers.
 */
export function cleanupContainer(containerId: string): ContainerCleanupResult {
  const safeId = sanitizeContainerId(containerId)
  const result: ContainerCleanupResult = {
    containerId,
    containerName: null,
    stopped: false,
    removed: false,
  }

  // Get container name for logging
  try {
    result.containerName = execSync(
      `docker inspect --format '{{.Name}}' ${safeId}`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 }
    ).trim().replace(/^\//, '')
  } catch {
    // Container may already be gone
  }

  // Stop container if running
  try {
    const isRunning = execSync(
      `docker inspect --format '{{.State.Running}}' ${safeId}`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 }
    ).trim()

    if (isRunning === 'true') {
      execSync(`docker stop ${safeId}`, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 30000,
      })
      result.stopped = true
    }
  } catch {
    // Container may already be stopped or removed
  }

  // Remove container
  try {
    execSync(`docker rm ${safeId}`, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
    })
    result.removed = true
  } catch (error) {
    // Check if container is already gone (not an error)
    try {
      execSync(`docker inspect ${safeId}`, { stdio: 'pipe', timeout: 5000 })
      // Container still exists — actual failure
      result.error = error instanceof Error ? error.message : String(error)
    } catch {
      // Container doesn't exist — already removed, treat as success
      result.removed = true
    }
  }

  return result
}

/**
 * Find and clean up containers for completed executions.
 * Looks for devcontainers whose executions are in a terminal state
 * (completed, failed, stopped) and have no other active executions.
 *
 * @param completedContainerIds - Container IDs from completed executions
 * @param activeContainerIds - Container IDs that still have active executions (to skip)
 * @returns Summary of cleanup operations
 */
export function cleanupCompletedContainers(
  completedContainerIds: string[],
  activeContainerIds: Set<string> = new Set(),
): CleanupSummary {
  const summary: CleanupSummary = {
    attempted: 0,
    stopped: 0,
    removed: 0,
    failed: 0,
    results: [],
  }

  // Deduplicate and filter out containers that still have active work
  const uniqueIds = [...new Set(completedContainerIds)]
  const toCleanup = uniqueIds.filter(id => {
    // Check exact match and prefix match against active containers
    for (const activeId of activeContainerIds) {
      if (activeId === id || activeId.startsWith(id) || id.startsWith(activeId)) {
        return false
      }
    }
    return true
  })

  for (const containerId of toCleanup) {
    summary.attempted++
    const result = cleanupContainer(containerId)
    summary.results.push(result)

    if (result.stopped) summary.stopped++
    if (result.removed) summary.removed++
    if (result.error) summary.failed++
  }

  return summary
}

/**
 * Find dead containers — containers at 0% CPU with no active execution.
 * Used by the manual `prlt session cleanup` command.
 *
 * Returns container IDs that are running but have no active execution
 * tracked in the provided execution data.
 */
export function findDeadContainers(
  activeExecutionContainerIds: Set<string>,
): string[] {
  const deadContainers: string[] = []

  try {
    // Get all running devcontainers
    const output = execSync(
      'docker ps --filter "label=devcontainer.local_folder" --format "{{.ID}}"',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 }
    ).trim()

    if (!output) return []

    for (const containerId of output.split('\n')) {
      if (!containerId) continue

      // Check if this container has an active execution
      let hasActiveExecution = false
      for (const activeId of activeExecutionContainerIds) {
        if (activeId === containerId ||
            activeId.startsWith(containerId) ||
            containerId.startsWith(activeId)) {
          hasActiveExecution = true
          break
        }
      }

      if (!hasActiveExecution) {
        deadContainers.push(containerId)
      }
    }
  } catch {
    // Docker not available or error listing containers
  }

  return deadContainers
}

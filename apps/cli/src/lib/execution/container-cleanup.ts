/**
 * Container Cleanup Module
 *
 * Provides triggered cleanup of Docker containers associated with completed
 * agent work. Containers are identified by the prlt-agent-* naming convention
 * and cross-referenced with execution records in the database.
 *
 * This is NOT TTL-based — cleanup is triggered explicitly via the
 * `session cleanup` command or automatically via lifecycle hooks
 * when agent work completes.
 */

import { execSync } from 'node:child_process'
import {
  getAgentContainerName,
  containerExists,
  isContainerRunning,
} from './runners/docker-management.js'

/**
 * Information about a Docker container managed by prlt.
 */
export interface ContainerInfo {
  containerId: string
  containerName: string
  agentName: string
  running: boolean
  status: string
}

/**
 * Result of a container cleanup operation.
 */
export interface ContainerCleanupResult {
  stopped: string[]
  removed: string[]
  errors: string[]
  skipped: string[]
}

/**
 * List all prlt-agent-* Docker containers (running and stopped).
 */
export function listAgentContainers(): ContainerInfo[] {
  try {
    const output = execSync(
      'docker ps -a --filter "name=prlt-agent-" --format "{{.ID}}\\t{{.Names}}\\t{{.State}}"',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 },
    ).trim()

    if (!output) return []

    return output.split('\n').filter(Boolean).map(line => {
      const [containerId, containerName, status] = line.split('\t')
      const agentName = containerName.replace(/^prlt-agent-/, '')
      return {
        containerId,
        containerName,
        agentName,
        running: status === 'running',
        status,
      }
    })
  } catch {
    return []
  }
}

/**
 * Find containers whose agents have completed work (no active execution).
 * Cross-references running containers against execution records.
 */
export function findCompletedContainers(
  containers: ContainerInfo[],
  activeAgentNames: Set<string>,
): ContainerInfo[] {
  return containers.filter(c => !activeAgentNames.has(c.agentName))
}

/**
 * Stop and remove a single Docker container.
 */
export function removeContainer(containerId: string): { success: boolean; error?: string } {
  try {
    execSync(`docker rm -f ${containerId}`, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000,
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
 * Clean up completed agent containers.
 *
 * Stops and removes Docker containers for agents that have no active
 * (running/starting) execution records.
 *
 * @param activeAgentNames - Set of agent names with active executions
 * @param options - Cleanup options
 * @returns Cleanup result with details of what was done
 */
export function cleanupCompletedContainers(
  activeAgentNames: Set<string>,
  options?: { dryRun?: boolean },
): ContainerCleanupResult {
  const dryRun = options?.dryRun ?? false

  const result: ContainerCleanupResult = {
    stopped: [],
    removed: [],
    errors: [],
    skipped: [],
  }

  const allContainers = listAgentContainers()
  const completedContainers = findCompletedContainers(allContainers, activeAgentNames)

  for (const container of completedContainers) {
    if (dryRun) {
      result.removed.push(container.containerName)
      continue
    }

    const { success, error } = removeContainer(container.containerId)
    if (success) {
      if (container.running) {
        result.stopped.push(container.containerName)
      }
      result.removed.push(container.containerName)
    } else {
      result.errors.push(`Failed to remove ${container.containerName}: ${error}`)
    }
  }

  // Track containers that were skipped (still active)
  const activeContainers = allContainers.filter(c => activeAgentNames.has(c.agentName))
  for (const container of activeContainers) {
    result.skipped.push(container.containerName)
  }

  return result
}

/**
 * Clean up a specific agent's container by agent name.
 * Used by lifecycle hooks when a specific agent completes.
 */
export function cleanupAgentContainer(agentName: string): { success: boolean; error?: string } {
  const containerName = getAgentContainerName(agentName)
  if (!containerExists(containerName)) {
    return { success: true } // Nothing to clean up
  }

  return removeContainer(containerName)
}

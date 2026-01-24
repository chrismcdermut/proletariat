/**
 * Docker Container Resolution
 *
 * Resolves various identifiers to Docker container IDs.
 * Accepts: execution ID (WORK-XXX), agent name, or container ID.
 */

import { execSync } from 'node:child_process'
import { ExecutionStorage } from '../execution/storage.js'

/**
 * Validate and sanitize a container ID to prevent shell injection.
 * Docker container IDs are 64-character hex strings (or 12-char short form).
 * Container names can contain alphanumeric, underscore, hyphen, and period.
 *
 * @throws Error if the ID contains invalid characters
 */
export function sanitizeContainerId(id: string): string {
  // Docker IDs/names: alphanumeric, underscore, hyphen, period only
  // This prevents shell injection via characters like ; | & $ ` etc.
  if (!/^[a-zA-Z0-9_.-]+$/.test(id)) {
    throw new Error(`Invalid container ID: contains disallowed characters`)
  }

  // Reasonable length check (full SHA is 64, short is 12, names vary)
  if (id.length > 128) {
    throw new Error(`Invalid container ID: too long`)
  }

  return id
}

export interface ResolveResult {
  containerId: string | null
  executionId?: string
  agentName?: string
  displayName: string
  error?: string
}

/**
 * Resolve a target identifier to a Docker container ID.
 *
 * @param target - Execution ID (WORK-XXX), agent name, or container ID
 * @param executionStorage - ExecutionStorage instance
 * @returns ResolveResult with containerId or error
 */
export function resolveContainerId(
  target: string,
  executionStorage: ExecutionStorage
): ResolveResult {
  // Try as execution ID first (WORK-XXX pattern)
  if (target.toUpperCase().startsWith('WORK-')) {
    const execution = executionStorage.getExecution(target.toUpperCase())

    if (!execution) {
      return {
        containerId: null,
        displayName: target,
        error: `Execution ${target} not found`,
      }
    }

    if (!execution.containerId) {
      return {
        containerId: null,
        executionId: execution.id,
        agentName: execution.agentName,
        displayName: `${execution.id} (${execution.agentName})`,
        error: `Execution ${execution.id} has no associated container (environment: ${execution.environment})`,
      }
    }

    return {
      containerId: execution.containerId,
      executionId: execution.id,
      agentName: execution.agentName,
      displayName: `${execution.id} (${execution.agentName})`,
    }
  }

  // Try as agent name - look for running executions
  const agentExecutions = executionStorage.getAgentRunningExecutions(target)

  if (agentExecutions.length > 0) {
    // Filter to those with containers
    const withContainers = agentExecutions.filter((e) => e.containerId)

    if (withContainers.length === 0) {
      return {
        containerId: null,
        agentName: target,
        displayName: target,
        error: `Agent ${target} has ${agentExecutions.length} running execution(s) but none with containers`,
      }
    }

    if (withContainers.length > 1) {
      const ids = withContainers.map((e) => e.id).join(', ')
      return {
        containerId: null,
        agentName: target,
        displayName: target,
        error: `Agent ${target} has multiple running containers. Specify an execution ID: ${ids}`,
      }
    }

    const execution = withContainers[0]
    return {
      containerId: execution.containerId!,
      executionId: execution.id,
      agentName: execution.agentName,
      displayName: `${execution.id} (${execution.agentName})`,
    }
  }

  // Try as container ID (full or partial)
  const containerId = resolveDockerContainerId(target)

  if (containerId) {
    // Try to find matching execution
    const allExecutions = executionStorage.listExecutions({ limit: 100 })
    const matchingExecution = allExecutions.find(
      (e) =>
        e.containerId &&
        (e.containerId === containerId ||
          e.containerId.startsWith(target) ||
          containerId.startsWith(e.containerId))
    )

    return {
      containerId,
      executionId: matchingExecution?.id,
      agentName: matchingExecution?.agentName,
      displayName: matchingExecution
        ? `${matchingExecution.id} (${matchingExecution.agentName})`
        : `container ${target}`,
    }
  }

  return {
    containerId: null,
    displayName: target,
    error: `Could not find container for "${target}". Specify an execution ID (WORK-XXX), agent name, or container ID.`,
  }
}

/**
 * Resolve a partial container ID to full ID using docker.
 */
function resolveDockerContainerId(partialId: string): string | null {
  try {
    // Sanitize before using in shell command
    const safeId = sanitizeContainerId(partialId)

    const output = execSync(`docker ps -aq --filter "id=${safeId}" --no-trunc`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()

    const lines = output.split('\n').filter(Boolean)

    if (lines.length === 1) {
      return lines[0]
    }

    // Also try by name
    const byName = execSync(`docker ps -aq --filter "name=${safeId}" --no-trunc`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()

    const nameLines = byName.split('\n').filter(Boolean)

    if (nameLines.length === 1) {
      return nameLines[0]
    }

    return null
  } catch {
    return null
  }
}

/**
 * Check if a container is currently running.
 */
export function isContainerRunning(containerId: string): boolean {
  try {
    const safeId = sanitizeContainerId(containerId)
    const output = execSync(`docker inspect -f '{{.State.Running}}' ${safeId}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()

    return output === 'true'
  } catch {
    return false
  }
}

/**
 * Check if a container exists (running or stopped).
 */
export function containerExists(containerId: string): boolean {
  try {
    const safeId = sanitizeContainerId(containerId)
    execSync(`docker inspect ${safeId}`, {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return true
  } catch {
    return false
  }
}

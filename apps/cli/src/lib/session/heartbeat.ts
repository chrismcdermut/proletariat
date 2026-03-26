/**
 * Agent Heartbeat
 *
 * Heartbeat recording and checking for agent executions.
 * The heartbeat system has two sides:
 *
 * 1. Agent-side (push): Agents update their heartbeat when alive/active.
 *    This is done by checking tmux pane liveness and JSONL file activity.
 *
 * 2. Host-side (pull): The watcher checks heartbeat timestamps and marks
 *    stale executions as failed. This catches the case where the agent is
 *    so dead it can't self-report (OOM, zombie processes).
 */

import { execSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { ExecutionStorage } from '../execution/storage.js'
import type { AgentWork } from '../execution/types.js'
import {
  captureTmuxPane,
  getHostTmuxSessionNames,
  getContainerTmuxSessionMap,
  findContainerSessionsByPrefix,
  findSessionForExecution,
} from '../execution/session-utils.js'
import { detectState } from '../../commands/session/health.js'

// =============================================================================
// Heartbeat Recording (Agent-side push)
// =============================================================================

/**
 * Record a heartbeat for an execution by checking if its tmux session is alive.
 * Uses tmux pane inspection to determine if the agent is still active.
 *
 * Returns the detected health state, or null if the session couldn't be found.
 */
export function recordHeartbeatFromSession(
  storage: ExecutionStorage,
  execution: AgentWork,
): string | null {
  const isContainer = execution.environment === 'devcontainer'
  let sessionId = execution.sessionId

  // Try to find the tmux session
  if (isContainer && execution.containerId) {
    const containerSessions = getContainerTmuxSessionMap()
    const sessions = findContainerSessionsByPrefix(containerSessions, execution.containerId)
    if (!sessions || sessions.length === 0) return null

    if (sessionId && sessions.includes(sessionId)) {
      // Session found by exact match
    } else {
      // Try fuzzy match
      const match = findSessionForExecution(execution.ticketId, execution.agentName, sessions)
      if (match) {
        sessionId = match
      } else {
        return null
      }
    }
  } else {
    const hostSessions = getHostTmuxSessionNames()
    if (sessionId && hostSessions.includes(sessionId)) {
      // Session found
    } else {
      const match = findSessionForExecution(execution.ticketId, execution.agentName, hostSessions)
      if (match) {
        sessionId = match
      } else {
        return null
      }
    }
  }

  if (!sessionId) return null

  // Capture pane content and detect state
  const paneContent = captureTmuxPane(sessionId, 10, isContainer ? execution.containerId : undefined)
  const state = detectState(paneContent)

  // If the session is alive (any state other than UNKNOWN with no content), record heartbeat
  if (paneContent !== null) {
    storage.updateHeartbeat(execution.id)

    // Update lifecycle state based on detected health
    if (state === 'WORKING') {
      storage.updateLifecycleState(execution.id, 'healthy')
    } else if (state === 'IDLE') {
      storage.updateLifecycleState(execution.id, 'idle')
    } else if (state === 'DONE') {
      storage.updateLifecycleState(execution.id, 'completed')
    }
  }

  return state
}

/**
 * Record heartbeats for all running executions.
 * Returns a map of execution ID to detected state.
 */
export function recordAllHeartbeats(
  storage: ExecutionStorage,
): Map<string, string> {
  const results = new Map<string, string>()

  const runningExecutions = storage.listExecutions({ status: 'running' })
  const startingExecutions = storage.listExecutions({ status: 'starting' })
  const activeExecutions = [...runningExecutions, ...startingExecutions]

  for (const exec of activeExecutions) {
    const state = recordHeartbeatFromSession(storage, exec)
    if (state) {
      results.set(exec.id, state)
    }
  }

  return results
}

// =============================================================================
// Stale Detection (Host-side pull)
// =============================================================================

/**
 * Information about a stale execution detected by heartbeat timeout.
 */
export interface StaleExecution {
  execution: AgentWork
  lastHeartbeat: Date | null
  staleDurationMinutes: number
  reason: string
}

/**
 * Check for stale executions that have exceeded the heartbeat timeout.
 */
export function detectStaleExecutions(
  storage: ExecutionStorage,
  timeoutMinutes: number,
): StaleExecution[] {
  const staleExecutions = storage.getStaleExecutions(timeoutMinutes)

  return staleExecutions.map(exec => {
    const lastHeartbeat = exec.lastHeartbeat || null
    const referenceTime = lastHeartbeat || exec.startedAt
    const staleDurationMs = Date.now() - referenceTime.getTime()
    const staleDurationMinutes = Math.floor(staleDurationMs / 60000)

    const reason = lastHeartbeat
      ? `No heartbeat for ${staleDurationMinutes} minutes (last: ${lastHeartbeat.toISOString()})`
      : `No heartbeat since start ${staleDurationMinutes} minutes ago`

    return {
      execution: exec,
      lastHeartbeat,
      staleDurationMinutes,
      reason,
    }
  })
}

// =============================================================================
// Container Kill
// =============================================================================

/**
 * Kill a Docker container by ID.
 * Returns true if the container was killed or already stopped.
 */
export function killContainer(containerId: string): boolean {
  try {
    execSync(`docker kill ${containerId}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000,
    })
    return true
  } catch {
    // Container may already be stopped
    try {
      const status = execSync(
        `docker inspect --format '{{.State.Status}}' ${containerId}`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 },
      ).trim()
      return status === 'exited' || status === 'dead'
    } catch {
      return false
    }
  }
}

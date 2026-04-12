/**
 * Reconciler Supervisor (PRLT-1287)
 *
 * Ensures the reconciler daemon is running. Used by the orchestrator to:
 * 1. Auto-spawn the reconciler on startup if not already running
 * 2. Detect and restart the reconciler if it dies
 *
 * The reconciler is a tmux session named "reconciler" that runs
 * `prlt reconcile --watch --foreground` inside it.
 */

import { execSync } from 'node:child_process'
import type { ExecutionStorage } from '../execution/storage.js'
import {
  RECONCILER_SESSION_NAME,
  DAEMON_TICKET_ID,
  getReconcilerTmuxSessions,
} from '../../commands/reconcile.js'

/**
 * Ensure the reconciler daemon is running.
 * If not, spawn it as a tmux session and register in the DB.
 *
 * Called by the orchestrator on startup.
 */
export function ensureReconcilerRunning(
  executionStorage: ExecutionStorage,
  log?: (msg: string) => void,
): void {
  // Check if tmux session exists
  const tmuxSessions = getReconcilerTmuxSessions()
  if (tmuxSessions.length > 0) {
    log?.('[orchestrate] Reconciler daemon already running')
    return
  }

  // Check if there's a stale DB record for a dead reconciler
  cleanupStaleReconcilerRecord(executionStorage)

  // Spawn the reconciler
  spawnReconciler(executionStorage, log)
}

/**
 * Check if the reconciler is alive and restart it if it died.
 * Called periodically by the orchestrator's health check timer.
 */
export function checkAndRestartReconciler(
  executionStorage: ExecutionStorage,
  log?: (msg: string) => void,
): void {
  const tmuxSessions = getReconcilerTmuxSessions()
  if (tmuxSessions.length > 0) {
    // Reconciler is alive, nothing to do
    return
  }

  // Reconciler tmux session is gone — it died
  log?.('[orchestrate] Reconciler daemon is not running, restarting...')

  // Clean up stale DB record
  cleanupStaleReconcilerRecord(executionStorage)

  // Respawn
  spawnReconciler(executionStorage, log)
}

/**
 * Spawn the reconciler as a detached tmux session and register in the DB.
 */
function spawnReconciler(
  executionStorage: ExecutionStorage,
  log?: (msg: string) => void,
): void {
  try {
    execSync('which tmux', { stdio: 'pipe' })
  } catch {
    log?.('[orchestrate] tmux not available, cannot spawn reconciler')
    return
  }

  const prltCmd = 'prlt reconcile --watch --foreground'
  const tmuxCmd = `tmux new-session -d -s "${RECONCILER_SESSION_NAME}" -n "${RECONCILER_SESSION_NAME}" bash -c '${prltCmd}; echo "Reconciler exited. Press Enter to close."; exec bash'`

  try {
    execSync(tmuxCmd, { stdio: 'pipe' })
  } catch (error) {
    log?.(`[orchestrate] Failed to spawn reconciler: ${error instanceof Error ? error.message : error}`)
    return
  }

  // Register in DB
  try {
    const execution = executionStorage.createExecution({
      ticketId: DAEMON_TICKET_ID,
      agentName: RECONCILER_SESSION_NAME,
      executor: 'custom',
      environment: 'host',
      displayMode: 'background',
      permissionMode: 'safe',
      cleanupPolicy: 'persistent',
      role: 'daemon',
      sessionId: RECONCILER_SESSION_NAME,
    })
    executionStorage.updateStatus(execution.id, 'running')
    log?.('[orchestrate] Reconciler daemon spawned and registered')
  } catch (error) {
    // tmux session was created even if DB registration fails
    log?.(`[orchestrate] Reconciler spawned but DB registration failed: ${error instanceof Error ? error.message : error}`)
  }
}

/**
 * Clean up any stale reconciler execution records (status=running but tmux session is gone).
 */
function cleanupStaleReconcilerRecord(executionStorage: ExecutionStorage): void {
  const running = executionStorage.listExecutions({ status: 'running' })
  for (const exec of running) {
    if (exec.role === 'daemon' && exec.agentName === RECONCILER_SESSION_NAME) {
      executionStorage.updateStatus(exec.id, 'stopped')
    }
  }
  const starting = executionStorage.listExecutions({ status: 'starting' })
  for (const exec of starting) {
    if (exec.role === 'daemon' && exec.agentName === RECONCILER_SESSION_NAME) {
      executionStorage.updateStatus(exec.id, 'stopped')
    }
  }
}

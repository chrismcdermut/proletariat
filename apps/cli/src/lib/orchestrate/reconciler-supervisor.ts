/**
 * Reconciler Daemon Supervisor
 *
 * Provides a function to ensure the reconciler daemon is running.
 * Used by the orchestrator to auto-spawn and supervise the reconciler.
 */

import { execSync } from 'node:child_process'
import { SessionStore } from '../session-store.js'

/** Well-known tmux session name for the reconciler daemon. */
const RECONCILER_SESSION_NAME = 'prlt-reconciler'

/** Default reconciler polling interval in seconds. */
const DEFAULT_INTERVAL = 30

export interface ReconcilerResult {
  spawned: boolean
  alreadyRunning: boolean
  error?: string
}

/**
 * Check if the reconciler tmux session is alive.
 */
function isReconcilerTmuxAlive(): boolean {
  try {
    execSync(`tmux has-session -t "${RECONCILER_SESSION_NAME}" 2>/dev/null`, { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

/**
 * Ensure the reconciler daemon is running.
 * If not running, spawns it as a tmux session and registers in the session store.
 *
 * Safe to call repeatedly — no-ops if already running.
 */
export function ensureReconcilerDaemon(interval: number = DEFAULT_INTERVAL): ReconcilerResult {
  // Check if tmux session is alive
  if (isReconcilerTmuxAlive()) {
    return { spawned: false, alreadyRunning: true }
  }

  // Session is dead — clean up stale DB record if any
  const store = new SessionStore()
  try {
    if (store.isDaemonRunning(RECONCILER_SESSION_NAME)) {
      // DB says running but tmux is dead — reconcile
      store.reconcile()
    }

    // Spawn the reconciler
    const cmd = `prlt reconcile --watch --foreground --interval ${interval}`
    try {
      execSync(
        `tmux new-session -d -s "${RECONCILER_SESSION_NAME}" -n "${RECONCILER_SESSION_NAME}" "${cmd}"`,
        { stdio: 'pipe' },
      )
    } catch (error) {
      return { spawned: false, alreadyRunning: false, error: `tmux spawn failed: ${error}` }
    }

    // Register in session store as daemon
    store.create({
      agentName: 'reconciler',
      runner: 'daemon',
      task: 'Reconcile session and execution state',
      workdir: process.cwd(),
      sessionName: RECONCILER_SESSION_NAME,
      environment: 'host',
      permissionMode: 'safe',
      role: 'daemon',
    })

    return { spawned: true, alreadyRunning: false }
  } catch (error) {
    return { spawned: false, alreadyRunning: false, error: `${error}` }
  } finally {
    store.close()
  }
}

/**
 * Daemon Manager (PRLT-1287)
 *
 * Manages long-running infrastructure daemons (reconciler, future rebase
 * coordinator, worktree GC, etc.) as supervised tmux sessions.
 *
 * Daemons:
 *   - Run in tmux sessions with the `prlt-daemon-{hqName}-{type}` naming pattern
 *   - Are registered in machine.db with ticketId='DAEMON' and agentName='daemon-{type}'
 *   - Are NOT pruned by `prlt session prune` (they're supposed to run forever)
 *   - Are supervised by `prlt orchestrate` — if they die, the orchestrator restarts them
 */

import { execSync } from 'node:child_process'
import { getHeadquartersNameFromPath } from '../machine-config.js'
import { getHostTmuxSessionNames } from '../execution/session-utils.js'
import { MachineDB } from '../machine-db.js'
import { buildDaemonSessionName } from './renderer.js'

export interface DaemonSpec {
  /** Daemon type name (e.g., 'reconciler'). Used in session naming and agent naming. */
  type: string
  /** The shell command to run inside the tmux session. */
  command: string
}

export interface DaemonStatus {
  type: string
  sessionName: string
  alive: boolean
  executionId?: string
}

/**
 * Check if a daemon is alive (has a running tmux session).
 */
export function isDaemonAlive(hqPath: string, daemonType: string): boolean {
  const hqName = getHeadquartersNameFromPath(hqPath)
  const sessionName = buildDaemonSessionName(hqName, daemonType)
  const sessions = getHostTmuxSessionNames()
  return sessions.includes(sessionName)
}

/**
 * Get the status of a daemon.
 */
export function getDaemonStatus(hqPath: string, daemonType: string): DaemonStatus {
  const hqName = getHeadquartersNameFromPath(hqPath)
  const sessionName = buildDaemonSessionName(hqName, daemonType)
  const sessions = getHostTmuxSessionNames()
  const alive = sessions.includes(sessionName)

  // Look up the execution record in machine.db
  let executionId: string | undefined
  try {
    const machineDb = new MachineDB()
    try {
      const exec = machineDb.findBySessionId(sessionName)
      if (exec) executionId = exec.id
    } finally {
      machineDb.close()
    }
  } catch {
    // Non-fatal
  }

  return { type: daemonType, sessionName, alive, executionId }
}

/**
 * Spawn a daemon in a detached tmux session and register it in machine.db.
 *
 * Returns the session name on success, or null on failure.
 */
export function spawnDaemon(hqPath: string, spec: DaemonSpec): string | null {
  const hqName = getHeadquartersNameFromPath(hqPath)
  const sessionName = buildDaemonSessionName(hqName, spec.type)

  // Don't double-spawn
  if (isDaemonAlive(hqPath, spec.type)) {
    return sessionName
  }

  // Clean up any stale machine.db records for this daemon
  cleanupStaleDaemonRecord(sessionName)

  // Spawn detached tmux session
  try {
    execSync(
      `tmux new-session -d -s "${sessionName}" -c "${hqPath}" "${spec.command}"`,
      { stdio: 'pipe', timeout: 10000 },
    )
  } catch {
    return null
  }

  // Register in machine.db
  try {
    const machineDb = new MachineDB()
    try {
      const execution = machineDb.createExecution({
        prompt: spec.command,
        repoPath: hqPath,
        agentName: `daemon-${spec.type}`,
        executor: 'prlt',
        environment: 'host',
        ticketId: 'DAEMON',
        persistent: true,
        cleanupPolicy: 'persistent',
      })
      machineDb.updateProcessInfo(execution.id, { sessionId: sessionName })
      machineDb.updateStatus(execution.id, 'running')
    } finally {
      machineDb.close()
    }
  } catch {
    // Non-fatal: daemon is running even if registration fails
  }

  return sessionName
}

/**
 * Clean up stale machine.db records for a daemon session that is no longer alive.
 */
function cleanupStaleDaemonRecord(sessionName: string): void {
  try {
    const machineDb = new MachineDB()
    try {
      const exec = machineDb.findBySessionId(sessionName)
      if (exec && (exec.status === 'running' || exec.status === 'starting')) {
        machineDb.updateStatus(exec.id, 'failed', undefined, 'daemon session died')
      }
    } finally {
      machineDb.close()
    }
  } catch {
    // Non-fatal
  }
}

/**
 * Ensure a daemon is running. If it's dead, restart it.
 * Returns the session name if the daemon is running (or was restarted), null otherwise.
 */
export function ensureDaemonRunning(hqPath: string, spec: DaemonSpec): string | null {
  if (isDaemonAlive(hqPath, spec.type)) {
    const hqName = getHeadquartersNameFromPath(hqPath)
    return buildDaemonSessionName(hqName, spec.type)
  }
  return spawnDaemon(hqPath, spec)
}

/**
 * The reconciler daemon spec builder. Constructs the DaemonSpec for the
 * reconciler with the given interval.
 */
export function reconcilerDaemonSpec(intervalSeconds: number = 300): DaemonSpec {
  return {
    type: 'reconciler',
    command: `prlt reconcile --watch --foreground --interval ${intervalSeconds}`,
  }
}

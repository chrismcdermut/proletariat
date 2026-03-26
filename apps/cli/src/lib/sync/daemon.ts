/**
 * Sync Daemon
 *
 * Manages a background process that periodically runs the sync engine.
 * Uses a PID file in the HQ directory to track the daemon process.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

const DAEMON_PID_FILE = 'sync-daemon.pid'
const DAEMON_LOG_FILE = 'sync-daemon.log'

export interface DaemonInfo {
  pid: number
  startedAt: string
  intervalSeconds: number
}

/**
 * Get the path to the daemon PID file.
 */
export function getDaemonPidPath(hqPath: string): string {
  return path.join(hqPath, '.proletariat', DAEMON_PID_FILE)
}

/**
 * Get the path to the daemon log file.
 */
export function getDaemonLogPath(hqPath: string): string {
  return path.join(hqPath, '.proletariat', DAEMON_LOG_FILE)
}

/**
 * Read daemon info from PID file.
 */
export function getDaemonInfo(hqPath: string): DaemonInfo | null {
  const pidPath = getDaemonPidPath(hqPath)
  try {
    const content = fs.readFileSync(pidPath, 'utf-8')
    return JSON.parse(content) as DaemonInfo
  } catch {
    return null
  }
}

/**
 * Write daemon info to PID file.
 */
export function writeDaemonInfo(hqPath: string, info: DaemonInfo): void {
  const pidPath = getDaemonPidPath(hqPath)
  fs.writeFileSync(pidPath, JSON.stringify(info, null, 2))
}

/**
 * Remove daemon PID file.
 */
export function removeDaemonPid(hqPath: string): void {
  const pidPath = getDaemonPidPath(hqPath)
  try {
    fs.unlinkSync(pidPath)
  } catch {
    // File may not exist
  }
}

/**
 * Check if a daemon process is alive by PID.
 */
export function isDaemonRunning(hqPath: string): boolean {
  const info = getDaemonInfo(hqPath)
  if (!info) return false

  try {
    // Sending signal 0 checks if process exists without killing it
    process.kill(info.pid, 0)
    return true
  } catch {
    // Process doesn't exist — clean up stale PID file
    removeDaemonPid(hqPath)
    return false
  }
}

/**
 * Stop the daemon process.
 */
export function stopDaemon(hqPath: string): boolean {
  const info = getDaemonInfo(hqPath)
  if (!info) return false

  try {
    process.kill(info.pid, 'SIGTERM')
    removeDaemonPid(hqPath)
    return true
  } catch {
    // Process may already be dead
    removeDaemonPid(hqPath)
    return false
  }
}

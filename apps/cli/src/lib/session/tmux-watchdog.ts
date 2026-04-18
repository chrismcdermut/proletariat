/**
 * Tmux Watchdog
 *
 * Detects tmux server crashes and attempts automatic recovery of agent sessions.
 *
 * Problem: When the tmux server crashes (macOS sleep, resource pressure, OOM),
 * ALL agent sessions are silently lost. The existing heartbeat system treats
 * each agent as individually stale, missing the root cause. There is no
 * recovery or user notification.
 *
 * Solution: This watchdog monitors the tmux server process itself. When a
 * crash is detected (server transitions from alive→dead while agents were
 * active), it:
 *
 * 1. Marks all affected executions with a crash-specific error
 * 2. Attempts to re-create tmux sessions and restart agents
 * 3. Logs crash events for user notification
 *
 * Architecture:
 * - Runs as Phase 0 in SessionWatcher.runCycle(), before heartbeat checks
 * - Maintains last-known server state per environment (host + each container)
 * - Uses session-utils.ts for server status checks
 * - Uses session restart logic to re-launch agents in recovered sessions
 */

import { execSync, execFileSync } from 'node:child_process'
import { ExecutionStorage } from '../execution/storage.js'
import type { AgentWork } from '../execution/types.js'
import {
  getHostTmuxServerStatus,
  getContainerTmuxServerStatus,
} from '../execution/session-utils.js'

// =============================================================================
// Types
// =============================================================================

/**
 * Record of a tmux server crash event.
 */
export interface TmuxCrashEvent {
  /** When the crash was detected */
  timestamp: Date
  /** Where the crash occurred */
  environment: 'host' | 'container'
  /** Container ID (only for container crashes) */
  containerId?: string
  /** Executions that were active when the crash occurred */
  affectedExecutions: AgentWork[]
  /** Whether recovery was attempted */
  recoveryAttempted: boolean
  /** Sessions that were successfully recovered */
  recoveredSessions: string[]
  /** Sessions that failed to recover */
  failedRecoveries: string[]
}

/**
 * Result of a watchdog check cycle.
 */
export interface WatchdogCycleResult {
  /** Whether the host tmux server is alive */
  hostServerAlive: boolean
  /** Map of container ID → server alive status */
  containerServersAlive: Map<string, boolean>
  /** Crash events detected in this cycle */
  crashEvents: TmuxCrashEvent[]
  /** Total executions affected by crashes */
  totalAffected: number
  /** Total sessions recovered */
  totalRecovered: number
}

export interface TmuxWatchdogOptions {
  /** Execution storage for DB operations */
  storage: ExecutionStorage
  /** Whether to attempt auto-recovery (default: true) */
  autoRecover?: boolean
  /** Logger function */
  log?: (msg: string) => void
  /** Callback when a crash is detected */
  onCrashDetected?: (event: TmuxCrashEvent) => void | Promise<void>
}

// =============================================================================
// Tmux Watchdog
// =============================================================================

export class TmuxWatchdog {
  private storage: ExecutionStorage
  private autoRecover: boolean
  private log: (msg: string) => void
  private onCrashDetected?: (event: TmuxCrashEvent) => void | Promise<void>

  /**
   * Tracks last known tmux server state.
   * Key: 'host' for host server, containerId for container servers.
   * Value: true = server was alive, false = server was down.
   */
  private lastServerState = new Map<string, boolean>()

  /**
   * Tracks which executions were active when we last saw the server alive.
   * Key: 'host' or containerId.
   * Value: array of execution IDs that were active in that environment.
   */
  private activeExecutionsSnapshot = new Map<string, string[]>()

  /**
   * Tracks crash events we've already handled to avoid duplicate recovery.
   * Key: 'host' or containerId.
   * Value: timestamp of when we detected the crash.
   */
  private handledCrashes = new Map<string, number>()

  constructor(options: TmuxWatchdogOptions) {
    this.storage = options.storage
    this.autoRecover = options.autoRecover ?? true
    this.log = options.log ?? (() => {})
    this.onCrashDetected = options.onCrashDetected
  }

  /**
   * Run a single watchdog check cycle.
   *
   * Checks tmux server health for host and all containers with active executions.
   * Detects crashes (server alive→dead transition) and attempts recovery.
   */
  async checkAndRecover(): Promise<WatchdogCycleResult> {
    const result: WatchdogCycleResult = {
      hostServerAlive: true,
      containerServersAlive: new Map(),
      crashEvents: [],
      totalAffected: 0,
      totalRecovered: 0,
    }

    // Get all active executions
    const runningExecs = this.storage.listExecutions({ status: 'running' })
    const startingExecs = this.storage.listExecutions({ status: 'starting' })
    const activeExecs = [...runningExecs, ...startingExecs]

    // Group by environment
    const hostExecs = activeExecs.filter(
      e => e.environment === 'host' || e.environment === 'sandbox',
    )
    const containerExecs = activeExecs.filter(
      e => (e.environment === 'devcontainer' || e.environment === 'docker') && e.containerId,
    )

    // Group container executions by container ID
    const containerGroups = new Map<string, AgentWork[]>()
    for (const exec of containerExecs) {
      const cId = exec.containerId!
      const group = containerGroups.get(cId) || []
      group.push(exec)
      containerGroups.set(cId, group)
    }

    // === Check host tmux server ===
    if (hostExecs.length > 0 || this.lastServerState.has('host')) {
      const hostStatus = getHostTmuxServerStatus()
      const hostAlive = hostStatus === 'running'
      result.hostServerAlive = hostAlive
      const wasAlive = this.lastServerState.get('host')

      // Update snapshot of active host executions when server is alive
      if (hostAlive) {
        this.activeExecutionsSnapshot.set('host', hostExecs.map(e => e.id))
        // Clear any previous crash handling for host
        this.handledCrashes.delete('host')
      }

      // Detect crash: server was alive, now it's dead, and there were active sessions
      if (wasAlive === true && !hostAlive && !this.handledCrashes.has('host')) {
        const snapshotIds = this.activeExecutionsSnapshot.get('host') || []
        // Get the actual execution objects for affected sessions
        const affected = snapshotIds
          .map(id => this.storage.getExecution(id))
          .filter((e): e is AgentWork => e !== null && (e.status === 'running' || e.status === 'starting'))

        if (affected.length > 0) {
          const event = await this.handleCrash('host', undefined, affected)
          result.crashEvents.push(event)
          result.totalAffected += event.affectedExecutions.length
          result.totalRecovered += event.recoveredSessions.length
          this.handledCrashes.set('host', Date.now())
        }
      }

      this.lastServerState.set('host', hostAlive)
    }

    // === Check container tmux servers ===
    for (const [containerId, execs] of containerGroups) {
      const containerStatus = getContainerTmuxServerStatus(containerId)
      const containerAlive = containerStatus === 'running'
      result.containerServersAlive.set(containerId, containerAlive)
      const wasAlive = this.lastServerState.get(containerId)

      if (containerAlive) {
        this.activeExecutionsSnapshot.set(containerId, execs.map(e => e.id))
        this.handledCrashes.delete(containerId)
      }

      if (wasAlive === true && !containerAlive && !this.handledCrashes.has(containerId)) {
        const snapshotIds = this.activeExecutionsSnapshot.get(containerId) || []
        const affected = snapshotIds
          .map(id => this.storage.getExecution(id))
          .filter((e): e is AgentWork => e !== null && (e.status === 'running' || e.status === 'starting'))

        if (affected.length > 0) {
          const event = await this.handleCrash('container', containerId, affected)
          result.crashEvents.push(event)
          result.totalAffected += event.affectedExecutions.length
          result.totalRecovered += event.recoveredSessions.length
          this.handledCrashes.set(containerId, Date.now())
        }
      }

      this.lastServerState.set(containerId, containerAlive)
    }

    // Clean up tracking for containers that no longer have active executions
    for (const key of this.lastServerState.keys()) {
      if (key !== 'host' && !containerGroups.has(key)) {
        this.lastServerState.delete(key)
        this.activeExecutionsSnapshot.delete(key)
        this.handledCrashes.delete(key)
      }
    }

    return result
  }

  /**
   * Handle a detected tmux server crash.
   * Marks affected executions and attempts recovery.
   */
  private async handleCrash(
    environment: 'host' | 'container',
    containerId: string | undefined,
    affected: AgentWork[],
  ): Promise<TmuxCrashEvent> {
    const envLabel = environment === 'host' ? 'host' : `container ${containerId?.slice(0, 12)}`
    this.log(
      `[watchdog] TMUX SERVER CRASH detected on ${envLabel} — ${affected.length} agent(s) affected`,
    )

    const event: TmuxCrashEvent = {
      timestamp: new Date(),
      environment,
      containerId,
      affectedExecutions: affected,
      recoveryAttempted: false,
      recoveredSessions: [],
      failedRecoveries: [],
    }

    // Mark affected executions with crash-specific error
    for (const exec of affected) {
      this.log(
        `[watchdog]   Affected: ${exec.agentName} (${exec.ticketId}) — session: ${exec.sessionId || 'unknown'}`,
      )
      this.storage.updateStatus(
        exec.id,
        'failed',
        undefined,
        `tmux server crash on ${envLabel} — all sessions lost. ` +
        `${this.autoRecover ? 'Auto-recovery attempted.' : 'Manual restart required.'}`,
      )
      this.storage.updateLifecycleState(exec.id, 'died')
    }

    // Attempt auto-recovery if enabled
    if (this.autoRecover) {
      event.recoveryAttempted = true
      await this.attemptRecovery(event)
    }

    // Fire callback
    if (this.onCrashDetected) {
      await this.onCrashDetected(event)
    }

    // Log recovery summary
    if (event.recoveryAttempted) {
      if (event.recoveredSessions.length > 0) {
        this.log(
          `[watchdog] Recovery: ${event.recoveredSessions.length}/${affected.length} sessions restored`,
        )
      }
      if (event.failedRecoveries.length > 0) {
        this.log(
          `[watchdog] Recovery failed for: ${event.failedRecoveries.join(', ')}`,
        )
      }
    }

    return event
  }

  /**
   * Attempt to recover agent sessions after a tmux server crash.
   *
   * Recovery steps:
   * 1. Wait briefly for tmux server to come back (macOS wake, Docker resume)
   * 2. Create new tmux sessions with the original session names
   * 3. Navigate to the working directory
   * 4. Re-launch Claude Code with --resume flag
   */
  private async attemptRecovery(event: TmuxCrashEvent): Promise<void> {
    const { environment, containerId, affectedExecutions } = event

    // Wait briefly for tmux server to recover (macOS wake scenario)
    const serverBack = await this.waitForServerRecovery(environment, containerId, 5000)

    if (!serverBack) {
      // For host: try starting a new tmux server (it auto-starts on new-session)
      // For container: tmux server restarts on next tmux command
      this.log('[watchdog] Tmux server did not auto-recover, will try to start new sessions')
    }

    for (const exec of affectedExecutions) {
      const sessionName = exec.sessionId
      if (!sessionName) {
        event.failedRecoveries.push(exec.agentName)
        this.log(`[watchdog]   Skip ${exec.agentName}: no session ID recorded`)
        continue
      }

      try {
        const recovered = this.restartSession(exec, environment, containerId)
        if (recovered) {
          event.recoveredSessions.push(exec.agentName)

          // Update execution back to running
          this.storage.updateStatus(exec.id, 'running')
          this.storage.updateLifecycleState(exec.id, 'healthy')
          this.storage.updateHeartbeat(exec.id)

          this.log(`[watchdog]   Recovered: ${exec.agentName} (${exec.ticketId})`)
        } else {
          event.failedRecoveries.push(exec.agentName)
          this.log(`[watchdog]   Failed to recover: ${exec.agentName} (${exec.ticketId})`)
        }
      } catch (error) {
        event.failedRecoveries.push(exec.agentName)
        this.log(
          `[watchdog]   Error recovering ${exec.agentName}: ${error instanceof Error ? error.message : error}`,
        )
      }
    }
  }

  /**
   * Wait for the tmux server to come back online.
   * Returns true if the server recovered within the timeout.
   */
  private async waitForServerRecovery(
    environment: 'host' | 'container',
    containerId: string | undefined,
    timeoutMs: number,
  ): Promise<boolean> {
    const start = Date.now()
    const checkInterval = 1000

    while (Date.now() - start < timeoutMs) {
      const status =
        environment === 'host'
          ? getHostTmuxServerStatus()
          : getContainerTmuxServerStatus(containerId!)

      if (status === 'running') {
        this.log('[watchdog] Tmux server recovered')
        return true
      }

      await new Promise(resolve => setTimeout(resolve, checkInterval))
    }

    return false
  }

  /**
   * Restart an agent session by creating a new tmux session and re-launching Claude Code.
   */
  private restartSession(
    exec: AgentWork,
    environment: 'host' | 'container',
    containerId: string | undefined,
  ): boolean {
    const sessionName = exec.sessionId!

    // Build the claude command for re-launch
    let claudeCmd = 'claude --resume'
    if (exec.permissionMode === 'danger') {
      claudeCmd += ' --dangerously-skip-permissions'
    }

    if (environment === 'container' && containerId) {
      return this.restartContainerSession(containerId, sessionName, claudeCmd)
    }

    return this.restartHostSession(sessionName, claudeCmd)
  }

  /**
   * Restart a host tmux session.
   */
  private restartHostSession(sessionName: string, command: string): boolean {
    try {
      // Create new tmux session — this also starts the server if it's not running
      execFileSync('tmux', [
        'new-session', '-d',
        '-s', sessionName,
        '-n', sessionName,
        command,
      ], {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10000,
      })

      // Enable mouse support
      try {
        execFileSync('tmux', ['set-option', '-g', 'mouse', 'on'], {
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 5000,
        })
      } catch {
        // Non-critical
      }

      return true
    } catch {
      return false
    }
  }

  /**
   * Restart a tmux session inside a Docker container.
   */
  private restartContainerSession(
    containerId: string,
    sessionName: string,
    command: string,
  ): boolean {
    try {
      // Create new tmux session inside container
      execFileSync('docker', [
        'exec', containerId,
        'tmux', 'new-session', '-d',
        '-s', sessionName,
        '-n', sessionName,
        command,
      ], {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 15000,
      })
      return true
    } catch {
      return false
    }
  }

  /**
   * Get the current known state of servers.
   * Useful for diagnostics and testing.
   */
  getServerStates(): Map<string, boolean> {
    return new Map(this.lastServerState)
  }

  /**
   * Reset internal state. Useful for testing.
   */
  reset(): void {
    this.lastServerState.clear()
    this.activeExecutionsSnapshot.clear()
    this.handledCrashes.clear()
  }

  /**
   * Seed the initial server state without triggering crash detection.
   * Call this once during watcher startup to establish baseline.
   */
  seedServerState(activeExecs: AgentWork[]): void {
    // Group by environment
    const hostExecs = activeExecs.filter(
      e => e.environment === 'host' || e.environment === 'sandbox',
    )
    const containerExecs = activeExecs.filter(
      e => (e.environment === 'devcontainer' || e.environment === 'docker') && e.containerId,
    )

    if (hostExecs.length > 0) {
      const hostStatus = getHostTmuxServerStatus()
      this.lastServerState.set('host', hostStatus === 'running')
      this.activeExecutionsSnapshot.set('host', hostExecs.map(e => e.id))
    }

    const containerGroups = new Map<string, AgentWork[]>()
    for (const exec of containerExecs) {
      const cId = exec.containerId!
      const group = containerGroups.get(cId) || []
      group.push(exec)
      containerGroups.set(cId, group)
    }

    for (const [cId, execs] of containerGroups) {
      const status = getContainerTmuxServerStatus(cId)
      this.lastServerState.set(cId, status === 'running')
      this.activeExecutionsSnapshot.set(cId, execs.map(e => e.id))
    }
  }
}

// =============================================================================
// Notification Helpers
// =============================================================================

/**
 * Format a crash event into a human-readable notification string.
 */
export function formatCrashNotification(event: TmuxCrashEvent): string {
  const envLabel =
    event.environment === 'host'
      ? 'host tmux server'
      : `container ${event.containerId?.slice(0, 12)} tmux server`

  const lines: string[] = [
    `⚠️  TMUX SERVER CRASH — ${envLabel}`,
    `   Time: ${event.timestamp.toLocaleString()}`,
    `   Affected agents: ${event.affectedExecutions.length}`,
  ]

  for (const exec of event.affectedExecutions) {
    lines.push(`     • ${exec.agentName} (${exec.ticketId})`)
  }

  if (event.recoveryAttempted) {
    if (event.recoveredSessions.length === event.affectedExecutions.length) {
      lines.push(`   Recovery: ALL ${event.recoveredSessions.length} sessions restored`)
    } else if (event.recoveredSessions.length > 0) {
      lines.push(
        `   Recovery: ${event.recoveredSessions.length}/${event.affectedExecutions.length} restored`,
      )
      lines.push(`   Failed: ${event.failedRecoveries.join(', ')}`)
    } else {
      lines.push(`   Recovery: FAILED — all ${event.affectedExecutions.length} sessions need manual restart`)
      lines.push('   Run: prlt session health')
    }
  } else {
    lines.push('   Auto-recovery: disabled')
    lines.push('   Run: prlt session health')
  }

  return lines.join('\n')
}

/**
 * Send a desktop notification about a tmux crash (best effort).
 * Uses osascript on macOS, notify-send on Linux.
 */
export function sendDesktopNotification(title: string, message: string): void {
  try {
    if (process.platform === 'darwin') {
      execSync(
        `osascript -e 'display notification "${message.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}"'`,
        { stdio: 'pipe', timeout: 5000 },
      )
    } else if (process.platform === 'linux') {
      execSync(
        `notify-send "${title.replace(/"/g, '\\"')}" "${message.replace(/"/g, '\\"')}" 2>/dev/null`,
        { stdio: 'pipe', timeout: 5000 },
      )
    }
  } catch {
    // Best effort — notification systems may not be available
  }
}

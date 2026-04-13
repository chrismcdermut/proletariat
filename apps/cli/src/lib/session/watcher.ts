/**
 * Session Watcher
 *
 * Host-side cron/poll loop that monitors agent heartbeats and takes action
 * on stale executions. This is the safety net for detecting hung agents
 * that can't self-report (OOM kills, zombie processes, container crashes).
 *
 * Architecture:
 * Phase 0: Tmux server health check — detect full server crashes (PRLT-1115)
 * Phase 1: Record heartbeats for alive agents (tmux pane inspection)
 * Phase 2: Detect stale executions that exceeded the timeout
 * Phase 3: Act on stale executions — mark failed, kill containers, fire events
 */

import type Database from 'better-sqlite3'
import { ExecutionStorage } from '../execution/storage.js'
import type { AgentWork } from '../execution/types.js'
import {
  recordAllHeartbeats,
  detectStaleExecutions,
  killContainer,
  type StaleExecution,
} from './heartbeat.js'
import {
  TmuxWatchdog,
  formatCrashNotification,
  sendDesktopNotification,
  type TmuxCrashEvent,
} from './tmux-watchdog.js'

// =============================================================================
// Types
// =============================================================================

export interface WatcherOptions {
  /** Database connection */
  db: Database.Database
  /** Poll interval in minutes (default: 5) */
  intervalMinutes?: number
  /** Heartbeat timeout in minutes (default: 15) */
  timeoutMinutes?: number
  /** Whether to kill containers on timeout (default: true) */
  autoKill?: boolean
  /** Whether to auto-recover from tmux server crashes (default: true) */
  autoRecover?: boolean
  /** Logger function */
  log?: (msg: string) => void
  /** Callback when a stale execution is detected and handled */
  onStaleDetected?: (execution: AgentWork, reason: string) => void | Promise<void>
  /** Callback when a tmux server crash is detected */
  onCrashDetected?: (event: TmuxCrashEvent) => void | Promise<void>
}

export interface WatchCycleResult {
  /** Number of active executions checked */
  checked: number
  /** Number of heartbeats updated (agents confirmed alive) */
  heartbeatsUpdated: number
  /** Stale executions detected and acted upon */
  staleExecutions: StaleExecution[]
  /** Number of containers killed */
  containersKilled: number
  /** Tmux crash events detected in this cycle */
  crashEvents: TmuxCrashEvent[]
  /** Total sessions recovered from crashes */
  crashRecoveries: number
}

// =============================================================================
// Session Watcher
// =============================================================================

export class SessionWatcher {
  private storage: ExecutionStorage
  private db: Database.Database
  private intervalMinutes: number
  private timeoutMinutes: number
  private autoKill: boolean
  private autoRecover: boolean
  private log: (msg: string) => void
  private onStaleDetected?: (execution: AgentWork, reason: string) => void | Promise<void>
  private onCrashDetected?: (event: TmuxCrashEvent) => void | Promise<void>
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false
  private watchdog: TmuxWatchdog
  private isFirstCycle = true

  constructor(options: WatcherOptions) {
    this.db = options.db
    this.storage = new ExecutionStorage(options.db)
    this.intervalMinutes = options.intervalMinutes ?? 5
    this.timeoutMinutes = options.timeoutMinutes ?? 15
    this.autoKill = options.autoKill ?? true
    this.autoRecover = options.autoRecover ?? true
    this.log = options.log ?? (() => {})
    this.onStaleDetected = options.onStaleDetected
    this.onCrashDetected = options.onCrashDetected

    this.watchdog = new TmuxWatchdog({
      storage: this.storage,
      autoRecover: this.autoRecover,
      log: this.log,
      onCrashDetected: async (event) => {
        // Send desktop notification
        const notification = formatCrashNotification(event)
        this.log(notification)
        sendDesktopNotification(
          'prlt: tmux server crash',
          `${event.affectedExecutions.length} agent(s) affected. ` +
          `${event.recoveredSessions.length} recovered.`,
        )

        // Fire user callback
        if (this.onCrashDetected) {
          await this.onCrashDetected(event)
        }
      },
    })
  }

  /**
   * Run a single watch cycle.
   * Can be called directly for one-shot checking, or used by the polling loop.
   */
  async runCycle(): Promise<WatchCycleResult> {
    const result: WatchCycleResult = {
      checked: 0,
      heartbeatsUpdated: 0,
      staleExecutions: [],
      containersKilled: 0,
      crashEvents: [],
      crashRecoveries: 0,
    }

    // Phase 0: Tmux server health check (PRLT-1115)
    // Detect full server crashes before doing individual heartbeat checks.
    // On the first cycle, seed the watchdog state without triggering crash detection.
    if (this.isFirstCycle) {
      const activeExecs = [
        ...this.storage.listExecutions({ status: 'running' }),
        ...this.storage.listExecutions({ status: 'starting' }),
      ]
      this.watchdog.seedServerState(activeExecs)
      this.isFirstCycle = false
    } else {
      const watchdogResult = await this.watchdog.checkAndRecover()
      result.crashEvents = watchdogResult.crashEvents
      result.crashRecoveries = watchdogResult.totalRecovered
    }

    // Phase 1: Record heartbeats for all active executions
    // This is the "push" side — we check tmux panes and update heartbeats
    const heartbeats = recordAllHeartbeats(this.storage)
    result.heartbeatsUpdated = heartbeats.size
    result.checked = heartbeats.size

    // Phase 2: Detect stale executions that exceeded timeout
    // This is the "pull" side — safety net for completely dead agents
    const staleExecutions = detectStaleExecutions(this.storage, this.timeoutMinutes)
    result.staleExecutions = staleExecutions

    // Phase 3: Act on stale executions
    for (const stale of staleExecutions) {
      const exec = stale.execution
      this.log(
        `[watcher] Stale agent detected: ${exec.agentName} (${exec.ticketId}) — ${stale.reason}`
      )

      // Mark execution as failed due to heartbeat timeout
      this.storage.markHeartbeatTimeout(exec.id)

      // Kill container if configured and applicable
      if (this.autoKill && exec.containerId) {
        this.log(`[watcher] Killing container ${exec.containerId} for ${exec.agentName}`)
        const killed = killContainer(exec.containerId)
        if (killed) {
          result.containersKilled++
          this.log(`[watcher] Container ${exec.containerId} killed`)
        } else {
          this.log(`[watcher] Failed to kill container ${exec.containerId}`)
        }
      }

      // Fire callback
      if (this.onStaleDetected) {
        await this.onStaleDetected(exec, stale.reason)
      }
    }

    return result
  }

  /**
   * Start the polling loop.
   * Runs an initial cycle immediately, then polls at the configured interval.
   */
  start(): void {
    if (this.running) return
    this.running = true

    this.log(
      `[watcher] Starting session watcher (interval: ${this.intervalMinutes}m, timeout: ${this.timeoutMinutes}m, ` +
      `auto-kill: ${this.autoKill}, auto-recover: ${this.autoRecover})`
    )

    // Run initial cycle
    void this.runCycleWithErrorHandling()

    // Start polling
    const intervalMs = this.intervalMinutes * 60 * 1000
    this.timer = setInterval(() => {
      void this.runCycleWithErrorHandling()
    }, intervalMs)
  }

  /**
   * Stop the polling loop.
   */
  stop(): void {
    if (!this.running) return
    this.running = false

    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }

    this.log('[watcher] Session watcher stopped')
  }

  /**
   * Check if the watcher is currently running.
   */
  isRunning(): boolean {
    return this.running
  }

  /**
   * Get current configuration.
   */
  getConfig(): {
    intervalMinutes: number
    timeoutMinutes: number
    autoKill: boolean
    autoRecover: boolean
  } {
    return {
      intervalMinutes: this.intervalMinutes,
      timeoutMinutes: this.timeoutMinutes,
      autoKill: this.autoKill,
      autoRecover: this.autoRecover,
    }
  }

  /**
   * Get the tmux watchdog instance (for testing/diagnostics).
   */
  getWatchdog(): TmuxWatchdog {
    return this.watchdog
  }

  private async runCycleWithErrorHandling(): Promise<void> {
    try {
      const result = await this.runCycle()
      if (result.staleExecutions.length > 0 || result.crashEvents.length > 0) {
        const parts = [
          `${result.checked} checked`,
          `${result.heartbeatsUpdated} heartbeats`,
          `${result.staleExecutions.length} stale`,
          `${result.containersKilled} killed`,
        ]
        if (result.crashEvents.length > 0) {
          parts.push(`${result.crashEvents.length} crash(es)`)
          parts.push(`${result.crashRecoveries} recovered`)
        }
        this.log(`[watcher] Cycle complete: ${parts.join(', ')}`)
      }
    } catch (error) {
      this.log(`[watcher] Error during watch cycle: ${error instanceof Error ? error.message : error}`)
    }
  }
}

/**
 * Session Watcher
 *
 * Host-side cron/poll loop that monitors agent heartbeats and takes action
 * on stale executions. This is the safety net for detecting hung agents
 * that can't self-report (OOM kills, zombie processes, container crashes).
 *
 * Architecture:
 * 1. Poll: Check all running executions for heartbeat timeout
 * 2. Update: Record heartbeats for alive agents (tmux pane inspection)
 * 3. Detect: Find stale executions that exceeded the timeout
 * 4. Act: Mark failed, kill containers, fire events
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
  /** Logger function */
  log?: (msg: string) => void
  /** Callback when a stale execution is detected and handled */
  onStaleDetected?: (execution: AgentWork, reason: string) => void | Promise<void>
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
  private log: (msg: string) => void
  private onStaleDetected?: (execution: AgentWork, reason: string) => void | Promise<void>
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false

  constructor(options: WatcherOptions) {
    this.db = options.db
    this.storage = new ExecutionStorage(options.db)
    this.intervalMinutes = options.intervalMinutes ?? 5
    this.timeoutMinutes = options.timeoutMinutes ?? 15
    this.autoKill = options.autoKill ?? true
    this.log = options.log ?? (() => {})
    this.onStaleDetected = options.onStaleDetected
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
      `[watcher] Starting session watcher (interval: ${this.intervalMinutes}m, timeout: ${this.timeoutMinutes}m, auto-kill: ${this.autoKill})`
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
  getConfig(): { intervalMinutes: number; timeoutMinutes: number; autoKill: boolean } {
    return {
      intervalMinutes: this.intervalMinutes,
      timeoutMinutes: this.timeoutMinutes,
      autoKill: this.autoKill,
    }
  }

  private async runCycleWithErrorHandling(): Promise<void> {
    try {
      const result = await this.runCycle()
      if (result.staleExecutions.length > 0) {
        this.log(
          `[watcher] Cycle complete: ${result.checked} checked, ${result.heartbeatsUpdated} heartbeats, ` +
          `${result.staleExecutions.length} stale, ${result.containersKilled} killed`
        )
      }
    } catch (error) {
      this.log(`[watcher] Error during watch cycle: ${error instanceof Error ? error.message : error}`)
    }
  }
}

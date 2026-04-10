/**
 * prlt reconcile — Reconcile session and execution state.
 *
 * Single pass: checks running sessions/executions against actual tmux sessions,
 * marks stale ones as done/stopped.
 *
 * --watch: runs as a supervised daemon in a tmux session, periodically reconciling.
 * --foreground: runs the watch loop in the current terminal (for debugging).
 */

import { Flags } from '@oclif/core'
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import { SqliteDatabase } from '../../lib/database/sqlite.js'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { ExecutionStorage } from '../../lib/execution/index.js'
import { SessionStore } from '../../lib/session-store.js'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import { onShutdown } from '../../lib/signal-handler.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'

/** Well-known tmux session name for the reconciler daemon. */
export const RECONCILER_SESSION_NAME = 'prlt-reconciler'

export default class Reconcile extends PMOCommand {
  static description = 'Reconcile session and execution state with actual tmux sessions'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --watch',
    '<%= config.bin %> <%= command.id %> --watch --foreground',
    '<%= config.bin %> <%= command.id %> --watch --interval 30',
  ]

  static flags = {
    ...pmoBaseFlags,
    watch: Flags.boolean({
      char: 'w',
      description: 'Run continuously as a daemon (spawns tmux session unless --foreground)',
      default: false,
    }),
    foreground: Flags.boolean({
      description: 'Run watch loop in the current terminal instead of spawning tmux (for debugging)',
      default: false,
    }),
    interval: Flags.integer({
      description: 'Watch polling interval in seconds',
      default: 30,
    }),
  }

  protected getPMOOptions() {
    return { promptIfMultiple: false }
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(Reconcile)
    const jsonMode = shouldOutputJson(flags)

    if (!flags.watch) {
      // Single-pass reconciliation
      const result = this.runReconcilePass(jsonMode, flags)
      if (jsonMode) {
        outputSuccessAsJson(result, createMetadata('reconcile', flags))
      }
      return
    }

    // Watch mode: either spawn as tmux daemon or run in foreground
    if (flags.foreground) {
      await this.runForeground(flags.interval, jsonMode, flags)
    } else {
      this.spawnDaemon(flags.interval, jsonMode, flags)
    }
  }

  /**
   * Run a single reconciliation pass.
   * Returns a summary of what was cleaned up.
   */
  runReconcilePass(
    jsonMode: boolean = false,
    _flags: Record<string, unknown> = {},
  ): { sessionsReconciled: number; executionsCleaned: number } {
    // Reconcile global session store
    const sessionStore = new SessionStore()
    let sessionsReconciled = 0
    try {
      const runningBefore = sessionStore.list('running').length
      sessionStore.reconcile()
      const runningAfter = sessionStore.list('running').length
      sessionsReconciled = runningBefore - runningAfter
    } finally {
      sessionStore.close()
    }

    // Reconcile workspace execution records
    let executionsCleaned = 0
    try {
      const workspaceInfo = getWorkspaceInfo()
      const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
      const db = new SqliteDatabase(dbPath)
      try {
        const executionStorage = new ExecutionStorage(db)
        executionsCleaned = executionStorage.cleanupStaleExecutions()
      } finally {
        db.close()
      }
    } catch {
      // Not in a workspace — skip execution cleanup
    }

    if (!jsonMode) {
      if (sessionsReconciled > 0 || executionsCleaned > 0) {
        if (sessionsReconciled > 0) {
          this.log(styles.info(`  Reconciled ${sessionsReconciled} stale session(s)`))
        }
        if (executionsCleaned > 0) {
          this.log(styles.info(`  Cleaned ${executionsCleaned} stale execution(s)`))
        }
      } else {
        this.log(styles.muted('  All sessions and executions are in sync.'))
      }
    }

    return { sessionsReconciled, executionsCleaned }
  }

  /**
   * Spawn the reconciler as a tmux daemon session.
   * Registers in the global session store with role: 'daemon'.
   */
  private spawnDaemon(
    interval: number,
    jsonMode: boolean,
    flags: Record<string, unknown>,
  ): void {
    // Check if tmux is available
    try {
      execSync('which tmux', { stdio: 'pipe' })
    } catch {
      if (jsonMode) {
        outputErrorAsJson('TMUX_NOT_FOUND', 'tmux is not installed or not in PATH.', createMetadata('reconcile', flags))
        return
      }
      this.error('tmux is not installed or not in PATH.')
    }

    // Check if reconciler is already running
    const sessionStore = new SessionStore()
    try {
      if (sessionStore.isDaemonRunning(RECONCILER_SESSION_NAME)) {
        // Also verify the tmux session actually exists
        try {
          execSync(`tmux has-session -t "${RECONCILER_SESSION_NAME}" 2>/dev/null`, { stdio: 'pipe' })
          if (jsonMode) {
            outputSuccessAsJson({ status: 'already_running', sessionName: RECONCILER_SESSION_NAME }, createMetadata('reconcile', flags))
            return
          }
          this.log(styles.muted(`Reconciler daemon is already running (session: ${RECONCILER_SESSION_NAME})`))
          return
        } catch {
          // tmux session is gone but DB says running — clean it up
          sessionStore.reconcile()
        }
      }
    } finally {
      sessionStore.close()
    }

    // Check if a tmux session with this name already exists (not tracked in DB)
    try {
      execSync(`tmux has-session -t "${RECONCILER_SESSION_NAME}" 2>/dev/null`, { stdio: 'pipe' })
      // Session exists but not tracked — kill it and re-create
      execSync(`tmux kill-session -t "${RECONCILER_SESSION_NAME}"`, { stdio: 'pipe' })
    } catch {
      // No existing session — good
    }

    // Spawn the tmux session running `prlt reconcile --watch --foreground`
    const cmd = `prlt reconcile --watch --foreground --interval ${interval}`
    try {
      execSync(
        `tmux new-session -d -s "${RECONCILER_SESSION_NAME}" -n "${RECONCILER_SESSION_NAME}" "${cmd}"`,
        { stdio: 'pipe' },
      )
    } catch (error) {
      if (jsonMode) {
        outputErrorAsJson('SPAWN_FAILED', `Failed to spawn tmux session: ${error}`, createMetadata('reconcile', flags))
        return
      }
      this.error(`Failed to spawn reconciler tmux session: ${error}`)
    }

    // Register in global session store as daemon
    let workdir = process.cwd()
    try {
      workdir = getWorkspaceInfo().path
    } catch {
      // Not in workspace — use cwd
    }

    const store = new SessionStore()
    try {
      store.create({
        agentName: 'reconciler',
        runner: 'daemon',
        task: 'Reconcile session and execution state',
        workdir,
        sessionName: RECONCILER_SESSION_NAME,
        environment: 'host',
        permissionMode: 'safe',
        role: 'daemon',
      })
    } finally {
      store.close()
    }

    if (jsonMode) {
      outputSuccessAsJson(
        { status: 'started', sessionName: RECONCILER_SESSION_NAME, interval },
        createMetadata('reconcile', flags),
      )
      return
    }

    this.log('')
    this.log(styles.success(`Reconciler daemon started (session: ${RECONCILER_SESSION_NAME})`))
    this.log(styles.muted(`  Interval: ${interval}s`))
    this.log(styles.muted(`  Attach:   tmux attach -t ${RECONCILER_SESSION_NAME}`))
    this.log(styles.muted(`  Stop:     prlt session stop ${RECONCILER_SESSION_NAME}`))
    this.log('')
  }

  /**
   * Run the watch loop in the current terminal (foreground mode).
   * Used directly for --foreground debugging and also as the process
   * inside the daemon tmux session.
   */
  private async runForeground(
    interval: number,
    jsonMode: boolean,
    flags: Record<string, unknown>,
  ): Promise<void> {
    if (!jsonMode) {
      this.log('')
      this.log(styles.title('Reconciler daemon (foreground)'))
      this.log(styles.muted(`  Interval: ${interval}s`))
      this.log(styles.muted('  Press Ctrl+C to stop'))
      this.log('')
    }

    const poll = () => {
      const timestamp = new Date().toLocaleTimeString()
      if (!jsonMode) {
        this.log(styles.muted(`[${timestamp}] Reconciling...`))
      }
      this.runReconcilePass(jsonMode, flags)
    }

    // Initial pass
    poll()

    // Poll loop
    const intervalMs = interval * 1000
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        try {
          poll()
        } catch (error) {
          if (!jsonMode) {
            this.log(styles.error(`  Reconcile error: ${error}`))
          }
        }
      }, intervalMs)

      onShutdown(() => {
        clearInterval(timer)
        if (!jsonMode) {
          this.log(styles.muted('\n  Reconciler stopped'))
        }
        resolve()
      })
    })
  }
}

/**
 * prlt reconcile — Session reconciliation daemon
 *
 * Reconciles session state (DB vs tmux reality) on a periodic interval.
 * By default, spawns as a background tmux session registered with role=daemon.
 * Use --foreground for debugging (runs in current terminal).
 */

import { Flags } from '@oclif/core'
import { execSync } from 'node:child_process'
import { openWorkspaceDatabase } from '../../lib/database/index.js'
import { styles } from '../../lib/styles.js'
import { getWorkspaceInfo } from '../../lib/agents/commands.js'
import { ExecutionStorage } from '../../lib/execution/index.js'
import { SessionStore } from '../../lib/session-store.js'
import { onShutdown } from '../../lib/signal-handler.js'
import { PromptCommand } from '../../lib/prompt-command.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'

/** Tmux session name for the reconciler daemon */
export const RECONCILER_SESSION_NAME = 'prlt-daemon-reconciler'

/** Sentinel ticket ID for daemon executions (daemons don't work on tickets) */
export const DAEMON_TICKET_ID = 'DAEMON'

/**
 * Check if the reconciler daemon is already running.
 */
export function isReconcilerRunning(): boolean {
  try {
    execSync(`tmux has-session -t "${RECONCILER_SESSION_NAME}" 2>/dev/null`, { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

/**
 * Spawn the reconciler as a tmux daemon session.
 * Returns the tmux session name on success, null on failure.
 */
export function spawnReconcilerDaemon(hqPath: string, intervalSeconds: number): string | null {
  if (isReconcilerRunning()) {
    return RECONCILER_SESSION_NAME
  }

  try {
    // Spawn a detached tmux session running the reconciler in foreground mode
    const cmd = `cd "${hqPath}" && prlt reconcile --foreground --interval ${intervalSeconds}`
    execSync(
      `tmux new-session -d -s "${RECONCILER_SESSION_NAME}" -n "${RECONCILER_SESSION_NAME}" "${cmd}"`,
      { stdio: 'pipe', timeout: 10000 },
    )
    return RECONCILER_SESSION_NAME
  } catch {
    return null
  }
}

/**
 * Register the reconciler daemon in the agent_work table.
 */
export function registerReconcilerExecution(
  executionStorage: ExecutionStorage,
  sessionName: string,
): string {
  // Check if there's already a running daemon execution
  const existing = executionStorage.listExecutions({
    status: 'running',
    role: 'daemon',
  })
  const reconcilerExec = existing.find(e => e.agentName === 'reconciler')
  if (reconcilerExec) {
    return reconcilerExec.id
  }

  const exec = executionStorage.createExecution({
    ticketId: DAEMON_TICKET_ID,
    agentName: 'reconciler',
    executor: 'custom',
    environment: 'host',
    displayMode: 'background',
    permissionMode: 'safe',
    cleanupPolicy: 'persistent',
    role: 'daemon',
    sessionId: sessionName,
  })

  // Immediately mark as running (daemons start instantly)
  executionStorage.updateStatus(exec.id, 'running')
  return exec.id
}

export default class Reconcile extends PromptCommand {
  static description = 'Start the session reconciliation daemon'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --foreground',
    '<%= config.bin %> <%= command.id %> --interval 60',
    '<%= config.bin %> <%= command.id %> --foreground --interval 10',
  ]

  static flags = {
    ...machineOutputFlags,
    foreground: Flags.boolean({
      description: 'Run in current terminal instead of spawning a tmux session (for debugging)',
      default: false,
    }),
    interval: Flags.integer({
      description: 'Reconciliation interval in seconds',
      default: 30,
    }),
    status: Flags.boolean({
      description: 'Show reconciler daemon status and exit',
      default: false,
    }),
    stop: Flags.boolean({
      description: 'Stop the reconciler daemon',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Reconcile)
    const jsonMode = shouldOutputJson(flags)

    // Status check
    if (flags.status) {
      const running = isReconcilerRunning()
      if (jsonMode) {
        outputSuccessAsJson({ running, sessionName: RECONCILER_SESSION_NAME }, createMetadata('reconcile', flags))
      } else {
        this.log('')
        if (running) {
          this.log(styles.success(`Reconciler daemon is running (session: ${RECONCILER_SESSION_NAME})`))
        } else {
          this.log(styles.muted('Reconciler daemon is not running.'))
        }
        this.log('')
      }
      return
    }

    // Stop the daemon
    if (flags.stop) {
      return this.stopDaemon(jsonMode, flags)
    }

    // Get workspace info
    let workspaceInfo
    try {
      workspaceInfo = getWorkspaceInfo()
    } catch {
      if (jsonMode) {
        outputErrorAsJson('NOT_IN_WORKSPACE', 'Not in a workspace. Run "prlt new" first.', createMetadata('reconcile', flags))
        return
      }
      this.error('Not in a workspace. Run "prlt new" first.')
    }

    if (flags.foreground) {
      return this.runForeground(workspaceInfo.path, flags.interval, jsonMode, flags)
    }

    return this.spawnDaemon(workspaceInfo.path, flags.interval, jsonMode, flags)
  }

  /**
   * Run the reconciler in the current terminal (foreground/debug mode).
   */
  private async runForeground(
    hqPath: string,
    intervalSeconds: number,
    jsonMode: boolean,
    flags: Record<string, unknown>,
  ): Promise<void> {
    const db = openWorkspaceDatabase(hqPath)
    const executionStorage = new ExecutionStorage(db)
    const sessionStore = new SessionStore()

    if (!jsonMode) {
      this.log('')
      this.log(styles.title('Reconciler running in foreground'))
      this.log(styles.muted(`  Interval: ${intervalSeconds}s`))
      this.log(styles.muted('  Press Ctrl+C to stop'))
      this.log('')
    }

    const reconcile = () => {
      const timestamp = new Date().toLocaleTimeString()
      try {
        // Reconcile global session store (sessions.db)
        sessionStore.reconcile()

        // Reconcile workspace execution records (agent_work)
        const cleaned = executionStorage.cleanupStaleExecutions()

        if (!jsonMode && cleaned > 0) {
          this.log(styles.info(`[${timestamp}] Cleaned ${cleaned} stale execution(s)`))
        } else if (!jsonMode) {
          this.log(styles.muted(`[${timestamp}] All sessions healthy`))
        }
      } catch (error) {
        if (!jsonMode) {
          this.log(styles.error(`[${timestamp}] Reconciliation error: ${error}`))
        }
      }
    }

    // Initial reconciliation
    reconcile()

    // Periodic reconciliation loop
    const intervalMs = intervalSeconds * 1000
    await new Promise<void>((resolve) => {
      const timer = setInterval(reconcile, intervalMs)

      onShutdown(() => {
        clearInterval(timer)
        sessionStore.close()
        db.close()
        if (!jsonMode) {
          this.log(styles.muted('\nReconciler stopped.'))
        }
        resolve()
      })
    })
  }

  /**
   * Spawn the reconciler as a tmux daemon session.
   */
  private async spawnDaemon(
    hqPath: string,
    intervalSeconds: number,
    jsonMode: boolean,
    flags: Record<string, unknown>,
  ): Promise<void> {
    // Check if already running
    if (isReconcilerRunning()) {
      if (jsonMode) {
        outputSuccessAsJson({
          status: 'already_running',
          sessionName: RECONCILER_SESSION_NAME,
        }, createMetadata('reconcile', flags))
        return
      }
      this.log('')
      this.log(styles.warning(`Reconciler daemon is already running (session: ${RECONCILER_SESSION_NAME})`))
      this.log(styles.muted('  Use --stop to stop it, or --foreground to run in current terminal.'))
      this.log('')
      return
    }

    // Spawn the tmux session
    const sessionName = spawnReconcilerDaemon(hqPath, intervalSeconds)
    if (!sessionName) {
      if (jsonMode) {
        outputErrorAsJson('SPAWN_FAILED', 'Failed to spawn reconciler tmux session', createMetadata('reconcile', flags))
        return
      }
      this.log(styles.error('Failed to spawn reconciler tmux session.'))
      this.log(styles.muted('  Is tmux installed? Try: which tmux'))
      return
    }

    // Register in agent_work
    const db = openWorkspaceDatabase(hqPath)
    try {
      const executionStorage = new ExecutionStorage(db)
      registerReconcilerExecution(executionStorage, sessionName)
    } finally {
      db.close()
    }

    if (jsonMode) {
      outputSuccessAsJson({
        status: 'started',
        sessionName,
        interval: intervalSeconds,
      }, createMetadata('reconcile', flags))
      return
    }

    this.log('')
    this.log(styles.success(`Reconciler daemon started (session: ${sessionName})`))
    this.log(styles.muted(`  Interval: ${intervalSeconds}s`))
    this.log(styles.muted(`  Attach: tmux attach -t ${sessionName}`))
    this.log(styles.muted(`  Stop:   prlt reconcile --stop`))
    this.log('')
  }

  /**
   * Stop the reconciler daemon.
   */
  private async stopDaemon(jsonMode: boolean, flags: Record<string, unknown>): Promise<void> {
    if (!isReconcilerRunning()) {
      if (jsonMode) {
        outputSuccessAsJson({ status: 'not_running' }, createMetadata('reconcile', flags))
        return
      }
      this.log(styles.muted('Reconciler daemon is not running.'))
      return
    }

    try {
      execSync(`tmux kill-session -t "${RECONCILER_SESSION_NAME}"`, { stdio: 'pipe', timeout: 5000 })
    } catch {
      if (jsonMode) {
        outputErrorAsJson('STOP_FAILED', 'Failed to kill reconciler tmux session', createMetadata('reconcile', flags))
        return
      }
      this.log(styles.error('Failed to stop reconciler daemon.'))
      return
    }

    // Mark execution as stopped in agent_work
    try {
      const workspaceInfo = getWorkspaceInfo()
      const db = openWorkspaceDatabase(workspaceInfo.path)
      try {
        const executionStorage = new ExecutionStorage(db)
        const daemonExecs = executionStorage.listExecutions({
          status: 'running',
          role: 'daemon',
        })
        for (const exec of daemonExecs) {
          if (exec.agentName === 'reconciler') {
            executionStorage.updateStatus(exec.id, 'stopped')
          }
        }
      } finally {
        db.close()
      }
    } catch {
      // Best-effort cleanup of DB records
    }

    if (jsonMode) {
      outputSuccessAsJson({ status: 'stopped' }, createMetadata('reconcile', flags))
      return
    }

    this.log(styles.success('Reconciler daemon stopped.'))
  }
}

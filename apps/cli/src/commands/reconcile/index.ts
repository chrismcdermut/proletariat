/**
 * prlt reconcile — Session reconciler daemon
 *
 * Reconciles session statuses with actual tmux sessions.
 * Can run as a foreground process (--foreground) or spawn a supervised
 * tmux daemon session (--watch) that survives terminal close.
 *
 * When running as a daemon:
 * - Spawns itself as a tmux session
 * - Registers in sessions.db with role='daemon', daemon_type='reconciler'
 * - Monitored by `prlt session health`
 * - Supervised by `prlt orchestrate` (auto-restart on crash)
 */

import { Flags } from '@oclif/core'
import { execSync } from 'node:child_process'
import { PromptCommand } from '../../lib/prompt-command.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import { SessionStore } from '../../lib/session-store.js'
import { styles } from '../../lib/styles.js'
import { onShutdown } from '../../lib/signal-handler.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'

/** Default tmux session name for the reconciler daemon. */
export const RECONCILER_SESSION_NAME = 'prlt-daemon-reconciler'

/** Default polling interval in seconds. */
const DEFAULT_INTERVAL = 30

export default class Reconcile extends PromptCommand {
  static description = 'Run the session reconciler (daemon or foreground)'

  static examples = [
    '<%= config.bin %> reconcile --watch',
    '<%= config.bin %> reconcile --watch --interval 60',
    '<%= config.bin %> reconcile --watch --foreground',
    '<%= config.bin %> reconcile',
  ]

  static flags = {
    ...machineOutputFlags,
    watch: Flags.boolean({
      description: 'Run in continuous watch mode (spawns as daemon unless --foreground)',
      default: false,
    }),
    foreground: Flags.boolean({
      description: 'Run in the current terminal instead of spawning a tmux daemon',
      default: false,
    }),
    interval: Flags.integer({
      description: 'Polling interval in seconds (for --watch mode)',
      default: DEFAULT_INTERVAL,
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Reconcile)
    const jsonMode = shouldOutputJson(flags)

    if (!flags.watch) {
      // Single-pass reconcile (existing behavior)
      const store = new SessionStore()
      try {
        store.reconcile()
        if (jsonMode) {
          outputSuccessAsJson({ message: 'Reconciliation complete' }, createMetadata('reconcile', flags))
        } else {
          this.log(styles.success('Session reconciliation complete.'))
        }
      } finally {
        store.close()
      }
      return
    }

    // --watch mode
    if (flags.foreground) {
      // Run the watch loop in the current terminal
      await this.runForeground(flags.interval, jsonMode, flags)
    } else {
      // Spawn as a tmux daemon session
      await this.spawnDaemon(flags.interval, jsonMode, flags)
    }
  }

  /**
   * Spawn the reconciler as a detached tmux daemon session.
   * Registers the session in sessions.db with role='daemon'.
   */
  private async spawnDaemon(
    interval: number,
    jsonMode: boolean,
    flags: Record<string, unknown>,
  ): Promise<void> {
    const store = new SessionStore()
    try {
      // Check if a reconciler daemon is already running
      const existing = store.getRunningDaemon('reconciler')
      if (existing && store.isTmuxSessionAlive(existing.sessionName)) {
        if (jsonMode) {
          outputSuccessAsJson({
            message: 'Reconciler daemon is already running',
            sessionName: existing.sessionName,
            sessionId: existing.id,
          }, createMetadata('reconcile', flags))
        } else {
          this.log(styles.warning(`Reconciler daemon is already running (${existing.sessionName})`))
          this.log(styles.muted(`  Session ID: ${existing.id}`))
          this.log(styles.muted(`  Started: ${existing.startedAt.toLocaleString()}`))
        }
        return
      }

      // If there's a stale DB record, mark it done
      if (existing && !store.isTmuxSessionAlive(existing.sessionName)) {
        store.updateStatus(existing.id, 'done')
      }

      // Resolve the prlt binary path for the tmux script
      const prltPath = getPrltPath()

      // Create the tmux session running the reconciler in foreground mode
      const tmuxCmd = `tmux new-session -d -s "${RECONCILER_SESSION_NAME}" "${prltPath} reconcile --watch --foreground --interval ${interval}"`
      try {
        execSync(tmuxCmd, { stdio: 'pipe' })
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        if (jsonMode) {
          outputErrorAsJson('TMUX_SPAWN_FAILED', `Failed to create tmux session: ${msg}`, createMetadata('reconcile', flags))
        } else {
          this.log(styles.error(`Failed to create tmux session: ${msg}`))
        }
        return
      }

      // Register in sessions.db as a daemon
      const session = store.create({
        agentName: 'reconciler',
        runner: 'daemon',
        task: 'session-reconciliation',
        workdir: process.cwd(),
        sessionName: RECONCILER_SESSION_NAME,
        environment: 'host',
        permissionMode: 'safe',
        role: 'daemon',
        daemonType: 'reconciler',
      })

      if (jsonMode) {
        outputSuccessAsJson({
          message: 'Reconciler daemon started',
          sessionName: RECONCILER_SESSION_NAME,
          sessionId: session.id,
          interval,
        }, createMetadata('reconcile', flags))
      } else {
        this.log(styles.success('Reconciler daemon started'))
        this.log(styles.muted(`  Session: ${RECONCILER_SESSION_NAME}`))
        this.log(styles.muted(`  Interval: ${interval}s`))
        this.log(styles.muted(`  ID: ${session.id}`))
        this.log('')
        this.log(styles.muted('  Attach: prlt session attach ' + RECONCILER_SESSION_NAME))
        this.log(styles.muted('  Stop:   prlt session stop ' + RECONCILER_SESSION_NAME))
      }
    } finally {
      store.close()
    }
  }

  /**
   * Run the reconciler in the current terminal (foreground mode).
   * Used for debugging or when invoked by the daemon tmux session.
   */
  private async runForeground(
    interval: number,
    jsonMode: boolean,
    flags: Record<string, unknown>,
  ): Promise<void> {
    if (!jsonMode) {
      this.log('')
      this.log(styles.header('Reconciler (foreground)'))
      this.log(styles.muted(`  Polling every ${interval}s`))
      this.log(styles.muted('  Press Ctrl+C to stop'))
      this.log('')
    }

    const poll = () => {
      const store = new SessionStore()
      try {
        const runningBefore = store.list('running').length
        store.reconcile()
        const runningAfter = store.list('running').length
        const reconciled = runningBefore - runningAfter

        if (reconciled > 0) {
          const timestamp = new Date().toLocaleTimeString()
          this.log(styles.info(`[${timestamp}] Reconciled ${reconciled} stale session(s)`))
        }
      } finally {
        store.close()
      }
    }

    // Initial pass
    poll()

    // Continuous polling
    const intervalMs = interval * 1000
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        try {
          poll()
        } catch (error) {
          this.log(styles.error(`  Reconcile error: ${error}`))
        }
      }, intervalMs)

      onShutdown(() => {
        clearInterval(timer)
        resolve()
      })
    })
  }
}

/**
 * Resolve the prlt binary path.
 * Tries `which prlt` first, falls back to common locations.
 */
function getPrltPath(): string {
  try {
    return execSync('which prlt', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  } catch {
    // Fallback: assume it's on PATH
    return 'prlt'
  }
}

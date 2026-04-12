/**
 * `prlt reconcile` — Tier 2 State Reconciler (PRLT-1280 + PRLT-1287)
 *
 * Polls GitHub for the live state of each linked PR and fires normal
 * ticket transitions to fix board drift.
 *
 * PRLT-1287: `--watch` now spawns a tmux session and registers in
 * machine.db with `role: 'daemon'` so the reconciler survives terminal
 * close and can be supervised by the orchestrator.
 * Use `--foreground` to run in the current terminal for debugging.
 */

import { Flags } from '@oclif/core'
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import { PMOCommand, pmoBaseFlags } from '../lib/pmo/index.js'
import type { PMOStorage } from '../lib/pmo/types.js'
import type { ProviderStorage } from '../lib/providers/types.js'
import { runReconcile, watchReconcile, type ReconcileReport } from '../lib/reconcile/index.js'
import { styles } from '../lib/styles.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  createMetadata,
} from '../lib/prompt-json.js'
import { getWorkspaceInfo } from '../lib/agents/commands.js'
import { SqliteDatabase } from '../lib/database/sqlite.js'
import { ExecutionStorage } from '../lib/execution/index.js'

/** Well-known tmux session name for the reconciler daemon */
export const RECONCILER_SESSION_NAME = 'reconciler'

/** Sentinel ticket ID used for daemon sessions (no real ticket) */
export const DAEMON_TICKET_ID = 'DAEMON'

export default class Reconcile extends PMOCommand {
  static description =
    'Tier 2 state reconciler — poll GitHub for linked PRs and fix board drift'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --dry-run',
    '<%= config.bin %> <%= command.id %> --watch',
    '<%= config.bin %> <%= command.id %> --watch --foreground',
    '<%= config.bin %> <%= command.id %> --watch --interval 60',
    '<%= config.bin %> <%= command.id %> -P proj-001',
  ]

  static flags = {
    ...pmoBaseFlags,
    'dry-run': Flags.boolean({
      description: 'Print the transitions that would be made, but do not execute them',
      default: false,
    }),
    watch: Flags.boolean({
      description: 'Run as a daemon in a tmux session (survives terminal close)',
      default: false,
    }),
    foreground: Flags.boolean({
      description: 'Run --watch in the current terminal instead of spawning a tmux session (for debugging)',
      default: false,
    }),
    interval: Flags.integer({
      description: 'Watch interval in seconds (used with --watch)',
      default: 300,
    }),
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(Reconcile)
    const db = this.storage.getDatabase()
    const jsonMode = shouldOutputJson(flags)
    const dryRun = flags['dry-run']
    const projectFlag = (flags as { project?: string }).project
    const storage = this.storage as unknown as PMOStorage & ProviderStorage

    if (flags.watch) {
      if (jsonMode) {
        this.error('--watch is not supported in JSON mode')
      }

      // --foreground: run in current terminal (same as old behavior)
      if (flags.foreground) {
        await this.runWatchForeground(db, storage, flags.interval, dryRun, projectFlag)
        return
      }

      // Default: spawn as a tmux daemon session
      await this.spawnDaemon(flags.interval, dryRun, projectFlag)
      return
    }

    const report = await runReconcile(db, storage, {
      dryRun,
      cwd: process.cwd(),
      projectId: projectFlag,
      log: jsonMode ? undefined : msg => this.log(msg),
    })

    if (jsonMode) {
      outputSuccessAsJson(
        {
          checked: report.checked,
          applied: report.applied,
          skipped: report.skipped,
          failed: report.failed,
          errors: report.errors,
          startedAt: report.startedAt,
          finishedAt: report.finishedAt,
          dryRun,
        },
        createMetadata('reconcile', flags),
      )
      return
    }

    this.printSummary(report, dryRun)
  }

  /**
   * Spawn the reconciler as a detached tmux session and register it
   * in machine.db with role='daemon'.
   */
  private async spawnDaemon(
    interval: number,
    dryRun: boolean,
    projectId?: string,
  ): Promise<void> {
    // Check if tmux is available
    try {
      execSync('which tmux', { stdio: 'pipe' })
    } catch {
      this.error('tmux is not installed. Install tmux or use --foreground to run in the current terminal.')
    }

    // Check if a reconciler session is already running
    const existingSessions = getReconcilerTmuxSessions()
    if (existingSessions.length > 0) {
      this.log(styles.warning('Reconciler daemon is already running.'))
      this.log(styles.muted(`  Session: ${existingSessions[0]}`))
      this.log(styles.muted('  Attach with: tmux attach -t reconciler'))
      this.log(styles.muted('  Or stop with: prlt session stop reconciler'))
      return
    }

    // Build the prlt command to run inside the tmux session
    // Use --foreground so the inner invocation runs in the tmux pane
    const args = ['reconcile', '--watch', '--foreground', `--interval`, String(interval)]
    if (dryRun) args.push('--dry-run')
    if (projectId) args.push('-P', projectId)

    const prltCmd = `prlt ${args.join(' ')}`

    // Spawn the tmux session
    const tmuxCmd = `tmux new-session -d -s "${RECONCILER_SESSION_NAME}" -n "${RECONCILER_SESSION_NAME}" bash -c '${prltCmd}; echo "Reconciler exited. Press Enter to close."; exec bash'`

    try {
      execSync(tmuxCmd, { stdio: 'pipe' })
    } catch (error) {
      this.error(`Failed to create tmux session: ${error instanceof Error ? error.message : error}`)
    }

    // Register in workspace.db as a daemon execution
    try {
      const workspaceInfo = getWorkspaceInfo()
      const dbPath = path.join(workspaceInfo.path, '.proletariat', 'workspace.db')
      const wsDb = new SqliteDatabase(dbPath)
      try {
        const executionStorage = new ExecutionStorage(wsDb)
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
      } finally {
        wsDb.close()
      }
    } catch {
      // Non-fatal: the tmux session was created successfully even if
      // DB registration fails. The session will be discoverable via tmux.
    }

    this.log(styles.success('Reconciler daemon started.'))
    this.log(styles.muted(`  Session: ${RECONCILER_SESSION_NAME}`))
    this.log(styles.muted(`  Interval: ${interval}s`))
    this.log(styles.muted(`  Attach: tmux attach -t ${RECONCILER_SESSION_NAME}`))
    this.log(styles.muted('  Stop: prlt session stop reconciler'))
  }

  /**
   * Run --watch in the current terminal (foreground mode for debugging).
   * This is the original --watch behavior before PRLT-1287.
   */
  private async runWatchForeground(
    db: ReturnType<typeof this.storage.getDatabase>,
    storage: PMOStorage & ProviderStorage,
    interval: number,
    dryRun: boolean,
    projectId?: string,
  ): Promise<void> {
    this.log(
      styles.muted(
        `Watching for drift every ${interval}s (Ctrl+C to stop)${dryRun ? ' [dry-run]' : ''}...`,
      ),
    )

    let stop = false
    const stopHandler = (): void => {
      stop = true
      this.log(styles.muted('\nStopping reconcile watcher...'))
    }
    process.once('SIGINT', stopHandler)
    process.once('SIGTERM', stopHandler)

    try {
      await watchReconcile(db, storage, {
        dryRun,
        cwd: process.cwd(),
        projectId,
        log: msg => this.log(msg),
        intervalMs: interval * 1000,
        shouldStop: () => stop,
        onCycle: report => this.printSummary(report, dryRun),
      })
    } finally {
      process.removeListener('SIGINT', stopHandler)
      process.removeListener('SIGTERM', stopHandler)
    }
  }

  private printSummary(report: ReconcileReport, dryRun: boolean): void {
    const { checked, applied, skipped, failed, errors } = report

    if (applied.length === 0 && skipped.length === 0 && failed.length === 0) {
      this.log(styles.muted(`Checked ${checked} ticket(s) — no drift detected.`))
      return
    }

    this.log('')
    this.log(styles.emphasis('Reconcile Summary:'))
    this.log(`  Checked: ${checked} ticket(s)`)

    if (applied.length > 0) {
      this.log(styles.success(`  Applied: ${applied.length} transition(s)`))
      for (const t of applied) {
        this.log(
          styles.muted(
            `    ${t.ticketId}: ${t.fromState ?? '?'} → ${t.toState}` +
              (t.prNumber ? ` (PR #${t.prNumber} ${t.prState ?? ''})` : ''),
          ),
        )
      }
    }

    if (dryRun && skipped.length > 0) {
      this.log(styles.warning(`  Skipped: ${skipped.length} (dry-run)`))
      for (const t of skipped) {
        this.log(
          styles.muted(
            `    [dry-run] ${t.ticketId}: ${t.fromState ?? '?'} → ${t.toState}` +
              (t.prNumber ? ` (PR #${t.prNumber} ${t.prState ?? ''})` : ''),
          ),
        )
      }
    }

    if (failed.length > 0) {
      this.log(styles.error(`  Failed: ${failed.length}`))
      for (const f of failed) {
        this.log(styles.error(`    ${f.transition.ticketId}: ${f.error}`))
      }
    }

    if (errors.length > 0) {
      this.log(styles.warning(`  Non-fatal errors: ${errors.length}`))
      for (const e of errors) {
        this.log(styles.muted(`    ${e.ticketId}: ${e.error}`))
      }
    }
  }
}

/**
 * Check if a reconciler tmux session is currently running.
 * Returns the list of matching session names.
 */
export function getReconcilerTmuxSessions(): string[] {
  try {
    const output = execSync(
      'tmux list-sessions -F "#{session_name}"',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim()
    if (!output) return []
    return output.split('\n').filter(s => s === RECONCILER_SESSION_NAME)
  } catch {
    return []
  }
}

/**
 * Check if the reconciler daemon is registered and running in the workspace DB.
 */
export function isReconcilerRunning(executionStorage: ExecutionStorage): boolean {
  const executions = executionStorage.listExecutions({ status: 'running' })
  return executions.some(e => e.role === 'daemon' && e.agentName === RECONCILER_SESSION_NAME)
}

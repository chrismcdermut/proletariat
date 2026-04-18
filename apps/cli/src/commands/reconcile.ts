/**
 * `prlt reconcile` — Tier 2 State Reconciler (PRLT-1280)
 *
 * Polls GitHub for the live state of each linked PR and fires normal
 * ticket transitions to fix board drift (e.g. "6 tickets stuck in Review
 * because someone merged via `gh pr merge` instead of `prlt work ship`").
 *
 * PRLT-1282: When `--escalate-to <session>` is set, the reconciler pokes
 * the orchestrator LLM on unresolvable/weird states instead of skipping.
 *
 * PRLT-1287: When `--watch` is used without `--foreground`, the reconciler
 * spawns as a supervised daemon in a tmux session, registered in machine.db
 * with role='daemon'. Use `--foreground` to run in the current terminal
 * (original behavior, useful for debugging).
 */

import { Flags } from '@oclif/core'
import { PMOCommand, pmoBaseFlags } from '../lib/pmo/index.js'
import type { PMOStorage } from '../lib/pmo/types.js'
import type { ProviderStorage } from '../lib/providers/types.js'
import type { ReconcileReport } from '../lib/reconcile/index.js'
import { styles } from '../lib/styles.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  createMetadata,
} from '../lib/prompt-json.js'
import { ReconcileService } from '../services/index.js'
import { getHeadquartersNameFromPath } from '../lib/machine-config.js'
import { getHostTmuxSessionNames } from '../lib/execution/session-utils.js'
import { buildDaemonSessionName } from '../lib/session/renderer.js'
import { MachineDB } from '../lib/machine-db.js'

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
    '<%= config.bin %> <%= command.id %> --watch --interval 30 --escalate-to orchestrator-main',
    '<%= config.bin %> <%= command.id %> --dry-run --escalate-to orchestrator-main',
  ]

  static flags = {
    ...pmoBaseFlags,
    'dry-run': Flags.boolean({
      description: 'Print the transitions that would be made, but do not execute them',
      default: false,
    }),
    watch: Flags.boolean({
      description: 'Run on a timer until killed (spawns as tmux daemon by default)',
      default: false,
    }),
    foreground: Flags.boolean({
      description: 'Run in the current terminal instead of spawning a tmux daemon (used with --watch)',
      default: false,
    }),
    interval: Flags.integer({
      description: 'Watch interval in seconds (used with --watch)',
      default: 300,
    }),
    'escalate-to': Flags.string({
      description: 'Session name to poke when unresolvable state is detected (Tier 2→3 bridge)',
    }),
    cooldown: Flags.integer({
      description: 'Minutes before re-poking the same ticket+issue (default: 30)',
      default: 30,
    }),
    'conflict-days': Flags.integer({
      description: 'Days before a stale open PR triggers escalation (default: 3)',
      default: 3,
    }),
    'no-pr-days': Flags.integer({
      description: 'Days before a ticket with no PR triggers escalation (default: 2)',
      default: 2,
    }),
    'idle-minutes': Flags.integer({
      description: 'Minutes before an idle agent session triggers escalation (default: 30)',
      default: 30,
    }),
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(Reconcile)
    const db = this.requireDB()
    const jsonMode = shouldOutputJson(flags)
    const dryRun = flags['dry-run']
    const projectFlag = (flags as { project?: string }).project
    const storage = this.storage as unknown as PMOStorage & ProviderStorage
    const reconcileService = new ReconcileService(db, storage)

    // Escalation options (PRLT-1282)
    const escalateTo = flags['escalate-to']
    const escalationOpts = {
      escalateTo,
      cooldownMinutes: flags.cooldown,
      escalationThresholds: {
        conflictDays: flags['conflict-days'],
        noPrDays: flags['no-pr-days'],
        idleSessionMinutes: flags['idle-minutes'],
      },
      // Provide running executions for session-idle detection
      listRunningExecutions: escalateTo ? this.buildExecutionLister() : undefined,
    }

    if (flags.watch) {
      if (!flags.foreground) {
        // Default --watch behavior: spawn as tmux daemon
        return this.spawnDaemon(flags, jsonMode)
      }

      // --foreground: run in current terminal (original behavior)
      const escalateNote = escalateTo ? ` [escalate → ${escalateTo}]` : ''
      this.log(
        styles.muted(
          `Watching for drift every ${flags.interval}s (Ctrl+C to stop)${dryRun ? ' [dry-run]' : ''}${escalateNote}...`,
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
        await reconcileService.watch({
          dryRun,
          cwd: this.hqPath ?? process.cwd(),
          projectId: projectFlag,
          log: msg => this.log(msg),
          intervalMs: flags.interval * 1000,
          shouldStop: () => stop,
          onCycle: report => this.printSummary(report, dryRun),
          ...escalationOpts,
        })
      } finally {
        process.removeListener('SIGINT', stopHandler)
        process.removeListener('SIGTERM', stopHandler)
      }
      return
    }

    const report = await reconcileService.runOnce({
      dryRun,
      cwd: this.hqPath ?? process.cwd(),
      projectId: projectFlag,
      log: jsonMode ? undefined : msg => this.log(msg),
      ...escalationOpts,
    })

    if (jsonMode) {
      outputSuccessAsJson(
        {
          checked: report.checked,
          applied: report.applied,
          skipped: report.skipped,
          failed: report.failed,
          errors: report.errors,
          escalated: report.escalated,
          cooledDown: report.cooledDown,
          escalationDryRun: report.escalationDryRun,
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
   * Build a function that lists running executions from machine.db.
   * Used for session-idle detection in escalation.
   */
  private buildExecutionLister(): () => Array<{
    ticketId?: string
    agentName: string
    startedAt: Date
    sessionId?: string
  }> {
    return () => {
      try {
        const machineDb = new MachineDB()
        try {
          const executions = machineDb.listExecutions({ status: 'running' })
          return executions.map(e => ({
            ticketId: e.ticketId,
            agentName: e.agentName,
            startedAt: e.startedAt,
            sessionId: e.sessionId,
          }))
        } finally {
          machineDb.close()
        }
      } catch {
        return []
      }
    }
  }

  /**
   * Spawn the reconciler as a tmux daemon session.
   *
   * Creates a detached tmux session running `prlt reconcile --watch --foreground`,
   * registers it in machine.db with ticketId='DAEMON' and agentName='daemon-reconciler',
   * and returns immediately.
   */
  private async spawnDaemon(
    flags: Record<string, unknown>,
    jsonMode: boolean,
  ): Promise<void> {
    const { execSync } = await import('node:child_process')
    const hqPath = this.hqPath ?? process.cwd()
    const hqName = getHeadquartersNameFromPath(hqPath)
    const sessionName = buildDaemonSessionName(hqName, 'reconciler')

    // Check if already running
    const hostSessions = getHostTmuxSessionNames()
    if (hostSessions.includes(sessionName)) {
      if (jsonMode) {
        outputSuccessAsJson(
          {
            status: 'already_running',
            sessionName,
            message: `Reconciler daemon is already running (session: ${sessionName})`,
          },
          createMetadata('reconcile', flags),
        )
        return
      }
      this.log(styles.success(`Reconciler daemon is already running (session: ${sessionName})`))
      this.log(styles.muted(`  Attach with: tmux attach -t ${sessionName}`))
      return
    }

    // Build the command that will run inside tmux
    const interval = flags.interval as number
    const dryRun = flags['dry-run'] as boolean
    const projectFlag = (flags as { project?: string }).project

    let cmd = `prlt reconcile --watch --foreground --interval ${interval}`
    if (dryRun) cmd += ' --dry-run'
    if (projectFlag) cmd += ` -P ${projectFlag}`
    const escalateFlag = flags['escalate-to'] as string | undefined
    if (escalateFlag) cmd += ` --escalate-to ${escalateFlag}`
    const cooldownFlag = flags.cooldown as number | undefined
    if (cooldownFlag !== undefined) cmd += ` --cooldown ${cooldownFlag}`

    // Spawn detached tmux session
    try {
      execSync(
        `tmux new-session -d -s "${sessionName}" -c "${hqPath}" "${cmd}"`,
        { stdio: 'pipe', timeout: 10000 },
      )
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      if (jsonMode) {
        outputSuccessAsJson(
          { status: 'error', error: `Failed to spawn tmux session: ${errMsg}` },
          createMetadata('reconcile', flags),
        )
        return
      }
      this.log(styles.error(`Failed to spawn reconciler daemon: ${errMsg}`))
      return
    }

    // Register in machine.db
    try {
      const machineDb = new MachineDB()
      try {
        const execution = machineDb.createExecution({
          prompt: cmd,
          repoPath: hqPath,
          agentName: 'daemon-reconciler',
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
      // Non-fatal: daemon is running even if machine.db registration fails
    }

    if (jsonMode) {
      outputSuccessAsJson(
        {
          status: 'started',
          sessionName,
          interval,
          dryRun: dryRun || false,
        },
        createMetadata('reconcile', flags),
      )
      return
    }

    this.log(styles.success(`Reconciler daemon started (session: ${sessionName})`))
    this.log(styles.muted(`  Interval: ${interval}s`))
    this.log(styles.muted(`  Attach with: tmux attach -t ${sessionName}`))
    this.log(styles.muted(`  Stop with: prlt session stop ${sessionName}`))
  }

  private printSummary(report: ReconcileReport, dryRun: boolean): void {
    const { checked, applied, skipped, failed, errors, escalated, cooledDown, escalationDryRun } = report
    const hasEscalation = escalated.length > 0 || cooledDown.length > 0 || escalationDryRun.length > 0

    if (applied.length === 0 && skipped.length === 0 && failed.length === 0 && !hasEscalation) {
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

    // Escalation summary (PRLT-1282)
    if (escalated.length > 0) {
      this.log(styles.warning(`  Escalated: ${escalated.length} issue(s) poked to orchestrator`))
      for (const e of escalated) {
        this.log(styles.muted(`    ${e.ticketId}: ${e.issueType} — ${e.summary}`))
      }
    }

    if (cooledDown.length > 0) {
      this.log(styles.muted(`  Cooldown: ${cooledDown.length} issue(s) skipped (recently poked)`))
    }

    if (escalationDryRun.length > 0) {
      this.log(styles.warning(`  Escalation (dry-run): ${escalationDryRun.length} issue(s) detected`))
      for (const e of escalationDryRun) {
        this.log(styles.muted(`    [dry-run] ${e.ticketId}: ${e.issueType} — ${e.summary}`))
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

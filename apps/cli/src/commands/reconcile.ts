/**
 * `prlt reconcile` — Tier 2 State Reconciler (PRLT-1280)
 *
 * Polls GitHub for the live state of each linked PR and fires normal
 * ticket transitions to fix board drift (e.g. "6 tickets stuck in Review
 * because someone merged via `gh pr merge` instead of `prlt work ship`").
 *
 * Design constraints from PRLT-1280:
 *   - Idempotent: a second run is a no-op when state is already correct.
 *   - Provider-agnostic: the command never branches on provider type;
 *     all state changes go through the provider adapter layer.
 *   - Scope is strictly the reconciliation function — no LLM, no daemon
 *     rewrite, no supervision tree.
 */

import { Flags } from '@oclif/core'
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

export default class Reconcile extends PMOCommand {
  static description =
    'Tier 2 state reconciler — poll GitHub for linked PRs and fix board drift'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --dry-run',
    '<%= config.bin %> <%= command.id %> --watch',
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
      description: 'Run on a timer until killed (default interval: 5 minutes)',
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
        // --watch in JSON mode doesn't make sense — there is no single
        // structured output to print. Fail fast so callers notice.
        this.error('--watch is not supported in JSON mode')
      }

      this.log(
        styles.muted(
          `Watching for drift every ${flags.interval}s (Ctrl+C to stop)${dryRun ? ' [dry-run]' : ''}...`,
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
          projectId: projectFlag,
          log: msg => this.log(msg),
          intervalMs: flags.interval * 1000,
          shouldStop: () => stop,
          onCycle: report => this.printSummary(report, dryRun),
        })
      } finally {
        process.removeListener('SIGINT', stopHandler)
        process.removeListener('SIGTERM', stopHandler)
      }
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

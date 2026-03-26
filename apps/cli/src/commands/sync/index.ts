import { Flags } from '@oclif/core'
import { PMOCommand, pmoBaseFlags } from '../../lib/pmo/index.js'
import type { ProviderStorage } from '../../lib/providers/types.js'
import { styles } from '../../lib/styles.js'
import { runSyncCycle } from '../../lib/sync/engine.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'

export default class Sync extends PMOCommand {
  static description = 'Reconcile ticket state with GitHub PR status'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --dry-run',
  ]

  static flags = {
    ...pmoBaseFlags,
    'dry-run': Flags.boolean({
      description: 'Show what would change without applying',
      default: false,
    }),
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(Sync)
    const db = this.requireDB()
    const projectId = await this.requireProject()
    const jsonMode = shouldOutputJson(flags)

    const report = await runSyncCycle(
      db,
      this.storage as unknown as import('../../lib/pmo/types.js').PMOStorage & ProviderStorage,
      projectId,
      {
        cwd: this.hqPath ?? process.cwd(),
        log: jsonMode ? undefined : (msg) => this.log(msg),
        dryRun: flags['dry-run'],
      },
    )

    if (jsonMode) {
      outputSuccessAsJson({
        checked: report.result.checked,
        actions: report.result.actions,
        applied: report.applied.length,
        failed: report.failed.length,
        errors: report.result.errors,
      }, createMetadata('sync', flags))
      return
    }

    // Summary
    const { result, applied, skipped, failed } = report

    if (result.actions.length === 0) {
      this.log(styles.muted('All tickets in sync — no changes needed.'))
      return
    }

    this.log('')
    this.log(styles.emphasis('Sync Summary:'))
    this.log(`  Checked: ${result.checked} ticket(s)`)

    if (applied.length > 0) {
      this.log(styles.success(`  Applied: ${applied.length} correction(s)`))
    }

    if (skipped.length > 0) {
      this.log(styles.warning(`  Skipped: ${skipped.length} (dry-run)`))
    }

    if (failed.length > 0) {
      this.log(styles.error(`  Failed: ${failed.length}`))
      for (const f of failed) {
        this.log(styles.error(`    ${f.action.ticketId}: ${f.error}`))
      }
    }

    if (result.errors.length > 0) {
      this.log(styles.error(`  Errors: ${result.errors.length}`))
      for (const e of result.errors) {
        this.log(styles.error(`    ${e.ticketId}: ${e.error}`))
      }
    }
  }
}

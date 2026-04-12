import { RuntimeCommand, runtimeBaseFlags } from '../../lib/runtime-command.js'
import { styles } from '../../lib/styles.js'
import {
  getMergeQueueState,
  buildMergeQueue,
  type _MergeQueueState,
} from '../../lib/sync/merge-queue.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'

export default class SyncQueue extends RuntimeCommand {
  static description = 'Show the merge queue state'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ]

  static flags = {
    ...runtimeBaseFlags,
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(SyncQueue)
    const hqPath = this.requireHQ()
    const jsonMode = shouldOutputJson(flags)
    const state = getMergeQueueState(hqPath)

    // Build current queue for display
    let queue: Array<{ prNumber: number; headBranch: string; ticketId: string | null; priority: number }> = []
    try {
      const entries = buildMergeQueue({ cwd: hqPath })
      queue = entries.map(e => ({
        prNumber: e.pr.number,
        headBranch: e.pr.headBranch,
        ticketId: e.ticketId,
        priority: e.priority,
      }))
    } catch {
      // Queue building may fail if gh is unavailable
    }

    if (jsonMode) {
      outputSuccessAsJson({
        ...state,
        queue,
      }, createMetadata('sync queue', flags))
      return
    }

    // Human output
    this.log('')
    this.log(styles.emphasis('Merge Queue'))
    this.log('')

    // Status line
    if (state.paused) {
      this.log(styles.warning(`  Status: PAUSED (since ${formatTime(state.pausedAt)})`))
    } else {
      this.log(styles.success('  Status: ACTIVE'))
    }

    if (state.lastCycleAt) {
      this.log(styles.muted(`  Last cycle: ${formatTime(state.lastCycleAt)}`))
    }

    // Current PR
    this.log('')
    if (state.currentPR) {
      this.log(styles.emphasis('  Processing:'))
      this.log(`    PR #${state.currentPR.prNumber} (${state.currentPR.headBranch})`)
      if (state.currentPR.ticketId) {
        this.log(`    Ticket: ${state.currentPR.ticketId}`)
      }
      this.log(`    Priority: P${state.currentPR.priority}`)
      this.log(`    Rebased: ${formatTime(state.currentPR.rebasedAt)}`)
    } else {
      this.log(styles.muted('  Processing: none'))
    }

    // Queue
    this.log('')
    if (queue.length > 0) {
      this.log(styles.emphasis(`  Queued (${queue.length}):`))
      for (const entry of queue) {
        const ticket = entry.ticketId ? ` [${entry.ticketId}]` : ''
        this.log(`    PR #${entry.prNumber}${ticket} — P${entry.priority} — ${entry.headBranch}`)
      }
    } else {
      this.log(styles.muted('  Queued: none'))
    }

    // Last merged
    if (state.lastMergedPR) {
      this.log('')
      this.log(styles.emphasis('  Last merged:'))
      this.log(styles.success(`    PR #${state.lastMergedPR.prNumber} (${state.lastMergedPR.headBranch}) at ${formatTime(state.lastMergedPR.mergedAt)}`))
    }

    // Ejected PRs
    if (state.ejectedPRs.length > 0) {
      this.log('')
      this.log(styles.emphasis(`  Ejected (${state.ejectedPRs.length}):`))
      for (const ej of state.ejectedPRs.slice(0, 5)) {
        this.log(styles.warning(`    PR #${ej.prNumber} (${ej.headBranch}) — ${ej.reason}`))
        this.log(styles.muted(`      at ${formatTime(ej.ejectedAt)}`))
      }
      if (state.ejectedPRs.length > 5) {
        this.log(styles.muted(`    ... and ${state.ejectedPRs.length - 5} more`))
      }
    }

    this.log('')
  }
}

function formatTime(iso: string | null): string {
  if (!iso) return 'unknown'
  const d = new Date(iso)
  return d.toLocaleString()
}

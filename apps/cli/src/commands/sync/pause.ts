import { RuntimeCommand, runtimeBaseFlags } from '../../lib/runtime-command.js'
import { styles } from '../../lib/styles.js'
import {
  isMergeQueuePaused,
  pauseMergeQueue,
} from '../../lib/sync/merge-queue.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'

export default class SyncPause extends RuntimeCommand {
  static description = 'Pause the merge queue (keep monitoring but stop merging)'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ]

  static flags = {
    ...runtimeBaseFlags,
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(SyncPause)
    const hqPath = this.requireHQ()
    const jsonMode = shouldOutputJson(flags)

    if (isMergeQueuePaused(hqPath)) {
      if (jsonMode) {
        outputErrorAsJson('ALREADY_PAUSED', 'Merge queue is already paused', createMetadata('sync pause', flags))
        return
      }
      this.log(styles.warning('Merge queue is already paused.'))
      return
    }

    const state = pauseMergeQueue(hqPath)

    if (jsonMode) {
      outputSuccessAsJson({ paused: true, pausedAt: state.pausedAt }, createMetadata('sync pause', flags))
      return
    }

    this.log(styles.success('Merge queue paused.'))
    this.log(styles.muted('The daemon will continue monitoring but will not merge PRs.'))
    this.log(styles.muted('Resume with: prlt sync resume'))
  }
}

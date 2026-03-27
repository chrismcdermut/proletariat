import { RuntimeCommand, runtimeBaseFlags } from '../../lib/runtime-command.js'
import { styles } from '../../lib/styles.js'
import {
  isMergeQueuePaused,
  resumeMergeQueue,
} from '../../lib/sync/merge-queue.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'

export default class SyncResume extends RuntimeCommand {
  static description = 'Resume the merge queue'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ]

  static flags = {
    ...runtimeBaseFlags,
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(SyncResume)
    const hqPath = this.requireHQ()
    const jsonMode = shouldOutputJson(flags)

    if (!isMergeQueuePaused(hqPath)) {
      if (jsonMode) {
        outputErrorAsJson('NOT_PAUSED', 'Merge queue is not paused', createMetadata('sync resume', flags))
        return
      }
      this.log(styles.warning('Merge queue is not paused.'))
      return
    }

    resumeMergeQueue(hqPath)

    if (jsonMode) {
      outputSuccessAsJson({ paused: false }, createMetadata('sync resume', flags))
      return
    }

    this.log(styles.success('Merge queue resumed.'))
    this.log(styles.muted('The daemon will process PRs on the next cycle.'))
  }
}

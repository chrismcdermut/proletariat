import { RuntimeCommand, runtimeBaseFlags } from '../../lib/runtime-command.js'
import { styles } from '../../lib/styles.js'
import { isDaemonRunning, getDaemonInfo, getDaemonLogPath } from '../../lib/sync/daemon.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'

export default class SyncStatus extends RuntimeCommand {
  static description = 'Check the board sync daemon status'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ]

  static flags = {
    ...runtimeBaseFlags,
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(SyncStatus)
    const hqPath = this.requireHQ()
    const jsonMode = shouldOutputJson(flags)
    const running = isDaemonRunning(hqPath)
    const info = running ? getDaemonInfo(hqPath) : null
    const logPath = getDaemonLogPath(hqPath)

    if (jsonMode) {
      outputSuccessAsJson({
        running,
        ...(info ?? {}),
        logPath,
      }, createMetadata('sync status', flags))
      return
    }

    if (!running) {
      this.log(styles.muted('Sync daemon is not running.'))
      this.log(styles.muted(`Start it with: prlt sync start`))
      return
    }

    this.log(styles.success('Sync daemon is running'))
    this.log(`  PID: ${info?.pid}`)
    this.log(`  Interval: every ${info?.intervalSeconds}s`)
    this.log(`  Started: ${info?.startedAt}`)
    this.log(`  Log: ${logPath}`)
  }
}

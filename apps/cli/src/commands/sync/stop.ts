import { RuntimeCommand, runtimeBaseFlags } from '../../lib/runtime-command.js'
import { styles } from '../../lib/styles.js'
import { isDaemonRunning, stopDaemon, getDaemonInfo } from '../../lib/sync/daemon.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'

export default class SyncStop extends RuntimeCommand {
  static description = 'Stop the board sync daemon'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ]

  static flags = {
    ...runtimeBaseFlags,
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(SyncStop)
    const hqPath = this.requireHQ()
    const jsonMode = shouldOutputJson(flags)

    if (!isDaemonRunning(hqPath)) {
      if (jsonMode) {
        outputErrorAsJson('NOT_RUNNING', 'No sync daemon is running', createMetadata('sync stop', flags))
        return
      }
      this.log(styles.muted('No sync daemon is running.'))
      return
    }

    const info = getDaemonInfo(hqPath)
    const stopped = stopDaemon(hqPath)

    if (jsonMode) {
      outputSuccessAsJson({ stopped, pid: info?.pid }, createMetadata('sync stop', flags))
      return
    }

    if (stopped) {
      this.log(styles.success(`Sync daemon stopped (PID ${info?.pid})`))
    } else {
      this.log(styles.warning('Daemon process not found — cleaned up PID file.'))
    }
  }
}

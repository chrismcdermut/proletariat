import { Command } from '@oclif/core'
import { styles } from '../../lib/styles.js'
import { shouldOutputJson } from '../../lib/prompt-json.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import { isMacOS, stopCaffeinate, getStatus } from '../../lib/caffeinate.js'

export default class CaffeinateStop extends Command {
  static description = 'Stop the managed caffeinate process'

  static examples = [
    '<%= config.bin %> caffeinate stop',
  ]

  static flags = {
    ...machineOutputFlags,
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(CaffeinateStop)
    const jsonMode = shouldOutputJson(flags)

    if (!isMacOS()) {
      if (jsonMode) {
        this.log(JSON.stringify({
          type: 'error',
          error: { code: 'UNSUPPORTED_PLATFORM', message: `caffeinate is only supported on macOS (current platform: ${process.platform})` },
        }, null, 2))
        this.exit(1)
      }
      this.error(`caffeinate is only supported on macOS (current platform: ${process.platform})`)
    }

    // Get current state for reporting
    const { state } = getStatus()
    const stopped = stopCaffeinate()

    if (jsonMode) {
      this.log(JSON.stringify({
        type: 'success',
        result: {
          stopped,
          pid: state?.pid ?? null,
        },
      }, null, 2))
      return
    }

    if (stopped) {
      this.log(`\n${styles.success('caffeinate stopped')} ${styles.muted(`(PID: ${state?.pid})`)}\n`)
    } else {
      this.log(`\n${styles.muted('caffeinate is not running')}\n`)
    }
  }
}

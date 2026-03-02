import { Command } from '@oclif/core'
import { styles } from '../../lib/styles.js'
import { shouldOutputJson } from '../../lib/prompt-json.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import { isMacOS, getStatus } from '../../lib/caffeinate.js'

export default class CaffeinateStatus extends Command {
  static description = 'Check if caffeinate is running'

  static examples = [
    '<%= config.bin %> caffeinate status',
  ]

  static flags = {
    ...machineOutputFlags,
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(CaffeinateStatus)
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

    const { running, state } = getStatus()

    if (jsonMode) {
      this.log(JSON.stringify({
        type: 'success',
        result: {
          running,
          ...(state ? { pid: state.pid, startedAt: state.startedAt, flags: state.flags, duration: state.duration ?? null } : {}),
        },
      }, null, 2))
      return
    }

    this.log(`\n${styles.header('Caffeinate Status')}`)
    this.log('─'.repeat(40))

    if (running && state) {
      this.log(`${styles.success('Running')} ${styles.muted(`(PID: ${state.pid})`)}`)
      this.log(styles.muted(`  Started: ${state.startedAt}`))
      if (state.flags.length > 0) {
        this.log(styles.muted(`  Flags:   ${state.flags.join(' ')}`))
      }
      if (state.duration) {
        this.log(styles.muted(`  Duration: ${state.duration}s`))
      }
    } else {
      this.log(styles.muted('Not running'))
    }
    this.log('')
  }
}

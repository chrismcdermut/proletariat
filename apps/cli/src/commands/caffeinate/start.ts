import { Command, Flags } from '@oclif/core'
import { styles } from '../../lib/styles.js'
import { shouldOutputJson } from '../../lib/prompt-json.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import { isMacOS, startCaffeinate, getStatus } from '../../lib/caffeinate.js'

export default class CaffeinateStart extends Command {
  static description = 'Start caffeinate to prevent macOS from sleeping'

  static examples = [
    '<%= config.bin %> caffeinate start',
    '<%= config.bin %> caffeinate start --duration 3600',
    '<%= config.bin %> caffeinate start --display',
  ]

  static flags = {
    ...machineOutputFlags,
    duration: Flags.integer({
      char: 't',
      description: 'Duration in seconds (default: indefinite)',
    }),
    display: Flags.boolean({
      char: 'd',
      description: 'Prevent display from sleeping (adds -d flag)',
      default: false,
    }),
    idle: Flags.boolean({
      char: 'i',
      description: 'Prevent idle sleep (adds -i flag)',
      default: false,
    }),
    system: Flags.boolean({
      char: 's',
      description: 'Prevent system sleep (adds -s flag)',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(CaffeinateStart)
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

    // Build caffeinate flags
    const caffeinateFlags: string[] = []
    if (flags.display) caffeinateFlags.push('-d')
    if (flags.idle) caffeinateFlags.push('-i')
    if (flags.system) caffeinateFlags.push('-s')

    // Check if already running (idempotent)
    const { running, state: existingState } = getStatus()
    if (running && existingState) {
      if (jsonMode) {
        this.log(JSON.stringify({
          type: 'success',
          result: { ...existingState, status: 'already_running' },
        }, null, 2))
        return
      }
      this.log(`\n${styles.warning('caffeinate is already running')} ${styles.muted(`(PID: ${existingState.pid})`)}\n`)
      return
    }

    const state = startCaffeinate(caffeinateFlags, flags.duration)

    if (jsonMode) {
      this.log(JSON.stringify({
        type: 'success',
        result: { ...state, status: 'started' },
      }, null, 2))
      return
    }

    this.log(`\n${styles.success('caffeinate started')} ${styles.muted(`(PID: ${state.pid})`)}`)
    if (state.duration) {
      this.log(styles.muted(`  Duration: ${state.duration}s`))
    }
    if (state.flags.length > 0) {
      this.log(styles.muted(`  Flags: ${state.flags.join(' ')}`))
    }
    this.log('')
  }
}

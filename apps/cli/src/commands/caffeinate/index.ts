import { Command } from '@oclif/core'
import { styles } from '../../lib/styles.js'
import { shouldOutputJson } from '../../lib/prompt-json.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import { FlagResolver } from '../../lib/flags/index.js'
import { isMacOS } from '../../lib/caffeinate.js'

export default class Caffeinate extends Command {
  static description = 'Manage caffeinate to keep macOS awake'

  static examples = [
    '<%= config.bin %> caffeinate',
    '<%= config.bin %> caffeinate start',
    '<%= config.bin %> caffeinate status',
    '<%= config.bin %> caffeinate stop',
    '<%= config.bin %> caffeinate start --duration 3600',
    '<%= config.bin %> caffeinate start --display',
  ]

  static flags = {
    ...machineOutputFlags,
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Caffeinate)
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

    const menuChoices = [
      { name: 'Check caffeinate status', value: 'status', command: 'prlt caffeinate status --json' },
      { name: 'Start caffeinate', value: 'start', command: 'prlt caffeinate start --json' },
      { name: 'Stop caffeinate', value: 'stop', command: 'prlt caffeinate stop --json' },
      { name: 'Exit', value: 'exit', command: 'prlt caffeinate --exit' },
    ]

    const resolver = new FlagResolver<{ action?: string; machine?: boolean; json?: boolean }>({
      commandName: 'caffeinate',
      baseCommand: 'prlt caffeinate',
      jsonMode,
      flags,
    })

    resolver.addPrompt({
      flagName: 'action',
      type: 'list',
      message: 'What would you like to do?',
      choices: () => menuChoices,
      skipAutoCommand: true,
    })

    if (!jsonMode) {
      this.log('')
      this.log(styles.header('Caffeinate'))
      this.log('')
    }

    const resolved = await resolver.resolve()
    const action = resolved.action

    if (!action || action === 'exit') {
      return
    }

    await this.config.runCommand(`caffeinate:${action}`, [])
  }
}

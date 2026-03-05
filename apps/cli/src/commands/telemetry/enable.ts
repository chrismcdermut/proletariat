import { Command } from '@oclif/core'
import { writeTelemetryConfig } from '../../lib/telemetry.js'
import { colors } from '../../lib/colors.js'
import { shouldOutputJson } from '../../lib/prompt-json.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'

export default class TelemetryEnable extends Command {
  static description = 'Enable anonymous crash reporting'

  static examples = [
    '<%= config.bin %> telemetry enable',
  ]

  static flags = {
    ...machineOutputFlags,
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(TelemetryEnable)
    const jsonMode = shouldOutputJson(flags)

    writeTelemetryConfig({ enabled: true })

    if (jsonMode) {
      this.log(JSON.stringify({ telemetry: 'enabled' }))
      return
    }

    this.log('')
    this.log(colors.success('Telemetry enabled.'))
    this.log(colors.textMuted('Anonymous crash reports will be sent to help improve the CLI.'))
    this.log('')
  }
}

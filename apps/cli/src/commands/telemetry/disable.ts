import { Command } from '@oclif/core'
import { writeTelemetryConfig } from '../../lib/telemetry.js'
import { colors } from '../../lib/colors.js'
import { shouldOutputJson } from '../../lib/prompt-json.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'

export default class TelemetryDisable extends Command {
  static description = 'Disable anonymous crash reporting'

  static examples = [
    '<%= config.bin %> telemetry disable',
  ]

  static flags = {
    ...machineOutputFlags,
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(TelemetryDisable)
    const jsonMode = shouldOutputJson(flags)

    writeTelemetryConfig({ enabled: false })

    if (jsonMode) {
      this.log(JSON.stringify({ telemetry: 'disabled' }))
      return
    }

    this.log('')
    this.log(colors.success('Telemetry disabled.'))
    this.log(colors.textMuted('No crash reports will be sent.'))
    this.log('')
  }
}

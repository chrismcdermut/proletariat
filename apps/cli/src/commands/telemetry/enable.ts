import { Command } from '@oclif/core'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import { shouldOutputJson, outputSuccessAsJson, createMetadata } from '../../lib/prompt-json.js'
import { enableTelemetry } from '../../lib/telemetry/analytics.js'
import { writeTelemetryConfig } from '../../lib/telemetry.js'
import { styles } from '../../lib/styles.js'

export default class TelemetryEnable extends Command {
  static description = 'Enable anonymous telemetry'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ]

  static flags = {
    ...machineOutputFlags,
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(TelemetryEnable)
    const jsonMode = shouldOutputJson(flags)

    // Enable PostHog analytics and Sentry crash reporting
    enableTelemetry()
    writeTelemetryConfig({ enabled: true })

    if (jsonMode) {
      outputSuccessAsJson({ enabled: true }, createMetadata('telemetry enable', flags))
      return
    }

    this.log(styles.success('Telemetry enabled. Thank you for helping improve prlt!'))
  }
}

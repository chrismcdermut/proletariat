import { Command } from '@oclif/core'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import { shouldOutputJson, outputSuccessAsJson, createMetadata } from '../../lib/prompt-json.js'
import { disableTelemetry } from '../../lib/telemetry/analytics.js'
import { writeTelemetryConfig } from '../../lib/telemetry.js'
import { styles } from '../../lib/styles.js'

export default class TelemetryDisable extends Command {
  static description = 'Disable anonymous telemetry'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
  ]

  static flags = {
    ...machineOutputFlags,
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(TelemetryDisable)
    const jsonMode = shouldOutputJson(flags)

    // Disable both Statsig analytics and Sentry crash reporting
    disableTelemetry()
    writeTelemetryConfig({ enabled: false })

    if (jsonMode) {
      outputSuccessAsJson({ enabled: false }, createMetadata('telemetry disable', flags))
      return
    }

    this.log(styles.success('Telemetry disabled. No data will be collected.'))
  }
}

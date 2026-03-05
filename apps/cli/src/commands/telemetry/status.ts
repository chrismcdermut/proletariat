import { Command } from '@oclif/core'
import { isTelemetryEnabled } from '../../lib/telemetry.js'
import { colors } from '../../lib/colors.js'
import { shouldOutputJson } from '../../lib/prompt-json.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'

export default class TelemetryStatus extends Command {
  static description = 'Show telemetry status'

  static examples = [
    '<%= config.bin %> telemetry status',
  ]

  static flags = {
    ...machineOutputFlags,
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(TelemetryStatus)
    const jsonMode = shouldOutputJson(flags)
    const enabled = isTelemetryEnabled()

    if (jsonMode) {
      this.log(JSON.stringify({
        telemetry: enabled ? 'enabled' : 'disabled',
        envOverrides: {
          DO_NOT_TRACK: process.env.DO_NOT_TRACK === '1',
          PRLT_TELEMETRY_DISABLED: process.env.PRLT_TELEMETRY_DISABLED === '1',
        },
      }))
      return
    }

    this.log('')
    this.log(colors.primary('Telemetry Status'))
    this.log('')
    this.log(`  Status: ${enabled ? colors.success('enabled') : colors.error('disabled')}`)

    // Show env var overrides if relevant
    if (process.env.DO_NOT_TRACK === '1') {
      this.log(`  ${colors.warning('DO_NOT_TRACK=1 is set (telemetry disabled by environment)')}`)
    }

    if (process.env.PRLT_TELEMETRY_DISABLED === '1') {
      this.log(`  ${colors.warning('PRLT_TELEMETRY_DISABLED=1 is set (telemetry disabled by environment)')}`)
    }

    this.log('')
  }
}

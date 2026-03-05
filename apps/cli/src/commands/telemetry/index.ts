import { Command } from '@oclif/core'
import { isTelemetryEnabled } from '../../lib/telemetry.js'
import { colors } from '../../lib/colors.js'

export default class Telemetry extends Command {
  static description = 'Manage anonymous crash reporting telemetry'

  static examples = [
    '<%= config.bin %> telemetry status',
    '<%= config.bin %> telemetry enable',
    '<%= config.bin %> telemetry disable',
  ]

  async run(): Promise<void> {
    const enabled = isTelemetryEnabled()

    this.log('')
    this.log(colors.primary('Telemetry'))
    this.log('')
    this.log(`  Status: ${enabled ? colors.success('enabled') : colors.error('disabled')}`)
    this.log('')
    this.log('  Proletariat collects anonymous crash reports to improve the CLI.')
    this.log('  No personal data is collected.')
    this.log('')
    this.log(`  ${colors.textMuted('prlt telemetry enable')}   Enable crash reporting`)
    this.log(`  ${colors.textMuted('prlt telemetry disable')}  Disable crash reporting`)
    this.log(`  ${colors.textMuted('prlt telemetry status')}   Show current status`)
    this.log('')
  }
}

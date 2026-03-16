import { Command } from '@oclif/core'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import { shouldOutputJson, outputSuccessAsJson, createMetadata } from '../../lib/prompt-json.js'
import { getTelemetryStatus } from '../../lib/telemetry/analytics.js'
import { styles } from '../../lib/styles.js'

export default class Telemetry extends Command {
  static description = 'Show telemetry status'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --json',
  ]

  static flags = {
    ...machineOutputFlags,
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Telemetry)
    const jsonMode = shouldOutputJson(flags)
    const status = getTelemetryStatus()

    if (jsonMode) {
      outputSuccessAsJson({
        enabled: status.enabled,
        machineId: status.machineId,
        envOverride: status.envOverride,
        envVar: status.envVar ?? null,
      }, createMetadata('telemetry', flags))
      return
    }

    this.log('')
    this.log(styles.header('Telemetry Status'))
    this.log('')
    this.log(`  Status:     ${status.enabled ? styles.success('enabled') : styles.error('disabled')}`)
    this.log(`  Machine ID: ${styles.muted(status.machineId)}`)
    if (status.envOverride) {
      this.log(`  Override:   ${styles.warning(`Disabled via ${status.envVar} env var`)}`)
    }
    this.log('')
    this.log(styles.muted('  Telemetry helps us improve prlt. No PII is ever collected.'))
    this.log(styles.muted('  Run "prlt telemetry disable" to opt out.'))
    this.log('')
  }
}

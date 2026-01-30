import { Command, Flags } from '@oclif/core'
import inquirer from 'inquirer'
import { styles } from '../../lib/styles.js'
import {
  isErrorTrackingEnabled,
  setErrorTracking,
  DATA_DISCLOSURE,
  isNonInteractive,
} from '../../lib/telemetry/sentry.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputPromptAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js'

export default class ConfigTelemetry extends Command {
  static description = 'Configure anonymous error tracking (opt-in)'

  static examples = [
    '<%= config.bin %> <%= command.id %>              # Interactive configuration',
    '<%= config.bin %> <%= command.id %> --enable     # Enable error tracking',
    '<%= config.bin %> <%= command.id %> --disable    # Disable error tracking',
    '<%= config.bin %> <%= command.id %> --status     # Check current status',
  ]

  static flags = {
    enable: Flags.boolean({
      description: 'Enable anonymous error tracking',
      exclusive: ['disable'],
    }),
    disable: Flags.boolean({
      description: 'Disable anonymous error tracking',
      exclusive: ['enable'],
    }),
    status: Flags.boolean({
      description: 'Show current telemetry status',
    }),
    json: Flags.boolean({
      description: 'Output as JSON (for AI agents/scripts)',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(ConfigTelemetry)
    const jsonMode = shouldOutputJson(flags)

    // Handle --status flag
    if (flags.status) {
      const enabled = isErrorTrackingEnabled()
      if (jsonMode) {
        outputSuccessAsJson({
          telemetry: {
            errorTracking: enabled,
          },
        }, createMetadata('config telemetry', flags))
      } else {
        this.log('')
        this.log(styles.header('Telemetry Status'))
        this.log('─'.repeat(50))
        this.log(`Error Tracking: ${enabled ? styles.success('Enabled') : styles.muted('Disabled')}`)
        this.log('')
        if (!enabled) {
          this.log(styles.muted('Run "prlt config telemetry --enable" to opt in'))
        }
        this.log('')
      }
      return
    }

    // Handle --enable flag
    if (flags.enable) {
      setErrorTracking(true)
      if (jsonMode) {
        outputSuccessAsJson({
          telemetry: { errorTracking: true },
          message: 'Error tracking enabled',
        }, createMetadata('config telemetry', flags))
      } else {
        this.log(styles.success('Error tracking enabled'))
        this.log(styles.muted('Anonymous error reports will help improve stability.'))
      }
      return
    }

    // Handle --disable flag
    if (flags.disable) {
      setErrorTracking(false)
      if (jsonMode) {
        outputSuccessAsJson({
          telemetry: { errorTracking: false },
          message: 'Error tracking disabled',
        }, createMetadata('config telemetry', flags))
      } else {
        this.log(styles.success('Error tracking disabled'))
        this.log(styles.muted('No error reports will be sent.'))
      }
      return
    }

    // Interactive mode
    const currentStatus = isErrorTrackingEnabled()

    // Show data disclosure
    this.log('')
    this.log(styles.header('Anonymous Error Tracking'))
    this.log('═'.repeat(60))
    this.log('')
    this.log(DATA_DISCLOSURE)
    this.log('')
    this.log('═'.repeat(60))
    this.log('')

    const choices = [
      {
        name: `Enable - Help improve Proletariat CLI with anonymous error reports`,
        value: true,
      },
      {
        name: `Disable - Do not send any error reports`,
        value: false,
      },
    ]
    const message = `Enable anonymous error tracking? (currently ${currentStatus ? 'enabled' : 'disabled'})`

    // JSON mode - output prompt config
    if (jsonMode) {
      outputPromptAsJson(
        buildPromptConfig('list', 'enabled', message, choices),
        createMetadata('config telemetry', flags)
      )
      return
    }

    // Check for non-interactive environment
    if (isNonInteractive()) {
      this.log(styles.muted('Non-interactive environment detected.'))
      this.log(styles.muted('Use --enable or --disable flags to configure telemetry.'))
      return
    }

    // Prompt for selection
    const { enabled } = await inquirer.prompt([
      {
        type: 'list',
        name: 'enabled',
        message,
        choices,
        default: currentStatus,
      },
    ])

    setErrorTracking(enabled)

    this.log('')
    if (enabled) {
      this.log(styles.success('Error tracking enabled'))
      this.log(styles.muted('Thank you for helping improve Proletariat CLI!'))
    } else {
      this.log(styles.success('Error tracking disabled'))
      this.log(styles.muted('No error reports will be sent.'))
    }
    this.log('')
  }
}

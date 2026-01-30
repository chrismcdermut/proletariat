import { Flags, Command } from '@oclif/core'
import inquirer from 'inquirer'
import { styles } from '../../lib/styles.js'
import {
  getTelemetryConfig,
  setErrorTracking,
  isErrorTrackingEnabled,
} from '../../lib/machine-config.js'
import {
  shouldOutputJson,
  outputPromptAsJson,
  outputSuccessAsJson,
  createMetadata,
  buildPromptConfig,
} from '../../lib/prompt-json.js'

export default class TelemetryConfig extends Command {
  static description = 'View and configure error tracking telemetry settings'

  static examples = [
    '<%= config.bin %> <%= command.id %>                           # Interactive menu',
    '<%= config.bin %> <%= command.id %> --json                    # Show current setting as JSON',
    '<%= config.bin %> <%= command.id %> --set errorTracking true  # Enable error tracking',
    '<%= config.bin %> <%= command.id %> --set errorTracking false # Disable error tracking',
  ]

  static flags = {
    json: Flags.boolean({
      description: 'Output configuration as JSON (for AI agents/scripts)',
      default: false,
    }),
    set: Flags.string({
      char: 's',
      description: 'Set a telemetry value (format: key value)',
      multiple: true,
    }),
    list: Flags.boolean({
      char: 'l',
      description: 'List all telemetry configuration values',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(TelemetryConfig)
    const jsonMode = shouldOutputJson(flags)

    // Handle --set flag
    if (flags.set && flags.set.length > 0) {
      for (const setValue of flags.set) {
        const [key, ...valueParts] = setValue.split(' ')
        const value = valueParts.join(' ')

        if (!key || !value) {
          if (jsonMode) {
            outputSuccessAsJson(
              { error: `Invalid format: "${setValue}". Use: --set "key value"` },
              createMetadata('config telemetry', flags)
            )
          } else {
            this.error(`Invalid format: "${setValue}". Use: --set "key value"`)
          }
          continue
        }

        this.setTelemetryValue(key, value, jsonMode, flags)
      }
      return
    }

    // Get current telemetry config
    const telemetryConfig = getTelemetryConfig()

    // Handle --list or --json flag (just show config)
    if (flags.list || flags.json) {
      if (jsonMode) {
        outputSuccessAsJson({
          errorTracking: telemetryConfig.errorTracking,
          hasPromptedForConsent: telemetryConfig.hasPromptedForConsent,
          consentTimestamp: telemetryConfig.consentTimestamp || null,
        }, createMetadata('config telemetry', flags))
      } else {
        this.log('')
        this.log(styles.header('Telemetry Configuration'))
        this.log('═'.repeat(50))
        this.log('')
        this.log(styles.emphasis('Error Tracking'))
        this.log(`  enabled:            ${telemetryConfig.errorTracking ? styles.success('true') : styles.muted('false')}`)
        this.log(`  hasPromptedConsent: ${telemetryConfig.hasPromptedForConsent}`)
        if (telemetryConfig.consentTimestamp) {
          this.log(`  consentTimestamp:   ${telemetryConfig.consentTimestamp}`)
        }
        this.log('')
        this.log(styles.muted('Data Collection Policy:'))
        this.log(styles.muted('  When enabled, error reports include:'))
        this.log(styles.muted('    • Command name and execution mode'))
        this.log(styles.muted('    • CLI version, Node.js version, OS'))
        this.log(styles.muted('    • Sanitized error messages and stack traces'))
        this.log('')
        this.log(styles.muted('  We NEVER collect:'))
        this.log(styles.muted('    • File paths, repository names, or workspace paths'))
        this.log(styles.muted('    • Ticket content or user-generated text'))
        this.log(styles.muted('    • Environment variables or secrets'))
        this.log('')
      }
      return
    }

    // Interactive menu
    const currentStatus = telemetryConfig.errorTracking ? 'enabled' : 'disabled'
    const settingChoices = [
      {
        name: `Error Tracking: ${telemetryConfig.errorTracking ? styles.success('enabled') : styles.muted('disabled')}`,
        value: 'errorTracking',
        command: `prlt config telemetry --set errorTracking ${!telemetryConfig.errorTracking}`
      },
    ]
    const settingMessage = `Select setting to configure (currently ${currentStatus}):`

    if (jsonMode) {
      outputPromptAsJson(
        buildPromptConfig('list', 'setting', settingMessage, settingChoices),
        createMetadata('config telemetry', flags)
      )
      return
    }

    const { setting } = await inquirer.prompt([
      {
        type: 'list',
        name: 'setting',
        message: settingMessage,
        choices: [
          new inquirer.Separator('── Telemetry ──'),
          ...settingChoices,
          new inquirer.Separator(),
          { name: 'Exit', value: '__exit__' },
        ],
      },
    ])

    if (setting === '__exit__') {
      return
    }

    // Handle setting change
    if (setting === 'errorTracking') {
      const trackingChoices = [
        { name: 'Yes - Enable anonymous error tracking (help improve prlt)', value: true },
        { name: 'No - Disable error tracking', value: false },
      ]
      const { enableTracking } = await inquirer.prompt([
        {
          type: 'list',
          name: 'enableTracking',
          message: 'Enable error tracking?',
          choices: trackingChoices,
          default: telemetryConfig.errorTracking,
        },
      ])
      setErrorTracking(enableTracking)
      if (enableTracking) {
        this.log(styles.success('Error tracking enabled. Thank you for helping improve prlt!'))
      } else {
        this.log(styles.success('Error tracking disabled.'))
      }
    }
  }

  private setTelemetryValue(key: string, value: string, jsonMode: boolean, flags: Record<string, unknown>): void {
    const normalizedKey = key.toLowerCase()

    switch (normalizedKey) {
      case 'errortracking':
        {
          const enabled = value.toLowerCase() === 'true'
          setErrorTracking(enabled)
          if (jsonMode) {
            outputSuccessAsJson({ key: 'errorTracking', value: enabled }, createMetadata('config telemetry', flags))
          } else {
            this.log(styles.success(`Error tracking ${enabled ? 'enabled' : 'disabled'}`))
          }
        }
        break
      default:
        if (jsonMode) {
          outputSuccessAsJson(
            { error: `Unknown telemetry key: ${key}. Valid keys: errorTracking` },
            createMetadata('config telemetry', flags)
          )
        } else {
          this.warn(`Unknown telemetry key: ${key}. Valid keys: errorTracking`)
        }
    }
  }
}

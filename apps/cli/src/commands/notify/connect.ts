/**
 * prlt notify connect — Connect a notification provider.
 *
 * Configures a notification channel (Slack, Email, SMS, etc.)
 * and stores it in the workspace database.
 *
 * Examples:
 *   prlt notify connect slack --webhook-url https://hooks.slack.com/...
 *   prlt notify connect email --provider sendgrid --api-key sk-... --from alerts@example.com --to team@example.com
 *   prlt notify connect sms --account-sid AC... --auth-token ... --from +1234567890 --to +0987654321
 */

import { Args, Flags } from '@oclif/core'
import { RuntimeCommand, machineOutputFlags } from '../../lib/runtime-command.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'
import { styles } from '../../lib/styles.js'
import { NotificationStorage, NOTIFICATION_PROVIDER_TYPES, type NotificationProviderType, type ProviderConfig } from '../../lib/notifications/index.js'

export default class NotifyConnect extends RuntimeCommand {
  static description = 'Connect a notification provider (Slack, Email, SMS, etc.)'

  static examples = [
    '<%= config.bin %> notify connect slack --webhook-url https://hooks.slack.com/...',
    '<%= config.bin %> notify connect email --provider sendgrid --api-key sk-... --from alerts@co.com --to team@co.com',
    '<%= config.bin %> notify connect sms --account-sid AC... --auth-token ... --from +1234567890 --to +0987654321',
    '<%= config.bin %> notify connect terminal',
    '<%= config.bin %> notify connect slack --name my-slack --webhook-url https://...',
  ]

  static args = {
    type: Args.string({
      description: 'Provider type',
      required: true,
      options: NOTIFICATION_PROVIDER_TYPES,
    }),
  }

  static flags = {
    ...machineOutputFlags,
    name: Flags.string({
      description: 'Provider name (defaults to type)',
    }),
    // Slack
    'webhook-url': Flags.string({
      description: 'Slack webhook URL',
    }),
    channel: Flags.string({
      description: 'Slack channel override',
    }),
    username: Flags.string({
      description: 'Slack username override',
    }),
    // Email
    provider: Flags.string({
      description: 'Email provider (sendgrid or ses)',
      options: ['sendgrid', 'ses'],
    }),
    'api-key': Flags.string({
      description: 'API key for email/SMS provider',
    }),
    from: Flags.string({
      description: 'Sender address (email or phone)',
    }),
    to: Flags.string({
      description: 'Recipient(s), comma-separated',
      multiple: true,
    }),
    // SMS
    'account-sid': Flags.string({
      description: 'Twilio account SID',
    }),
    'auth-token': Flags.string({
      description: 'Twilio auth token',
    }),
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(NotifyConnect)
    const jsonMode = shouldOutputJson(flags)
    const db = this.requireDB()
    const providerType = args.type as NotificationProviderType
    const providerName = flags.name || providerType

    // Build config based on type
    let config: ProviderConfig

    switch (providerType) {
      case 'slack': {
        if (!flags['webhook-url']) {
          if (jsonMode) {
            outputErrorAsJson('MISSING_WEBHOOK_URL', 'Slack requires --webhook-url', createMetadata('notify connect', flags))
            return
          }
          this.error('Slack requires --webhook-url')
        }
        config = {
          webhook_url: flags['webhook-url']!,
          ...(flags.channel ? { channel: flags.channel } : {}),
          ...(flags.username ? { username: flags.username } : {}),
        }
        break
      }

      case 'email': {
        if (!flags['api-key'] || !flags.from || !flags.to?.length) {
          if (jsonMode) {
            outputErrorAsJson('MISSING_EMAIL_CONFIG', 'Email requires --api-key, --from, and --to', createMetadata('notify connect', flags))
            return
          }
          this.error('Email requires --api-key, --from, and --to')
        }
        config = {
          provider: (flags.provider as 'sendgrid' | 'ses') || 'sendgrid',
          api_key: flags['api-key']!,
          from: flags.from!,
          to: flags.to!,
        }
        break
      }

      case 'sms': {
        if (!flags['account-sid'] || !flags['auth-token'] || !flags.from || !flags.to?.length) {
          if (jsonMode) {
            outputErrorAsJson('MISSING_SMS_CONFIG', 'SMS requires --account-sid, --auth-token, --from, and --to', createMetadata('notify connect', flags))
            return
          }
          this.error('SMS requires --account-sid, --auth-token, --from, and --to')
        }
        config = {
          account_sid: flags['account-sid']!,
          auth_token: flags['auth-token']!,
          from: flags.from!,
          to: flags.to!,
        }
        break
      }

      case 'terminal': {
        config = {}
        break
      }

      case 'browser_push': {
        config = {}
        break
      }

      default: {
        if (jsonMode) {
          outputErrorAsJson('INVALID_TYPE', `Unknown provider type: ${providerType}`, createMetadata('notify connect', flags))
          return
        }
        this.error(`Unknown provider type: ${providerType}`)
      }
    }

    const storage = new NotificationStorage(db)

    // Check for existing provider with same name
    const existing = storage.getProviderByName(providerName)
    if (existing) {
      // Update existing provider
      storage.updateProvider(existing.id, { config, enabled: true })

      if (jsonMode) {
        outputSuccessAsJson(
          { provider: { ...existing, config, enabled: true }, updated: true },
          createMetadata('notify connect', flags),
        )
        return
      }

      this.log(styles.success(`Updated notification provider "${providerName}" (${providerType})`))
      return
    }

    // Create new provider
    const provider = storage.createProvider({ type: providerType, name: providerName, config })

    if (jsonMode) {
      outputSuccessAsJson(
        { provider: { id: provider.id, type: provider.type, name: provider.name, enabled: provider.enabled }, created: true },
        createMetadata('notify connect', flags),
      )
      return
    }

    this.log(styles.success(`Connected notification provider "${providerName}" (${providerType})`))
    this.log(styles.muted(`  Test it with: prlt notify test ${providerName}`))
  }
}

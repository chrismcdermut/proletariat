/**
 * prlt notify list — List configured notification providers and rules.
 */

import { Flags } from '@oclif/core'
import { RuntimeCommand, machineOutputFlags } from '../../lib/runtime-command.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'
import { styles } from '../../lib/styles.js'
import { NotificationStorage } from '../../lib/notifications/index.js'

export default class NotifyList extends RuntimeCommand {
  static description = 'List configured notification providers and rules'

  static examples = [
    '<%= config.bin %> notify list',
    '<%= config.bin %> notify list --rules',
    '<%= config.bin %> notify list --type slack',
  ]

  static flags = {
    ...machineOutputFlags,
    type: Flags.string({
      description: 'Filter providers by type',
      options: ['slack', 'email', 'sms', 'terminal', 'browser_push'],
    }),
    rules: Flags.boolean({
      description: 'Also show notification rules',
      default: false,
    }),
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(NotifyList)
    const jsonMode = shouldOutputJson(flags)
    const db = this.requireDB()
    const storage = new NotificationStorage(db)

    const providers = storage.listProviders({
      type: flags.type as 'slack' | 'email' | 'sms' | 'terminal' | 'browser_push' | undefined,
    })

    const rules = flags.rules ? storage.listRules() : []

    if (jsonMode) {
      outputSuccessAsJson(
        {
          providers: providers.map(p => ({
            id: p.id,
            type: p.type,
            name: p.name,
            enabled: p.enabled,
            createdAt: p.createdAt,
          })),
          ...(flags.rules ? {
            rules: rules.map(r => ({
              id: r.id,
              event: r.event,
              providerId: r.providerId,
              priority: r.priority,
              escalationDelaySeconds: r.escalationDelaySeconds,
              escalationGroup: r.escalationGroup,
              enabled: r.enabled,
            })),
          } : {}),
          count: providers.length,
        },
        createMetadata('notify list', flags),
      )
      return
    }

    if (providers.length === 0) {
      this.log(styles.info('No notification providers configured.'))
      this.log(styles.muted('  Connect one with: prlt notify connect slack --webhook-url ...'))
      return
    }

    this.log(styles.title('Notification Providers'))
    this.log('')

    for (const provider of providers) {
      const status = provider.enabled ? styles.success('enabled') : styles.muted('disabled')
      this.log(`  ${styles.emphasis(provider.name)} ${styles.muted(`(${provider.type})`)} ${status}`)
    }

    if (flags.rules && rules.length > 0) {
      this.log('')
      this.log(styles.title('Notification Rules'))
      this.log('')

      // Group by event
      const grouped: Record<string, typeof rules> = {}
      for (const rule of rules) {
        if (!grouped[rule.event]) grouped[rule.event] = []
        grouped[rule.event].push(rule)
      }

      for (const [event, eventRules] of Object.entries(grouped)) {
        this.log(`  ${styles.emphasis(event)}`)
        for (const rule of eventRules) {
          const provider = providers.find(p => p.id === rule.providerId)
          const providerLabel = provider ? `${provider.name} (${provider.type})` : rule.providerId
          const delay = rule.escalationDelaySeconds
            ? styles.muted(` after ${rule.escalationDelaySeconds}s`)
            : ''
          const group = rule.escalationGroup
            ? styles.muted(` [escalation: ${rule.escalationGroup}]`)
            : ''
          this.log(`    -> ${styles.code(providerLabel)}${delay}${group}`)
        }
        this.log('')
      }
    }

    this.log(styles.muted(`  ${providers.length} provider${providers.length === 1 ? '' : 's'} configured`))
  }
}

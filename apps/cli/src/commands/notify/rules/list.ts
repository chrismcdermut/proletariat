/**
 * prlt notify rules list — List notification rules.
 */

import { Flags } from '@oclif/core'
import { RuntimeCommand, machineOutputFlags } from '../../../lib/runtime-command.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  createMetadata,
} from '../../../lib/prompt-json.js'
import { styles } from '../../../lib/styles.js'
import { NotificationStorage } from '../../../lib/notifications/index.js'

export default class NotifyRulesList extends RuntimeCommand {
  static description = 'List notification rules'

  static examples = [
    '<%= config.bin %> notify rules list',
    '<%= config.bin %> notify rules list --event on_agent_died',
  ]

  static flags = {
    ...machineOutputFlags,
    event: Flags.string({
      description: 'Filter by event name',
    }),
  }

  async execute(): Promise<void> {
    const { flags } = await this.parse(NotifyRulesList)
    const jsonMode = shouldOutputJson(flags)
    const db = this.requireDB()
    const storage = new NotificationStorage(db)

    const rules = storage.listRules({ event: flags.event })
    const providers = storage.listProviders()
    const providerMap = new Map(providers.map(p => [p.id, p]))

    if (jsonMode) {
      outputSuccessAsJson(
        {
          rules: rules.map(r => {
            const p = providerMap.get(r.providerId)
            return {
              id: r.id,
              event: r.event,
              providerId: r.providerId,
              providerName: p?.name,
              providerType: p?.type,
              priority: r.priority,
              escalationDelaySeconds: r.escalationDelaySeconds,
              escalationGroup: r.escalationGroup,
              enabled: r.enabled,
            }
          }),
          count: rules.length,
        },
        createMetadata('notify rules list', flags),
      )
      return
    }

    if (rules.length === 0) {
      this.log(styles.info('No notification rules configured.'))
      this.log(styles.muted('  Add one with: prlt notify rules add on_agent_died --provider slack'))
      return
    }

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
        const provider = providerMap.get(rule.providerId)
        const providerLabel = provider ? `${provider.name} (${provider.type})` : rule.providerId
        const delay = rule.escalationDelaySeconds !== null
          ? styles.muted(` after ${rule.escalationDelaySeconds}s`)
          : ''
        const group = rule.escalationGroup
          ? styles.muted(` [${rule.escalationGroup}]`)
          : ''
        const status = rule.enabled ? '' : ` ${styles.muted('(disabled)')}`
        this.log(`    -> ${styles.code(providerLabel)}${delay}${group}${status}`)
      }
      this.log('')
    }

    this.log(styles.muted(`  ${rules.length} rule${rules.length === 1 ? '' : 's'} configured`))
  }
}

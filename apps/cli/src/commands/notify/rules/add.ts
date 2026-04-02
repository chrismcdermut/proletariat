/**
 * prlt notify rules add — Add a notification rule mapping an event to a provider.
 *
 * Examples:
 *   prlt notify rules add on_agent_died --provider slack
 *   prlt notify rules add on_ci_failed --provider email
 *   prlt notify rules add on_human_approval_needed --provider slack --escalation-group approval --delay 0
 *   prlt notify rules add on_human_approval_needed --provider sms --escalation-group approval --delay 600
 */

import { Args, Flags } from '@oclif/core'
import { RuntimeCommand, machineOutputFlags } from '../../../lib/runtime-command.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../../lib/prompt-json.js'
import { styles } from '../../../lib/styles.js'
import { NotificationStorage, type NotificationEvent } from '../../../lib/notifications/index.js'
import { ORCHESTRATE_EVENTS } from '../../../lib/orchestrate/types.js'

export default class NotifyRulesAdd extends RuntimeCommand {
  static description = 'Add a notification rule for an event'

  static examples = [
    '<%= config.bin %> notify rules add on_agent_died --provider slack',
    '<%= config.bin %> notify rules add on_ci_failed --provider email --priority 1',
    '<%= config.bin %> notify rules add on_agent_died --provider sms --escalation-group agent-down --delay 600',
  ]

  static args = {
    event: Args.string({
      description: 'Event to trigger notification',
      required: true,
    }),
  }

  static flags = {
    ...machineOutputFlags,
    provider: Flags.string({
      description: 'Provider name to notify',
      required: true,
    }),
    priority: Flags.integer({
      description: 'Priority (lower = higher priority)',
      default: 0,
    }),
    delay: Flags.integer({
      description: 'Escalation delay in seconds (0 = immediate)',
    }),
    'escalation-group': Flags.string({
      description: 'Escalation group name (rules in same group escalate sequentially)',
    }),
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(NotifyRulesAdd)
    const jsonMode = shouldOutputJson(flags)
    const db = this.requireDB()
    const storage = new NotificationStorage(db)

    // Validate event name
    const validEvents = ORCHESTRATE_EVENTS as string[]
    if (!validEvents.includes(args.event)) {
      if (jsonMode) {
        outputErrorAsJson('INVALID_EVENT', `Unknown event: ${args.event}. Valid events: ${validEvents.join(', ')}`, createMetadata('notify rules add', flags))
        return
      }
      this.error(`Unknown event: ${args.event}.\nValid events: ${validEvents.join(', ')}`)
    }

    // Resolve provider
    const provider = storage.getProviderByName(flags.provider)
    if (!provider) {
      if (jsonMode) {
        outputErrorAsJson('PROVIDER_NOT_FOUND', `No provider named "${flags.provider}"`, createMetadata('notify rules add', flags))
        return
      }
      this.error(`No provider named "${flags.provider}". Run "prlt notify list" to see configured providers.`)
    }

    const rule = storage.createRule({
      event: args.event as NotificationEvent,
      providerId: provider.id,
      priority: flags.priority,
      escalationDelaySeconds: flags.delay ?? null,
      escalationGroup: flags['escalation-group'] ?? null,
    })

    if (jsonMode) {
      outputSuccessAsJson(
        {
          rule: {
            id: rule.id,
            event: rule.event,
            providerId: rule.providerId,
            providerName: provider.name,
            priority: rule.priority,
            escalationDelaySeconds: rule.escalationDelaySeconds,
            escalationGroup: rule.escalationGroup,
          },
        },
        createMetadata('notify rules add', flags),
      )
      return
    }

    const delayStr = rule.escalationDelaySeconds !== null ? ` (delay: ${rule.escalationDelaySeconds}s)` : ''
    const groupStr = rule.escalationGroup ? ` [group: ${rule.escalationGroup}]` : ''
    this.log(styles.success(`Rule added: ${args.event} -> ${provider.name} (${provider.type})${delayStr}${groupStr}`))
  }
}

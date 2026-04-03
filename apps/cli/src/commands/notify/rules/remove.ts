/**
 * prlt notify rules remove — Remove a notification rule.
 */

import { Args } from '@oclif/core'
import { RuntimeCommand, machineOutputFlags } from '../../../lib/runtime-command.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../../lib/prompt-json.js'
import { styles } from '../../../lib/styles.js'
import { NotificationStorage } from '../../../lib/notifications/index.js'

export default class NotifyRulesRemove extends RuntimeCommand {
  static description = 'Remove a notification rule'

  static examples = [
    '<%= config.bin %> notify rules remove <rule-id>',
  ]

  static args = {
    id: Args.string({
      description: 'Rule ID to remove',
      required: true,
    }),
  }

  static flags = {
    ...machineOutputFlags,
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(NotifyRulesRemove)
    const jsonMode = shouldOutputJson(flags)
    const db = this.requireDB()
    const storage = new NotificationStorage(db)

    const rule = storage.getRuleById(args.id)
    if (!rule) {
      if (jsonMode) {
        outputErrorAsJson('RULE_NOT_FOUND', `No rule with ID "${args.id}"`, createMetadata('notify rules remove', flags))
        return
      }
      this.error(`No rule with ID "${args.id}"`)
    }

    storage.deleteRule(args.id)

    if (jsonMode) {
      outputSuccessAsJson(
        { deleted: { id: rule.id, event: rule.event, providerId: rule.providerId } },
        createMetadata('notify rules remove', flags),
      )
      return
    }

    this.log(styles.success(`Removed notification rule for "${rule.event}"`))
  }
}

/**
 * prlt notify test — Send a test notification through a provider.
 */

import { Args } from '@oclif/core'
import { RuntimeCommand, machineOutputFlags } from '../../lib/runtime-command.js'
import {
  shouldOutputJson,
  outputSuccessAsJson,
  outputErrorAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'
import { styles } from '../../lib/styles.js'
import { NotificationStorage, dispatchNotification } from '../../lib/notifications/index.js'

export default class NotifyTest extends RuntimeCommand {
  static description = 'Send a test notification through a provider'

  static examples = [
    '<%= config.bin %> notify test slack',
    '<%= config.bin %> notify test my-email',
  ]

  static args = {
    name: Args.string({
      description: 'Provider name to test',
      required: true,
    }),
  }

  static flags = {
    ...machineOutputFlags,
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(NotifyTest)
    const jsonMode = shouldOutputJson(flags)
    const db = this.requireDB()
    const storage = new NotificationStorage(db)

    const provider = storage.getProviderByName(args.name)
    if (!provider) {
      if (jsonMode) {
        outputErrorAsJson('PROVIDER_NOT_FOUND', `No provider named "${args.name}"`, createMetadata('notify test', flags))
        return
      }
      this.error(`No provider named "${args.name}"`)
    }

    if (!jsonMode) {
      this.log(styles.muted(`Sending test notification via "${provider.name}" (${provider.type})...`))
    }

    const result = await dispatchNotification(provider, {
      event: 'test',
      message: 'This is a test notification from prlt.',
    })

    if (jsonMode) {
      outputSuccessAsJson(
        {
          provider: { id: provider.id, name: provider.name, type: provider.type },
          result: {
            success: result.success,
            error: result.error,
            durationMs: result.durationMs,
          },
        },
        createMetadata('notify test', flags),
      )
      return
    }

    if (result.success) {
      this.log(styles.success(`Test notification sent successfully via "${provider.name}" (${result.durationMs}ms)`))
    } else {
      this.log(styles.error(`Test notification failed: ${result.error}`))
    }
  }
}

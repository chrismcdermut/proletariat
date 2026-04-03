/**
 * prlt notify disconnect — Remove a notification provider.
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
import { NotificationStorage } from '../../lib/notifications/index.js'

export default class NotifyDisconnect extends RuntimeCommand {
  static description = 'Remove a notification provider'

  static examples = [
    '<%= config.bin %> notify disconnect slack',
    '<%= config.bin %> notify disconnect my-slack',
  ]

  static args = {
    name: Args.string({
      description: 'Provider name to disconnect',
      required: true,
    }),
  }

  static flags = {
    ...machineOutputFlags,
  }

  async execute(): Promise<void> {
    const { args, flags } = await this.parse(NotifyDisconnect)
    const jsonMode = shouldOutputJson(flags)
    const db = this.requireDB()
    const storage = new NotificationStorage(db)

    const provider = storage.getProviderByName(args.name)
    if (!provider) {
      if (jsonMode) {
        outputErrorAsJson('PROVIDER_NOT_FOUND', `No provider named "${args.name}"`, createMetadata('notify disconnect', flags))
        return
      }
      this.error(`No provider named "${args.name}"`)
    }

    storage.deleteProvider(provider.id)

    if (jsonMode) {
      outputSuccessAsJson(
        { deleted: { id: provider.id, name: provider.name, type: provider.type } },
        createMetadata('notify disconnect', flags),
      )
      return
    }

    this.log(styles.success(`Disconnected notification provider "${provider.name}" (${provider.type})`))
  }
}

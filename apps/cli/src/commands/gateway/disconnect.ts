/**
 * prlt gateway disconnect — Remove or deactivate a messaging channel.
 *
 * By default, this deletes the channel registration outright. Pass
 * --deactivate to keep the row around (and its stored credentials) but
 * mark it inactive so `prlt gateway start` skips it.
 */

import { Args, Flags } from '@oclif/core'
import { PromptCommand } from '../../lib/prompt-command.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import {
  shouldOutputJson,
  outputErrorAsJson,
  outputSuccessAsJson,
  createMetadata,
} from '../../lib/prompt-json.js'
import { styles } from '../../lib/styles.js'
import { MachineDB } from '../../lib/machine-db.js'

export default class GatewayDisconnect extends PromptCommand {
  static description = 'Disconnect a registered messaging channel'

  static examples = [
    '<%= config.bin %> gateway disconnect telegram',
    '<%= config.bin %> gateway disconnect telegram --deactivate',
  ]

  static args = {
    name: Args.string({
      description: 'Channel name (as registered with `gateway connect`)',
      required: true,
    }),
  }

  static flags = {
    ...machineOutputFlags,
    deactivate: Flags.boolean({
      description: 'Mark the channel inactive instead of deleting it',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(GatewayDisconnect)
    const jsonMode = shouldOutputJson(flags)

    const db = new MachineDB()
    try {
      const existing = db.getMessagingChannel(args.name)
      if (!existing) {
        if (jsonMode) {
          outputErrorAsJson(
            'CHANNEL_NOT_FOUND',
            `No channel registered with name "${args.name}"`,
            createMetadata('gateway disconnect', flags),
          )
          return
        }
        this.log(styles.error(`No channel registered with name "${args.name}"`))
        return
      }

      if (flags.deactivate) {
        db.setMessagingChannelActive(args.name, false)
      } else {
        db.deleteMessagingChannel(args.name)
      }

      if (jsonMode) {
        outputSuccessAsJson(
          {
            channel: args.name,
            action: flags.deactivate ? 'deactivated' : 'deleted',
          },
          createMetadata('gateway disconnect', flags),
        )
        return
      }

      this.log(
        styles.success(
          flags.deactivate
            ? `Deactivated channel "${args.name}"`
            : `Removed channel "${args.name}"`,
        ),
      )
    } finally {
      db.close()
    }
  }
}

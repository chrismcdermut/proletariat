/**
 * prlt gateway test — Send a test message through a registered channel.
 *
 * Loads a channel's config from machine.db, instantiates the adapter,
 * and calls `sendMessage` directly. This doesn't start the polling loop,
 * so it's safe to run alongside a live `gateway start`.
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
import { buildChannelFromRecord } from '../../lib/gateway/channel-factory.js'

export default class GatewayTest extends PromptCommand {
  static description = 'Send a test message through a registered messaging channel'

  static examples = [
    '<%= config.bin %> gateway test telegram --to 123456789 --message "hello from prlt"',
  ]

  static args = {
    name: Args.string({
      description: 'Channel name (as registered with `gateway connect`)',
      required: true,
    }),
  }

  static flags = {
    ...machineOutputFlags,
    to: Flags.string({
      description: 'Recipient id on the channel (e.g. Telegram chat id)',
      required: true,
    }),
    message: Flags.string({
      description: 'Text to send',
      default: 'hello from prlt',
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(GatewayTest)
    const jsonMode = shouldOutputJson(flags)

    const db = new MachineDB()
    const record = db.getMessagingChannel(args.name)
    db.close()

    if (!record) {
      if (jsonMode) {
        outputErrorAsJson(
          'CHANNEL_NOT_FOUND',
          `No channel registered with name "${args.name}"`,
          createMetadata('gateway test', flags),
        )
        return
      }
      this.log(styles.error(`No channel registered with name "${args.name}"`))
      return
    }

    let channel
    try {
      channel = buildChannelFromRecord(record)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      if (jsonMode) {
        outputErrorAsJson(
          'CHANNEL_BUILD_FAILED',
          errMsg,
          createMetadata('gateway test', flags),
        )
        return
      }
      this.log(styles.error(errMsg))
      return
    }

    try {
      await channel.sendMessage(
        { channel: channel.name, id: flags.to },
        flags.message,
      )
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      if (jsonMode) {
        outputErrorAsJson(
          'SEND_FAILED',
          errMsg,
          createMetadata('gateway test', flags),
        )
        return
      }
      this.log(styles.error(`Failed to send: ${errMsg}`))
      return
    }

    if (jsonMode) {
      outputSuccessAsJson(
        { channel: args.name, to: flags.to, message: flags.message },
        createMetadata('gateway test', flags),
      )
      return
    }

    this.log(styles.success(`Sent test message via "${args.name}" to ${flags.to}`))
  }
}

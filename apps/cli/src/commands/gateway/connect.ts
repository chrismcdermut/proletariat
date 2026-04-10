/**
 * prlt gateway connect — Register a messaging channel (PRLT-1255)
 *
 * MVP: only the telegram channel type is implemented. The command stores
 * the bot token + allowlist in machine.db so `prlt gateway start` can
 * bring the adapter up later.
 *
 * Examples:
 *   prlt gateway connect telegram --token 123:abc --allow 111 --allow 222
 *   prlt gateway connect telegram --token 123:abc --allow 111,222
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
import type { TelegramChannelConfig } from '../../lib/gateway/types.js'

const SUPPORTED_CHANNEL_TYPES = ['telegram'] as const
type SupportedChannelType = typeof SUPPORTED_CHANNEL_TYPES[number]

export default class GatewayConnect extends PromptCommand {
  static description = 'Register a messaging channel (Telegram) with the gateway'

  static examples = [
    '<%= config.bin %> gateway connect telegram --token 123:abc --allow 111 --allow 222',
    '<%= config.bin %> gateway connect telegram --token 123:abc --allow 111,222 --name my-bot',
  ]

  static args = {
    type: Args.string({
      description: 'Channel type',
      required: true,
      options: [...SUPPORTED_CHANNEL_TYPES],
    }),
  }

  static flags = {
    ...machineOutputFlags,
    name: Flags.string({
      description: 'Channel name (primary key). Defaults to the channel type.',
    }),
    token: Flags.string({
      description: 'Telegram bot token from @BotFather',
    }),
    allow: Flags.string({
      description: 'Telegram user id(s) allowed to message agents (repeatable, or comma-separated)',
      multiple: true,
    }),
    'poll-interval-ms': Flags.integer({
      description: 'Delay between getUpdates polls (0 uses Telegram long-poll)',
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(GatewayConnect)
    const jsonMode = shouldOutputJson(flags)
    const channelType = args.type as SupportedChannelType
    const channelName = flags.name || channelType

    if (channelType === 'telegram') {
      if (!flags.token) {
        if (jsonMode) {
          outputErrorAsJson(
            'MISSING_TOKEN',
            'Telegram requires --token',
            createMetadata('gateway connect', flags),
          )
          return
        }
        this.log(styles.error('Telegram requires --token'))
        return
      }

      const allowlist = parseAllowlist(flags.allow)
      if (allowlist.length === 0) {
        if (jsonMode) {
          outputErrorAsJson(
            'MISSING_ALLOWLIST',
            'Telegram requires --allow <user-id> (at least one)',
            createMetadata('gateway connect', flags),
          )
          return
        }
        this.log(styles.error('Telegram requires --allow <user-id> (at least one)'))
        return
      }

      const config: TelegramChannelConfig = {
        token: flags.token,
        allowlist,
        ...(flags['poll-interval-ms'] !== undefined ? { pollIntervalMs: flags['poll-interval-ms'] } : {}),
      }

      const db = new MachineDB()
      try {
        db.upsertMessagingChannel({
          name: channelName,
          type: 'telegram',
          configJson: JSON.stringify(config),
          active: true,
        })
      } finally {
        db.close()
      }

      if (jsonMode) {
        outputSuccessAsJson(
          {
            channel: {
              name: channelName,
              type: 'telegram',
              allowlist,
              active: true,
            },
          },
          createMetadata('gateway connect', flags),
        )
        return
      }

      this.log(styles.success(`Connected telegram channel "${channelName}"`))
      this.log(styles.muted(`  Allowlist: ${allowlist.join(', ')}`))
      this.log(styles.muted(`  Start the gateway with: prlt gateway start`))
      return
    }

    // Unreachable under current oclif `options` constraint, but we keep
    // it so future channel types slot in cleanly.
    if (jsonMode) {
      outputErrorAsJson(
        'UNSUPPORTED_CHANNEL',
        `Channel type "${channelType}" is not implemented yet`,
        createMetadata('gateway connect', flags),
      )
      return
    }
    this.log(styles.error(`Channel type "${channelType}" is not implemented yet`))
  }
}

/**
 * Accept `--allow 111 --allow 222` and `--allow 111,222` equally. Blank
 * entries are stripped so users can't accidentally register an empty id.
 */
export function parseAllowlist(raw: string[] | undefined): string[] {
  if (!raw) return []
  const out: string[] = []
  for (const entry of raw) {
    for (const piece of entry.split(',')) {
      const trimmed = piece.trim()
      if (trimmed) out.push(trimmed)
    }
  }
  return out
}

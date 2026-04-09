/**
 * Channel factory (PRLT-1255)
 *
 * Single place that knows how to decode a persisted MessagingChannelRecord
 * into a live MessagingChannel instance. Commands and the gateway daemon
 * call this so they never import individual adapters directly.
 *
 * To add Slack/Discord/WhatsApp later: import the new adapter and add a
 * case to `buildChannelFromRecord`. No other file needs to change.
 */

import type { MessagingChannelRecord } from '../machine-db.js'
import type { MessagingChannel, TelegramChannelConfig } from './types.js'
import { TelegramChannel } from './channels/telegram.js'

export function buildChannelFromRecord(record: MessagingChannelRecord): MessagingChannel {
  switch (record.type) {
    case 'telegram': {
      const config = parseConfig<TelegramChannelConfig>(record.configJson, record.name)
      if (!config.token) {
        throw new Error(`Channel "${record.name}" has no Telegram token configured`)
      }
      if (!Array.isArray(config.allowlist)) {
        throw new TypeError(`Channel "${record.name}" has a malformed allowlist`)
      }
      return new TelegramChannel({ config })
    }
    default:
      throw new Error(`Unknown channel type "${record.type}" for "${record.name}"`)
  }
}

function parseConfig<T>(json: string, channelName: string): T {
  try {
    return JSON.parse(json) as T
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Channel "${channelName}" has invalid config JSON: ${msg}`)
  }
}

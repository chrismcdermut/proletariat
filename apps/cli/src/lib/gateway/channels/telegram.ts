/**
 * Telegram Channel Adapter (PRLT-1255)
 *
 * Polling-mode Telegram bot that implements MessagingChannel.
 *
 * Uses Telegram's `getUpdates` long-polling API — no webhook, no server
 * required. Messages arrive over an outgoing HTTPS request, so the bot
 * works fine from behind NAT, on a laptop, or in a container.
 *
 * This adapter is the ONLY Telegram-aware code in the gateway. To add
 * Slack/Discord/WhatsApp later: write a new adapter next to this file,
 * implementing the same interface. The router and commands do not need
 * to change.
 *
 * @see PRLT-1251 (Messaging Gateway epic)
 */

import type {
  ChannelAddress,
  Message,
  MessageHandler,
  MessagingChannel,
  TelegramChannelConfig,
} from '../types.js'

// =============================================================================
// Telegram Bot API shapes (subset we use)
// =============================================================================

interface TelegramUser {
  id: number
  is_bot?: boolean
  first_name?: string
  last_name?: string
  username?: string
}

interface TelegramChat {
  id: number
  type: 'private' | 'group' | 'supergroup' | 'channel'
  title?: string
  username?: string
  first_name?: string
}

interface TelegramMessage {
  message_id: number
  from?: TelegramUser
  chat: TelegramChat
  date: number
  text?: string
}

export interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
  edited_message?: TelegramMessage
}

interface TelegramResponse<T> {
  ok: boolean
  result?: T
  description?: string
  error_code?: number
}

// =============================================================================
// Telegram HTTP client
// =============================================================================

/**
 * Minimal Telegram Bot API client. Broken out so tests can substitute a
 * fake client without touching the network.
 */
export interface TelegramClient {
  getUpdates(options: { offset?: number; timeoutSec?: number }): Promise<TelegramUpdate[]>
  sendMessage(chatId: string | number, text: string): Promise<void>
}

class HttpTelegramClient implements TelegramClient {
  constructor(private token: string) {}

  private url(method: string): string {
    return `https://api.telegram.org/bot${this.token}/${method}`
  }

  async getUpdates(options: { offset?: number; timeoutSec?: number }): Promise<TelegramUpdate[]> {
    const params = new URLSearchParams()
    if (options.offset !== undefined) params.set('offset', String(options.offset))
    params.set('timeout', String(options.timeoutSec ?? 25))
    // Only request message updates — we don't need callback queries, polls, etc.
    params.set('allowed_updates', JSON.stringify(['message']))

     
    const res = await fetch(`${this.url('getUpdates')}?${params.toString()}`)
    if (!res.ok) {
      throw new Error(`Telegram getUpdates failed: HTTP ${res.status}`)
    }
    const body = (await res.json()) as TelegramResponse<TelegramUpdate[]>
    if (!body.ok) {
      throw new Error(`Telegram getUpdates failed: ${body.description ?? 'unknown'}`)
    }
    return body.result ?? []
  }

  async sendMessage(chatId: string | number, text: string): Promise<void> {
     
    const res = await fetch(this.url('sendMessage'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    })
    if (!res.ok) {
      throw new Error(`Telegram sendMessage failed: HTTP ${res.status}`)
    }
    const body = (await res.json()) as TelegramResponse<TelegramMessage>
    if (!body.ok) {
      throw new Error(`Telegram sendMessage failed: ${body.description ?? 'unknown'}`)
    }
  }
}

// =============================================================================
// TelegramChannel
// =============================================================================

/**
 * Options for constructing a TelegramChannel.
 *
 * - `config`: TelegramChannelConfig loaded from machine.db.
 * - `client`: optional injectable Telegram client (tests use this).
 * - `logger`: optional error/info sink. Defaults to console.
 */
export interface TelegramChannelOptions {
  config: TelegramChannelConfig
  client?: TelegramClient
  logger?: {
    info?: (msg: string) => void
    error?: (msg: string, err?: unknown) => void
  }
  /**
   * How long to back off after a failed poll. Defaults to 5000ms.
   * Tests shorten this so they don't have to sit on a 5s sleep.
   */
  errorBackoffMs?: number
}

/**
 * Polling-mode Telegram adapter.
 *
 * The read loop is a vanilla `while (running) await getUpdates()`. We
 * acknowledge updates by advancing the `offset` cursor to the id after
 * the highest update seen in the batch — this is Telegram's documented
 * delete semantics for getUpdates.
 */
export class TelegramChannel implements MessagingChannel {
  readonly name = 'telegram'

  private handler: MessageHandler | null = null
  private running = false
  private loopPromise: Promise<void> | null = null
  private offset: number | undefined
  private readonly client: TelegramClient
  private readonly config: TelegramChannelConfig
  private readonly logger: NonNullable<TelegramChannelOptions['logger']>
  private readonly errorBackoffMs: number

  constructor(options: TelegramChannelOptions) {
    this.config = options.config
    this.client = options.client ?? new HttpTelegramClient(options.config.token)
    this.logger = options.logger ?? {}
    this.errorBackoffMs = options.errorBackoffMs ?? 5000
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler
  }

  async start(): Promise<void> {
    if (this.running) return
    if (!this.handler) {
      throw new Error('TelegramChannel.start() called before onMessage() — no handler registered')
    }
    this.running = true
    this.loopPromise = this.runLoop()
  }

  async stop(): Promise<void> {
    if (!this.running) return
    this.running = false
    if (this.loopPromise) {
      try {
        await this.loopPromise
      } catch {
        // Loop errors are already logged; ignore here so stop() is always clean.
      }
      this.loopPromise = null
    }
  }

  async sendMessage(to: ChannelAddress, text: string): Promise<void> {
    if (to.channel !== this.name) {
      throw new Error(`TelegramChannel cannot send to channel=${to.channel}`)
    }
    await this.client.sendMessage(to.id, text)
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * Main polling loop. Runs until `stop()` flips `running` false.
   *
   * Errors are caught, logged, and followed by a small backoff so a
   * transient network blip doesn't hot-spin the bot against Telegram.
   *
   * The awaits are deliberately sequential: Telegram long-poll demands
   * one outstanding getUpdates at a time per bot, and we must drain
   * each batch before advancing the cursor.
   */
  /* eslint-disable no-await-in-loop -- polling loop is intentionally sequential */
  private async runLoop(): Promise<void> {
    const pollInterval = this.config.pollIntervalMs ?? 0

    while (this.running) {
      try {
        const updates = await this.client.getUpdates({
          offset: this.offset,
          timeoutSec: 25,
        })

        for (const update of updates) {
          await this.handleUpdate(update)
          // Advance cursor past the highest update id we've seen.
          this.offset = update.update_id + 1
        }

        if (pollInterval > 0) await sleep(pollInterval)
      } catch (err) {
        this.logger.error?.('telegram: poll loop error', err)
        // Backoff on errors so we don't hammer the API when the network
        // is flaky or the token got revoked.
        await sleep(this.errorBackoffMs)
      }
    }
  }
  /* eslint-enable no-await-in-loop */

  /**
   * Normalize a Telegram update into a generic `Message` and hand it to
   * the router. Drops non-text messages silently (MVP is text-only).
   */
  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    const msg = update.message ?? update.edited_message
    if (!msg) return
    if (!msg.text) return // MVP: text-only
    if (!this.handler) return

    // Reject messages from users not on the allowlist. We match on the
    // sender's user id (falling back to chat id for groups where there
    // is no `from`). Allowlist is explicit — empty list means "nobody".
    const senderId = String(msg.from?.id ?? msg.chat.id)
    if (!this.config.allowlist.includes(senderId)) {
      this.logger.info?.(`telegram: dropping message from non-allowlisted user ${senderId}`)
      return
    }

    const address: ChannelAddress = {
      channel: this.name,
      // We always send replies to the chat, not the user — that way
      // group chats work correctly in a future multi-user mode.
      id: String(msg.chat.id),
      displayName: resolveDisplayName(msg),
    }

    const normalized: Message = {
      id: `telegram:${msg.message_id}`,
      channel: this.name,
      from: address,
      text: msg.text,
      timestamp: new Date(msg.date * 1000),
    }

    try {
      await this.handler(normalized)
    } catch (err) {
      this.logger.error?.('telegram: handler failed', err)
    }
  }
}

// =============================================================================
// Helpers
// =============================================================================

function resolveDisplayName(msg: TelegramMessage): string | undefined {
  const from = msg.from
  if (from?.username) return `@${from.username}`
  if (from?.first_name) {
    return from.last_name ? `${from.first_name} ${from.last_name}` : from.first_name
  }
  if (msg.chat.title) return msg.chat.title
  if (msg.chat.username) return `@${msg.chat.username}`
  return undefined
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Messaging Gateway Types
 *
 * Defines the channel-agnostic abstraction that sits between external
 * messaging platforms (Telegram, Slack, Discord, WhatsApp, ...) and the
 * internal `prlt session poke` path that forwards user input to agent
 * sessions.
 *
 * The gateway is designed so adding a new platform is a new adapter that
 * implements `MessagingChannel` — zero changes to the router, storage,
 * or commands.
 *
 * Epic: PRLT-1251 (Messaging Gateway)
 * Ticket: PRLT-1255 (Telegram bot MVP)
 */

// =============================================================================
// Addressing
// =============================================================================

/**
 * A platform-specific identifier for a user or conversation on a channel.
 *
 * `channel` is the channel name (e.g. "telegram", "slack"), and `id` is the
 * platform's own identifier. For Telegram, `id` is the numeric chat id
 * encoded as a string (e.g. `"123456789"`).
 *
 * `displayName` is a best-effort human-readable label for logs/UI. It must
 * never be used for routing.
 */
export interface ChannelAddress {
  channel: string
  id: string
  displayName?: string
}

// =============================================================================
// Messages
// =============================================================================

/**
 * A normalized inbound message from any channel.
 *
 * Adapters convert platform payloads into this shape before handing them
 * to the router. Adapters are responsible for idempotency via `id` — the
 * router uses it to de-duplicate re-delivered messages.
 */
export interface Message {
  /** Stable per-channel message id (platform's id, stringified). */
  id: string
  /** Channel name (matches MessagingChannel.name). */
  channel: string
  /** Who sent the message. */
  from: ChannelAddress
  /** Optional text body. Either `text` or `audio` should be set. */
  text?: string
  /** Optional raw audio payload (voice note / audio message). */
  audio?: Buffer
  /** Server-side timestamp of the message. */
  timestamp: Date
}

/**
 * Handler signature used by channels to deliver inbound messages to the
 * router. Channels call this from their read loop.
 */
export type MessageHandler = (msg: Message) => Promise<void>

// =============================================================================
// Channel interface
// =============================================================================

/**
 * A bidirectional adapter to an external messaging platform.
 *
 * Implementations MUST:
 * - Normalize their inbound payloads into `Message` objects.
 * - Deliver inbound messages by invoking the handler registered via
 *   `onMessage`.
 * - Honor `start()` / `stop()` lifecycle cleanly so the gateway can shut
 *   down without leaking sockets, timers, or worker threads.
 *
 * Adapters MUST NOT touch the database, the session system, or the
 * router directly. Their only public entry points are the methods
 * defined here.
 */
export interface MessagingChannel {
  /** Stable channel name (e.g. "telegram"). Used as a primary key. */
  readonly name: string

  /** Begin reading messages (e.g. open socket, start polling loop). */
  start(): Promise<void>

  /** Stop reading and release all resources. Must be idempotent. */
  stop(): Promise<void>

  /** Register the inbound-message handler. Called before `start()`. */
  onMessage(handler: MessageHandler): void

  /** Send an outbound text message to a ChannelAddress. */
  sendMessage(to: ChannelAddress, text: string): Promise<void>

  /** Optional: send an outbound voice note (PRLT-1234 territory). */
  sendVoiceNote?(to: ChannelAddress, audio: Buffer): Promise<void>
}

// =============================================================================
// Stored channel configuration
// =============================================================================

/**
 * Persisted configuration for a registered channel.
 *
 * Stored in `machine.db` → `messaging_channels`. `configJson` is an
 * adapter-specific blob — for Telegram it contains the bot token and
 * allowlist of permitted user ids.
 */
export interface MessagingChannelRecord {
  name: string
  type: string
  configJson: string
  active: boolean
  lastMessageAt: Date | undefined
}

/**
 * A user → agent routing binding. The router creates one on first
 * contact and reuses it for all subsequent messages.
 */
export interface MessagingRouteRecord {
  channel: string
  userId: string
  agentSessionId: string
  createdAt: Date
  lastUsedAt: Date | undefined
}

// =============================================================================
// Telegram-specific config shape
// =============================================================================

/**
 * Shape of `messaging_channels.config_json` when `type === "telegram"`.
 *
 * - `token`: Telegram Bot API token from @BotFather.
 * - `allowlist`: numeric Telegram user ids (stringified) that are allowed
 *   to poke agents. Messages from non-allowlisted users are rejected at
 *   the router boundary.
 * - `pollIntervalMs`: how often to long-poll getUpdates. Defaults to 0
 *   (use Telegram's long-poll timeout of 25 seconds).
 */
export interface TelegramChannelConfig {
  token: string
  allowlist: string[]
  pollIntervalMs?: number
}

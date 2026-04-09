/**
 * Messaging Gateway Router (PRLT-1255)
 *
 * Sits between N `MessagingChannel` adapters and the `prlt session poke`
 * path. The router is intentionally small — it does four things:
 *
 *   1. Look up (or create) the agent mapping for `(channel, user)`.
 *   2. Forward the user's text to that agent via a `SessionPoker`.
 *   3. Ship the agent's response back via the channel's `sendMessage`.
 *   4. Stamp channel + route usage timestamps in machine.db.
 *
 * Everything Telegram-specific lives in `channels/telegram.ts`. Everything
 * storage-specific lives in `MachineDB`. This file owns the glue.
 */

import type { MachineDB, MessagingRouteRecord } from '../machine-db.js'
import type { MessagingChannel, Message } from './types.js'

// =============================================================================
// Session poker abstraction
// =============================================================================

/**
 * Indirection over `prlt session poke`. The default implementation shells
 * out to the globally-installed `prlt` binary, but tests and embedders can
 * inject a custom poker.
 *
 * Returning `null` means "message delivered, no response captured".
 * Throwing means "failed to reach the agent at all".
 */
export interface SessionPoker {
  poke(agent: string, message: string, options?: { waitTimeoutSec?: number }): Promise<string | null>
}

// =============================================================================
// Gateway options
// =============================================================================

export interface MessagingGatewayOptions {
  /** Machine DB handle used for channel/route persistence. */
  db: MachineDB
  /** How to forward messages to an agent. Defaults to the shell poker. */
  sessionPoker: SessionPoker
  /**
   * Called when there is no existing route for a user. Must return the
   * agent session id (typically an agent name) that should own this
   * conversation going forward. Returning `null` rejects the message —
   * useful for "deny if no mapping" policies.
   */
  resolveAgentForNewUser: (msg: Message) => Promise<string | null> | string | null
  /** Optional logger sink. Defaults to console. */
  logger?: {
    info?: (msg: string) => void
    error?: (msg: string, err?: unknown) => void
  }
  /**
   * How long to wait for an agent response before giving up and sending
   * a "still working on it" message back. Defaults to 90 seconds.
   */
  waitTimeoutSec?: number
}

// =============================================================================
// MessagingGateway
// =============================================================================

export class MessagingGateway {
  private channels = new Map<string, MessagingChannel>()
  private readonly db: MachineDB
  private readonly poker: SessionPoker
  private readonly resolveAgentForNewUser: MessagingGatewayOptions['resolveAgentForNewUser']
  private readonly logger: NonNullable<MessagingGatewayOptions['logger']>
  private readonly waitTimeoutSec: number
  private started = false

  constructor(options: MessagingGatewayOptions) {
    this.db = options.db
    this.poker = options.sessionPoker
    this.resolveAgentForNewUser = options.resolveAgentForNewUser
    this.logger = options.logger ?? {}
    this.waitTimeoutSec = options.waitTimeoutSec ?? 90
  }

  /**
   * Register a channel adapter. Wires the inbound handler but does NOT
   * start the channel — the caller decides when to start() everything.
   */
  registerChannel(channel: MessagingChannel): void {
    if (this.channels.has(channel.name)) {
      throw new Error(`Channel already registered: ${channel.name}`)
    }
    channel.onMessage(msg => this.routeInbound(msg))
    this.channels.set(channel.name, channel)
  }

  /** Get a previously-registered channel by name. */
  getChannel(name: string): MessagingChannel | undefined {
    return this.channels.get(name)
  }

  /** List names of all registered channels. */
  listChannelNames(): string[] {
    return [...this.channels.keys()]
  }

  /** Start every registered channel in parallel. */
  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    await Promise.all([...this.channels.values()].map(ch => ch.start()))
  }

  /** Stop every registered channel in parallel. Safe to call multiple times. */
  async stop(): Promise<void> {
    if (!this.started) return
    this.started = false
    await Promise.all([...this.channels.values()].map(ch => ch.stop()))
  }

  // ---------------------------------------------------------------------------
  // Core routing
  // ---------------------------------------------------------------------------

  /**
   * Route a single inbound message.
   *
   * This is exposed (not `private`) so tests can drive it directly
   * without standing up a real channel adapter.
   */
  async routeInbound(msg: Message): Promise<void> {
    const channel = this.channels.get(msg.channel)
    if (!channel) {
      this.logger.error?.(`router: no channel registered for ${msg.channel}`)
      return
    }

    if (!msg.text || msg.text.trim().length === 0) {
      // MVP: text-only. Voice notes land in PRLT-1234.
      this.logger.info?.(`router: dropping empty message ${msg.id}`)
      return
    }

    // 1. Find or create the route.
    let route = this.db.getMessagingRoute(msg.channel, msg.from.id)
    if (!route) {
      route = await this.createRouteForNewUser(msg)
      if (!route) {
        // Denied by policy — silently drop, do not leak whether the user
        // exists to a possibly-hostile sender.
        return
      }
    }

    // 2. Forward to the agent session.
    let response: string | null = null
    try {
      response = await this.poker.poke(route.agentSessionId, msg.text, {
        waitTimeoutSec: this.waitTimeoutSec,
      })
    } catch (err) {
      this.logger.error?.(`router: poke failed for ${route.agentSessionId}`, err)
      await this.safeReply(channel, msg, `Sorry, I couldn't reach ${route.agentSessionId}. Try again in a moment.`)
      return
    }

    // 3. Stamp usage.
    this.db.touchMessagingRoute(msg.channel, msg.from.id)
    this.db.touchMessagingChannel(msg.channel)

    // 4. Reply (if we captured anything).
    if (response && response.trim().length > 0) {
      await this.safeReply(channel, msg, response)
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async createRouteForNewUser(msg: Message): Promise<MessagingRouteRecord | null> {
    const agentSessionId = await this.resolveAgentForNewUser(msg)
    if (!agentSessionId) {
      this.logger.info?.(`router: no agent resolved for ${msg.channel}:${msg.from.id}`)
      return null
    }
    return this.db.upsertMessagingRoute({
      channel: msg.channel,
      userId: msg.from.id,
      agentSessionId,
    })
  }

  private async safeReply(channel: MessagingChannel, msg: Message, text: string): Promise<void> {
    try {
      await channel.sendMessage(msg.from, text)
    } catch (err) {
      this.logger.error?.(`router: sendMessage failed for ${channel.name}`, err)
    }
  }
}

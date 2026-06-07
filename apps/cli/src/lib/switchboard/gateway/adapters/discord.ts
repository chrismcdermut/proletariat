/**
 * Discord Adapter — Bridges Discord to the switchboard.
 *
 * Connects to Discord via the REST API for sending messages.
 * Inbound messages are received via webhook (interactions) or
 * the Gateway websocket API.
 *
 * See: PRLT-1372
 */

import * as crypto from 'node:crypto'
import type {
  AdapterState,
  AuthResult,
  GatewayAdapter,
  GatewayCredentials,
  InboundMessage,
  OutboundMessage,
} from '../types.js'
import { formatDiscordContent } from '../formatter.js'
import { verifyAuth } from '../auth.js'

// =============================================================================
// Types
// =============================================================================

export interface DiscordAdapterOptions {
  credentials: GatewayCredentials
  /** Callback when an inbound message is received. */
  onMessage?: (message: InboundMessage) => void | Promise<void>
  /** Logger function. */
  log?: (msg: string) => void
}

/** Discord interaction payload. */
interface DiscordInteractionPayload {
  type: number
  id?: string
  channel_id?: string
  member?: {
    user?: {
      id?: string
      username?: string
    }
  }
  user?: {
    id?: string
    username?: string
  }
  data?: {
    name?: string
    options?: Array<{ name: string; value: unknown }>
  }
  message?: {
    id?: string
    content?: string
    timestamp?: string
  }
  token?: string
}

/** Discord Gateway message event. */
interface DiscordMessagePayload {
  id: string
  channel_id: string
  content: string
  author: {
    id: string
    username: string
    bot?: boolean
  }
  timestamp: string
  message_reference?: {
    message_id?: string
  }
}

// Discord interaction types
const INTERACTION_PING = 1
const INTERACTION_APPLICATION_COMMAND = 2
const INTERACTION_MESSAGE_COMPONENT = 3

// =============================================================================
// DiscordAdapter
// =============================================================================

export class DiscordAdapter implements GatewayAdapter {
  readonly platform = 'discord' as const
  private _state: AdapterState = 'stopped'
  private credentials: GatewayCredentials
  private onMessage: ((message: InboundMessage) => void | Promise<void>) | undefined
  private log: (msg: string) => void

  constructor(options: DiscordAdapterOptions) {
    this.credentials = options.credentials
    this.onMessage = options.onMessage
    this.log = options.log ?? (() => {})
  }

  get state(): AdapterState {
    return this._state
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  async start(): Promise<void> {
    this._state = 'starting'

    if (!this.credentials.botToken) {
      this._state = 'error'
      throw new Error('Discord adapter requires a botToken')
    }

    this.log('discord: adapter started')
    this._state = 'connected'
  }

  async stop(): Promise<void> {
    this._state = 'stopped'
    this.log('discord: adapter stopped')
  }

  // ===========================================================================
  // Sending
  // ===========================================================================

  async send(message: OutboundMessage): Promise<void> {
    const payload: Record<string, unknown> = {}

    if (message.blocks && message.blocks.length > 0) {
      const { content, embeds } = formatDiscordContent(message.blocks)
      payload.content = content || message.text
      if (embeds.length > 0) {
        payload.embeds = embeds
      }
    } else {
      payload.content = message.text
    }

    if (message.threadId) {
      payload.message_reference = { message_id: message.threadId }
    }

    await this.callDiscordApi(`channels/${message.channelId}/messages`, payload)
  }

  // ===========================================================================
  // Verification
  // ===========================================================================

  async verify(headers: Record<string, string>, body: string): Promise<AuthResult> {
    return verifyAuth(this.credentials, headers, body)
  }

  // ===========================================================================
  // Inbound Parsing
  // ===========================================================================

  /**
   * Parse a Discord Gateway message event into an InboundMessage.
   * Returns null for bot messages.
   */
  parseMessageEvent(event: DiscordMessagePayload): InboundMessage | null {
    // Ignore bot messages
    if (event.author.bot) return null
    if (!event.content) return null

    return {
      platformMessageId: event.id,
      platform: 'discord',
      senderId: event.author.id,
      senderName: event.author.username,
      channelId: event.channel_id,
      text: event.content,
      threadId: event.message_reference?.message_id,
      timestamp: new Date(event.timestamp).toISOString(),
    }
  }

  /**
   * Parse a Discord interaction (slash command) into an InboundMessage.
   * Returns null for pings and unsupported interaction types.
   */
  parseInteraction(payload: DiscordInteractionPayload): InboundMessage | null {
    if (payload.type === INTERACTION_PING) return null

    const user = payload.member?.user ?? payload.user
    if (!user?.id) return null

    // Reconstruct text from command + options
    let text = ''
    if (payload.type === INTERACTION_APPLICATION_COMMAND && payload.data) {
      text = `/${payload.data.name ?? 'unknown'}`
      if (payload.data.options) {
        const args = payload.data.options.map(o => String(o.value)).join(' ')
        text += ` ${args}`
      }
    } else if (payload.message?.content) {
      text = payload.message.content
    }

    if (!text) return null

    return {
      platformMessageId: payload.id ?? crypto.randomUUID(),
      platform: 'discord',
      senderId: user.id,
      senderName: user.username,
      channelId: payload.channel_id ?? '',
      text: text.trim(),
      timestamp: new Date().toISOString(),
      metadata: {
        interactionType: payload.type,
        interactionToken: payload.token,
      },
    }
  }

  /**
   * Handle a raw Discord interaction webhook request.
   */
  async handleWebhook(
    headers: Record<string, string>,
    body: string,
  ): Promise<{ status: number; body: unknown }> {
    // Verify signature
    const authResult = await this.verify(headers, body)
    if (!authResult.authorized) {
      return { status: 401, body: { error: authResult.reason } }
    }

    let payload: DiscordInteractionPayload
    try {
      payload = JSON.parse(body) as DiscordInteractionPayload
    } catch {
      return { status: 400, body: { error: 'Invalid JSON' } }
    }

    // Handle PING (Discord verification)
    if (payload.type === INTERACTION_PING) {
      return { status: 200, body: { type: 1 } }
    }

    // Parse and forward
    const message = this.parseInteraction(payload)
    if (message && this.onMessage) {
      const userAuth = verifyAuth(this.credentials, headers, body, message.senderId)
      if (userAuth.authorized) {
        await this.onMessage(message)
      }
    }

    // Acknowledge the interaction
    return {
      status: 200,
      body: { type: 5 }, // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
    }
  }

  // ===========================================================================
  // Discord API
  // ===========================================================================

  private async callDiscordApi(endpoint: string, payload: Record<string, unknown>): Promise<unknown> {
    const response = await fetch(`https://discord.com/api/v10/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bot ${this.credentials.botToken}`,
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Discord API error (${response.status}): ${text}`)
    }

    return response.json()
  }
}

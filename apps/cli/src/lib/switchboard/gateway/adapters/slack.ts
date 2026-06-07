/**
 * Slack Adapter — Bridges Slack to the switchboard.
 *
 * Connects to Slack via the Web API for sending messages.
 * Inbound messages are received via webhook (Events API) or
 * Socket Mode, parsed, and forwarded to the gateway.
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
import { formatSlackBlocks } from '../formatter.js'
import { verifyAuth } from '../auth.js'

// =============================================================================
// Types
// =============================================================================

export interface SlackAdapterOptions {
  credentials: GatewayCredentials
  /** Callback when an inbound message is received. */
  onMessage?: (message: InboundMessage) => void | Promise<void>
  /** Logger function. */
  log?: (msg: string) => void
}

/** Slack Events API event wrapper. */
interface SlackEventPayload {
  type: string
  event?: {
    type: string
    user?: string
    text?: string
    channel?: string
    ts?: string
    thread_ts?: string
  }
  challenge?: string
  event_id?: string
}

// =============================================================================
// SlackAdapter
// =============================================================================

export class SlackAdapter implements GatewayAdapter {
  readonly platform = 'slack' as const
  private _state: AdapterState = 'stopped'
  private credentials: GatewayCredentials
  private onMessage: ((message: InboundMessage) => void | Promise<void>) | undefined
  private log: (msg: string) => void

  constructor(options: SlackAdapterOptions) {
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
      throw new Error('Slack adapter requires a botToken')
    }

    this.log('slack: adapter started')
    this._state = 'connected'
  }

  async stop(): Promise<void> {
    this._state = 'stopped'
    this.log('slack: adapter stopped')
  }

  // ===========================================================================
  // Sending
  // ===========================================================================

  async send(message: OutboundMessage): Promise<void> {
    const payload: Record<string, unknown> = {
      channel: message.channelId,
      text: message.text,
    }

    if (message.threadId) {
      payload.thread_ts = message.threadId
    }

    if (message.blocks && message.blocks.length > 0) {
      payload.blocks = formatSlackBlocks(message.blocks)
    }

    await this.callSlackApi('chat.postMessage', payload)
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
   * Parse a Slack Events API payload into an InboundMessage.
   *
   * Returns null if the event is not a user message (e.g., bot messages,
   * URL verification challenges).
   */
  parseEvent(payload: SlackEventPayload): InboundMessage | null {
    // Handle URL verification challenge
    if (payload.type === 'url_verification') {
      return null
    }

    const event = payload.event
    if (!event || event.type !== 'message') return null
    if (!event.user || !event.text || !event.channel) return null

    return {
      platformMessageId: payload.event_id ?? event.ts ?? crypto.randomUUID(),
      platform: 'slack',
      senderId: event.user,
      channelId: event.channel,
      text: event.text,
      threadId: event.thread_ts,
      timestamp: event.ts
        ? new Date(parseFloat(event.ts) * 1000).toISOString()
        : new Date().toISOString(),
    }
  }

  /**
   * Handle a raw Slack webhook request.
   * Verifies the signature, parses the event, and forwards to the message handler.
   *
   * Returns a response body — may include a challenge response for URL verification.
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

    let payload: SlackEventPayload
    try {
      payload = JSON.parse(body) as SlackEventPayload
    } catch {
      return { status: 400, body: { error: 'Invalid JSON' } }
    }

    // Handle URL verification challenge
    if (payload.type === 'url_verification' && payload.challenge) {
      return { status: 200, body: { challenge: payload.challenge } }
    }

    // Parse and forward the message
    const message = this.parseEvent(payload)
    if (message && this.onMessage) {
      // Verify user is authorized
      const userAuth = verifyAuth(this.credentials, headers, body, message.senderId)
      if (userAuth.authorized) {
        await this.onMessage(message)
      }
    }

    return { status: 200, body: { ok: true } }
  }

  // ===========================================================================
  // Slack API
  // ===========================================================================

  /**
   * Call a Slack Web API method.
   *
   * This is a thin wrapper around fetch — real Slack SDK integration
   * would replace this with @slack/web-api.
   */
  private async callSlackApi(method: string, payload: Record<string, unknown>): Promise<unknown> {
    const response = await fetch(`https://slack.com/api/${method}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': `Bearer ${this.credentials.botToken}`,
      },
      body: JSON.stringify(payload),
    })

    const result = await response.json() as { ok: boolean; error?: string }
    if (!result.ok) {
      throw new Error(`Slack API error: ${result.error ?? 'unknown error'}`)
    }

    return result
  }
}

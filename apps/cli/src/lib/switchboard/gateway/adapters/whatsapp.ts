/**
 * WhatsApp Adapter — Bridges WhatsApp to the switchboard.
 *
 * Uses the WhatsApp Cloud API (Meta Business Platform) for
 * sending and receiving messages via webhooks.
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
import { formatWhatsAppText } from '../formatter.js'
import { verifyAuth } from '../auth.js'

// =============================================================================
// Types
// =============================================================================

export interface WhatsAppAdapterOptions {
  credentials: GatewayCredentials
  /** WhatsApp Business phone number ID. */
  phoneNumberId: string
  /** Webhook verification token (for GET verification requests). */
  verifyToken: string
  /** Callback when an inbound message is received. */
  onMessage?: (message: InboundMessage) => void | Promise<void>
  /** Logger function. */
  log?: (msg: string) => void
}

/** WhatsApp Cloud API webhook payload. */
interface WhatsAppWebhookPayload {
  object: string
  entry?: Array<{
    id: string
    changes?: Array<{
      field: string
      value?: {
        messaging_product?: string
        metadata?: {
          display_phone_number?: string
          phone_number_id?: string
        }
        contacts?: Array<{
          profile?: { name?: string }
          wa_id?: string
        }>
        messages?: Array<{
          from?: string
          id?: string
          timestamp?: string
          type?: string
          text?: { body?: string }
        }>
      }
    }>
  }>
}

// =============================================================================
// WhatsAppAdapter
// =============================================================================

export class WhatsAppAdapter implements GatewayAdapter {
  readonly platform = 'whatsapp' as const
  private _state: AdapterState = 'stopped'
  private credentials: GatewayCredentials
  private phoneNumberId: string
  private verifyToken: string
  private onMessage: ((message: InboundMessage) => void | Promise<void>) | undefined
  private log: (msg: string) => void

  constructor(options: WhatsAppAdapterOptions) {
    this.credentials = options.credentials
    this.phoneNumberId = options.phoneNumberId
    this.verifyToken = options.verifyToken
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
      throw new Error('WhatsApp adapter requires a botToken (access token)')
    }

    if (!this.phoneNumberId) {
      this._state = 'error'
      throw new Error('WhatsApp adapter requires a phoneNumberId')
    }

    this.log('whatsapp: adapter started')
    this._state = 'connected'
  }

  async stop(): Promise<void> {
    this._state = 'stopped'
    this.log('whatsapp: adapter stopped')
  }

  // ===========================================================================
  // Sending
  // ===========================================================================

  async send(message: OutboundMessage): Promise<void> {
    let text = message.text
    if (message.blocks && message.blocks.length > 0) {
      text = formatWhatsAppText(message.blocks)
    }

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: message.channelId, // WhatsApp phone number
      type: 'text',
      text: { body: text },
    }

    await this.callWhatsAppApi(payload)
  }

  // ===========================================================================
  // Verification
  // ===========================================================================

  async verify(headers: Record<string, string>, body: string): Promise<AuthResult> {
    return verifyAuth(this.credentials, headers, body)
  }

  /**
   * Handle a WhatsApp webhook verification request (GET).
   *
   * Meta sends a GET request with a challenge to verify the webhook URL.
   * See: https://developers.facebook.com/docs/graph-api/webhooks/getting-started
   */
  handleVerification(queryParams: Record<string, string>): {
    status: number
    body: string
  } {
    const mode = queryParams['hub.mode']
    const token = queryParams['hub.verify_token']
    const challenge = queryParams['hub.challenge']

    if (mode === 'subscribe' && token === this.verifyToken && challenge) {
      return { status: 200, body: challenge }
    }

    return { status: 403, body: 'Forbidden' }
  }

  // ===========================================================================
  // Inbound Parsing
  // ===========================================================================

  /**
   * Parse a WhatsApp webhook payload into InboundMessages.
   *
   * A single webhook can contain multiple messages across multiple entries.
   * Returns all parsed messages.
   */
  parseWebhookPayload(payload: WhatsAppWebhookPayload): InboundMessage[] {
    const messages: InboundMessage[] = []

    if (payload.object !== 'whatsapp_business_account') return messages

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== 'messages') continue
        const value = change.value
        if (!value?.messages) continue

        // Build contact lookup
        const contacts = new Map<string, string>()
        for (const contact of value.contacts ?? []) {
          if (contact.wa_id && contact.profile?.name) {
            contacts.set(contact.wa_id, contact.profile.name)
          }
        }

        for (const msg of value.messages) {
          if (msg.type !== 'text' || !msg.text?.body || !msg.from) continue

          messages.push({
            platformMessageId: msg.id ?? crypto.randomUUID(),
            platform: 'whatsapp',
            senderId: msg.from,
            senderName: contacts.get(msg.from),
            channelId: msg.from, // WhatsApp uses sender phone as channel
            text: msg.text.body,
            timestamp: msg.timestamp
              ? new Date(parseInt(msg.timestamp, 10) * 1000).toISOString()
              : new Date().toISOString(),
          })
        }
      }
    }

    return messages
  }

  /**
   * Handle a raw WhatsApp webhook request (POST).
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

    let payload: WhatsAppWebhookPayload
    try {
      payload = JSON.parse(body) as WhatsAppWebhookPayload
    } catch {
      return { status: 400, body: { error: 'Invalid JSON' } }
    }

    // Parse and forward all messages
    const messages = this.parseWebhookPayload(payload)
    for (const message of messages) {
      if (this.onMessage) {
        const userAuth = verifyAuth(this.credentials, headers, body, message.senderId)
        if (userAuth.authorized) {
          await this.onMessage(message)
        }
      }
    }

    // WhatsApp requires a 200 response
    return { status: 200, body: { ok: true } }
  }

  // ===========================================================================
  // WhatsApp Cloud API
  // ===========================================================================

  private async callWhatsAppApi(payload: Record<string, unknown>): Promise<unknown> {
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${this.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.credentials.botToken}`,
        },
        body: JSON.stringify(payload),
      },
    )

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`WhatsApp API error (${response.status}): ${text}`)
    }

    return response.json()
  }
}

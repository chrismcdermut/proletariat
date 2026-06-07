/**
 * Switchboard Client — Message sending and receiving.
 *
 * The client is the primary API for switchboard consumers. It wraps
 * SwitchboardDB operations and adds:
 *
 * - cast(): fire-and-forget messaging
 * - call(): request/reply with timeout
 * - reply(): respond to a call
 * - publish(): event fanout to topic subscribers
 * - poll(): check for inbound messages
 * - subscribe()/unsubscribe(): manage topic subscriptions
 *
 * The client also connects to the Unix domain socket server for
 * low-latency wakeup notifications, falling back to polling.
 *
 * See: PRLT-1371
 */

import * as net from 'node:net'
import { SwitchboardDB, getSwitchboardSocketPath } from './db.js'
import {
  type SwitchboardAddress,
  type SwitchboardMessage,
  type SwitchboardSubscription,
  type SendMessageOptions,
  type CallOptions,
  type CallResult,
  addressKey,
} from './types.js'

// =============================================================================
// Client Options
// =============================================================================

export interface SwitchboardClientOptions {
  /** The address of this client (who we are). */
  address: SwitchboardAddress
  /** Path to switchboard.db (defaults to ~/.proletariat/switchboard.db). */
  dbPath?: string
  /** Path to switchboard.sock (defaults to ~/.proletariat/switchboard.sock). */
  socketPath?: string
  /** Polling interval in ms when socket is unavailable (default: 500). */
  pollIntervalMs?: number
  /** Callback invoked when a message arrives. */
  onMessage?: (message: SwitchboardMessage) => void | Promise<void>
  /** Logger function. */
  log?: (msg: string) => void
}

// =============================================================================
// SwitchboardClient
// =============================================================================

export class SwitchboardClient {
  readonly address: SwitchboardAddress
  private db: SwitchboardDB
  private socketPath: string
  private pollIntervalMs: number
  private onMessage: ((message: SwitchboardMessage) => void | Promise<void>) | undefined
  private log: (msg: string) => void
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private socketClient: net.Socket | null = null
  private connected = false
  private closed = false

  constructor(options: SwitchboardClientOptions) {
    this.address = options.address
    this.db = new SwitchboardDB(options.dbPath)
    this.socketPath = options.socketPath ?? getSwitchboardSocketPath()
    this.pollIntervalMs = options.pollIntervalMs ?? 500
    this.onMessage = options.onMessage
    this.log = options.log ?? (() => {})
  }

  // ===========================================================================
  // Sending
  // ===========================================================================

  /**
   * Fire-and-forget message. At-least-once delivery, TTL 1hr default.
   */
  cast(options: SendMessageOptions): SwitchboardMessage {
    const msg = this.db.enqueue({ ...options, pattern: 'cast', from: options.from ?? this.address })
    this.notifyServer(msg)
    return msg
  }

  /**
   * Request/reply. Sends a call message and waits for a reply.
   * Returns the reply or times out.
   */
  async call(options: CallOptions): Promise<CallResult> {
    const msg = this.db.enqueue({ ...options, pattern: 'call', from: options.from ?? this.address })
    this.notifyServer(msg)

    const timeoutMs = options.timeoutMs ?? 30000
    const pollMs = Math.min(this.pollIntervalMs, 100)
    const deadline = Date.now() + timeoutMs

    while (Date.now() < deadline) {
      const reply = this.db.getReply(msg.id)
      if (reply) {
        this.db.markDelivered(reply.id)
        return { success: true, reply, timedOut: false }
      }
      await sleep(pollMs)
    }

    // Mark the call as failed on timeout
    this.db.markFailed(msg.id)
    return { success: false, reply: null, timedOut: true }
  }

  /**
   * Reply to a call message.
   */
  reply(correlationId: string, to: SwitchboardAddress, type: string, payload: unknown): SwitchboardMessage {
    const msg = this.db.enqueue({
      pattern: 'reply',
      from: this.address,
      to,
      type,
      payload,
      correlationId,
    })
    this.notifyServer(msg)
    return msg
  }

  /**
   * Publish an event to a topic. Fans out to all subscribers.
   */
  publish(topic: string, type: string, payload: unknown): SwitchboardMessage {
    const msg = this.db.enqueue({
      pattern: 'event',
      from: this.address,
      type,
      payload,
      topic,
    })
    this.notifyServer(msg)
    return msg
  }

  // ===========================================================================
  // Receiving
  // ===========================================================================

  /**
   * Poll for pending messages addressed to this client.
   * Marks retrieved messages as delivered.
   */
  poll(limit: number = 50): SwitchboardMessage[] {
    const messages = this.db.getPendingFor(this.address, limit)
    for (const msg of messages) {
      this.db.markDelivered(msg.id)
    }
    return messages
  }

  /**
   * Poll for new event messages on subscribed topics.
   * Uses cursors to avoid re-processing.
   */
  pollEvents(): SwitchboardMessage[] {
    const subs = this.db.getSubscriptionsFor(this.address)
    const allMessages: SwitchboardMessage[] = []
    const consumerKey = addressKey(this.address)

    for (const sub of subs) {
      const cursor = this.db.getCursor(`${consumerKey}:${sub.topic}`)
      const messages = this.db.getPendingEvents(sub.topic, cursor.lastRowId)

      if (messages.length > 0) {
        allMessages.push(...messages)
        this.db.advanceCursor(
          `${consumerKey}:${sub.topic}`,
          cursor.lastRowId + messages.length
        )
      }
    }

    return allMessages
  }

  // ===========================================================================
  // Subscriptions
  // ===========================================================================

  /**
   * Subscribe to a topic for event messages.
   */
  subscribe(topic: string): SwitchboardSubscription {
    return this.db.subscribe(topic, this.address)
  }

  /**
   * Unsubscribe from a topic.
   */
  unsubscribe(topic: string): void {
    this.db.unsubscribe(topic, this.address)
  }

  /**
   * List this client's active subscriptions.
   */
  listSubscriptions(): SwitchboardSubscription[] {
    return this.db.getSubscriptionsFor(this.address)
  }

  // ===========================================================================
  // Status
  // ===========================================================================

  /**
   * Get switchboard status — message counts, subscription counts, etc.
   */
  status(): {
    address: SwitchboardAddress
    connected: boolean
    messageCounts: Record<string, number>
    subscriptionCount: number
  } {
    return {
      address: this.address,
      connected: this.connected,
      messageCounts: this.db.countByStatus(),
      subscriptionCount: this.db.getSubscriptionsFor(this.address).length,
    }
  }

  // ===========================================================================
  // Polling Loop
  // ===========================================================================

  /**
   * Start the background polling loop.
   * Tries to connect to the socket server for push notifications.
   * Falls back to interval-based polling.
   */
  startPolling(): void {
    if (this.pollTimer) return

    // Try socket connection for push notifications
    this.tryConnect()

    // Start polling as fallback / supplement
    this.pollTimer = setInterval(() => {
      this.doPollCycle()
    }, this.pollIntervalMs)
  }

  /**
   * Stop the background polling loop.
   */
  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    this.disconnectSocket()
  }

  private async doPollCycle(): Promise<void> {
    if (this.closed) return

    try {
      // Poll for direct messages
      const messages = this.poll()
      for (const msg of messages) {
        if (this.onMessage) {
          try {
            await this.onMessage(msg)
          } catch {
            // onMessage handler errors are non-fatal
          }
        }
      }

      // Poll for event messages
      const events = this.pollEvents()
      for (const msg of events) {
        if (this.onMessage) {
          try {
            await this.onMessage(msg)
          } catch {
            // onMessage handler errors are non-fatal
          }
        }
      }
    } catch {
      // Poll cycle errors are non-fatal — will retry next interval
    }
  }

  // ===========================================================================
  // Socket Connection (wakeup notifications)
  // ===========================================================================

  private tryConnect(): void {
    if (this.connected || this.closed) return

    try {
      this.socketClient = net.createConnection(this.socketPath, () => {
        this.connected = true
        this.log(`switchboard: connected to ${this.socketPath}`)

        // Register our address with the server
        const registration = JSON.stringify({
          type: 'register',
          address: this.address,
        })
        this.socketClient!.write(registration + '\n')
      })

      this.socketClient.on('data', (data) => {
        // Server sends wakeup notifications as newline-delimited JSON
        const lines = data.toString().split('\n').filter(Boolean)
        for (const line of lines) {
          try {
            const notification = JSON.parse(line)
            if (notification.type === 'wakeup') {
              // Trigger immediate poll on wakeup
              this.doPollCycle()
            }
          } catch {
            // Malformed notification — ignore
          }
        }
      })

      this.socketClient.on('error', () => {
        this.connected = false
        // Socket not available — polling will handle it
      })

      this.socketClient.on('close', () => {
        this.connected = false
        // Attempt reconnect after a delay if not closed
        if (!this.closed) {
          setTimeout(() => this.tryConnect(), 5000)
        }
      })
    } catch {
      // Socket connection failed — polling fallback is active
    }
  }

  private disconnectSocket(): void {
    if (this.socketClient) {
      this.socketClient.destroy()
      this.socketClient = null
      this.connected = false
    }
  }

  /**
   * Notify the socket server that a new message was enqueued.
   * Best-effort — falls back silently if socket is unavailable.
   */
  private notifyServer(msg: SwitchboardMessage): void {
    if (!this.socketClient || !this.connected) return

    try {
      const notification = JSON.stringify({
        type: 'enqueued',
        messageId: msg.id,
        to: msg.to,
        topic: msg.topic,
      })
      this.socketClient.write(notification + '\n')
    } catch {
      // Best-effort notification
    }
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Close the client — stops polling, disconnects socket, closes DB.
   */
  close(): void {
    this.closed = true
    this.stopPolling()
    this.db.close()
  }
}

// =============================================================================
// Helpers
// =============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

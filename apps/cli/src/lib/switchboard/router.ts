/**
 * Switchboard Router — Message routing and pub/sub fanout.
 *
 * The router is a higher-level abstraction that sits between the
 * SwitchboardServer and SwitchboardDB. It handles:
 *
 * - Routing direct messages (cast/call) to recipient addresses
 * - Fan-out of event messages to topic subscribers
 * - Creating per-subscriber copies of event messages
 * - Tracking delivery and managing retries
 *
 * The daemon runs the router as part of its event loop.
 *
 * See: PRLT-1371
 */

import { SwitchboardDB } from './db.js'
import { SwitchboardServer } from './server.js'

// =============================================================================
// Types
// =============================================================================

export interface SwitchboardRouterOptions {
  /** The switchboard database. */
  db: SwitchboardDB
  /** The socket server for push notifications. */
  server?: SwitchboardServer
  /** Processing interval in ms (default: 200). */
  processIntervalMs?: number
  /** Logger function. */
  log?: (msg: string) => void
}

export interface RouteResult {
  processed: number
  delivered: number
  fanouts: number
  errors: number
}

// =============================================================================
// SwitchboardRouter
// =============================================================================

export class SwitchboardRouter {
  private db: SwitchboardDB
  private server: SwitchboardServer | undefined
  private processIntervalMs: number
  private log: (msg: string) => void
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false

  constructor(options: SwitchboardRouterOptions) {
    this.db = options.db
    this.server = options.server
    this.processIntervalMs = options.processIntervalMs ?? 200
    this.log = options.log ?? (() => {})
  }

  /**
   * Start the routing loop.
   */
  start(): void {
    if (this.timer) return
    this.running = true

    this.timer = setInterval(() => {
      this.processMessages()
    }, this.processIntervalMs)

    this.log('switchboard router started')
  }

  /**
   * Stop the routing loop.
   */
  stop(): void {
    this.running = false
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.log('switchboard router stopped')
  }

  /**
   * Process pending messages — route direct messages and fan out events.
   * Can be called manually for testing or as part of a daemon loop.
   */
  processMessages(): RouteResult {
    const result: RouteResult = { processed: 0, delivered: 0, fanouts: 0, errors: 0 }

    try {
      // 1. Expire old messages
      this.db.expireMessages()

      // 2. Process pending direct messages (cast, call, reply)
      const directMessages = this.db.listMessages({
        status: 'pending',
        limit: 100,
      })

      for (const msg of directMessages) {
        if (msg.pattern === 'event') {
          // Events are handled via fanout below
          continue
        }

        result.processed++

        if (msg.to) {
          // Notify the target via socket server
          if (this.server) {
            this.server.notifyEnqueued(msg.to, null)
          }
          result.delivered++
        }
      }

      // 3. Process pending event messages — fan out to subscribers
      const eventMessages = this.db.listMessages({
        status: 'pending',
        pattern: 'event',
        limit: 100,
      })

      for (const msg of eventMessages) {
        if (!msg.topic) continue

        result.processed++

        const subscribers = this.db.getSubscribers(msg.topic)
        if (subscribers.length > 0) {
          result.fanouts += subscribers.length

          // Notify all subscribers via socket server
          if (this.server) {
            this.server.notifyEnqueued(null, msg.topic)
          }
        }

        // Mark the original event message as delivered
        // (subscribers read it via cursor-based polling)
        this.db.markDelivered(msg.id)
        result.delivered++
      }
    } catch (err) {
      result.errors++
      this.log(`switchboard router error: ${err instanceof Error ? err.message : String(err)}`)
    }

    return result
  }

  /**
   * Get router status.
   */
  status(): {
    running: boolean
    messageCounts: Record<string, number>
  } {
    return {
      running: this.running,
      messageCounts: this.db.countByStatus(),
    }
  }
}

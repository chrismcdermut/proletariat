/**
 * Switchboard Garbage Collection
 *
 * Retention policies:
 * - Delivered messages: 24 hours
 * - Pending messages: until TTL expires
 * - Failed messages: 7 days
 * - Inactive subscriptions: 30 days
 *
 * GC runs as a daemon task on a configurable interval.
 *
 * See: PRLT-1371
 */

import { SwitchboardDB } from './db.js'

// =============================================================================
// Types
// =============================================================================

export interface SwitchboardGCOptions {
  /** The switchboard database. */
  db: SwitchboardDB
  /** GC interval in ms (default: 300000 — 5 minutes). */
  intervalMs?: number
  /** Delivered message retention in hours (default: 24). */
  deliveredRetentionHours?: number
  /** Failed/expired message retention in days (default: 7). */
  failedRetentionDays?: number
  /** Inactive subscription retention in days (default: 30). */
  subscriptionRetentionDays?: number
  /** Logger function. */
  log?: (msg: string) => void
}

export interface GCResult {
  messagesExpired: number
  deliveredPurged: number
  expiredPurged: number
  failedPurged: number
  subscriptionsPurged: number
}

// =============================================================================
// SwitchboardGC
// =============================================================================

export class SwitchboardGC {
  private db: SwitchboardDB
  private intervalMs: number
  private deliveredRetentionHours: number
  private failedRetentionDays: number
  private subscriptionRetentionDays: number
  private log: (msg: string) => void
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(options: SwitchboardGCOptions) {
    this.db = options.db
    this.intervalMs = options.intervalMs ?? 300000
    this.deliveredRetentionHours = options.deliveredRetentionHours ?? 24
    this.failedRetentionDays = options.failedRetentionDays ?? 7
    this.subscriptionRetentionDays = options.subscriptionRetentionDays ?? 30
    this.log = options.log ?? (() => {})
  }

  /**
   * Start the GC timer.
   */
  start(): void {
    if (this.timer) return

    // Run immediately on start
    this.runCycle()

    this.timer = setInterval(() => {
      this.runCycle()
    }, this.intervalMs)

    this.log('switchboard GC started')
  }

  /**
   * Stop the GC timer.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.log('switchboard GC stopped')
  }

  /**
   * Run a single GC cycle. Can be called manually for testing.
   */
  runCycle(): GCResult {
    try {
      const messagesExpired = this.db.expireMessages()
      const deliveredPurged = this.db.purgeDelivered(this.deliveredRetentionHours)
      const expiredPurged = this.db.purgeExpired(this.failedRetentionDays)
      const failedPurged = this.db.purgeFailed(this.failedRetentionDays)
      const subscriptionsPurged = this.db.purgeInactiveSubscriptions(this.subscriptionRetentionDays)

      const total = messagesExpired + deliveredPurged + expiredPurged + failedPurged + subscriptionsPurged
      if (total > 0) {
        this.log(
          `switchboard GC: expired=${messagesExpired} delivered=${deliveredPurged} ` +
          `failed=${failedPurged} subs=${subscriptionsPurged}`
        )
      }

      return { messagesExpired, deliveredPurged, expiredPurged, failedPurged, subscriptionsPurged }
    } catch (err) {
      this.log(`switchboard GC error: ${err instanceof Error ? err.message : String(err)}`)
      return { messagesExpired: 0, deliveredPurged: 0, expiredPurged: 0, failedPurged: 0, subscriptionsPurged: 0 }
    }
  }
}

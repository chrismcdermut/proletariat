/**
 * Switchboard Database — Durable message queue storage.
 *
 * Lives at ~/.proletariat/switchboard.db — separate from machine.db so
 * message traffic can be wiped without losing execution history.
 *
 * Follows the same DAL pattern as MachineDB: DatabaseDriver abstraction,
 * Row/Record type separation, and idempotent schema initialization.
 *
 * See: PRLT-1371
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { randomUUID } from 'node:crypto'
import { type DatabaseDriver, openDriver } from '../database/driver.js'
import { SWITCHBOARD_SCHEMA_SQL } from './schema.js'
import {
  type SwitchboardMessage,
  type SwitchboardSubscription,
  type SwitchboardCursor,
  type SwitchboardAddress,
  type SwitchboardPattern,
  type SwitchboardMessageStatus,
  type MessageRow,
  type SubscriptionRow,
  type CursorRow,
  type SendMessageOptions,
  rowToMessage,
  rowToSubscription,
  rowToCursor,
  addressKey,
  DEFAULT_TTL,
} from './types.js'

// =============================================================================
// Path
// =============================================================================

/**
 * Get the default switchboard DB path: ~/.proletariat/switchboard.db
 */
export function getSwitchboardDbPath(): string {
  const dir = path.join(os.homedir(), '.proletariat')
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, 'switchboard.db')
}

/**
 * Get the default switchboard socket path: ~/.proletariat/switchboard.sock
 */
export function getSwitchboardSocketPath(): string {
  return path.join(os.homedir(), '.proletariat', 'switchboard.sock')
}

// =============================================================================
// SwitchboardDB
// =============================================================================

export class SwitchboardDB {
  private db: DatabaseDriver

  constructor(dbPath?: string) {
    this.db = openDriver(dbPath ?? getSwitchboardDbPath(), {
      foreignKeys: false,
      busyTimeout: 5000,
    })
    this.ensureSchema()
  }

  private ensureSchema(): void {
    this.db.exec(SWITCHBOARD_SCHEMA_SQL)
  }

  // ===========================================================================
  // Messages — CRUD
  // ===========================================================================

  /**
   * Enqueue a new message. Returns the created message.
   */
  enqueue(options: SendMessageOptions & { pattern: SwitchboardPattern }): SwitchboardMessage {
    const id = `MSG-${randomUUID().substring(0, 8).toUpperCase()}`
    const now = new Date().toISOString()
    const ttl = options.ttlSeconds ?? DEFAULT_TTL[options.pattern]
    const payload = typeof options.payload === 'string'
      ? options.payload
      : JSON.stringify(options.payload ?? {})

    this.db.prepare(`
      INSERT INTO messages (
        id, pattern, from_kind, from_id, from_container_id,
        to_kind, to_id, to_container_id,
        correlation_id, topic, type, payload,
        status, created_at, ttl_seconds, retries
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, 0)
    `).run(
      id,
      options.pattern,
      options.from.kind,
      options.from.id,
      options.from.containerId ?? null,
      options.to?.kind ?? null,
      options.to?.id ?? null,
      options.to?.containerId ?? null,
      options.correlationId ?? null,
      options.topic ?? null,
      options.type,
      payload,
      now,
      ttl,
    )

    return this.getMessage(id)!
  }

  /**
   * Get a single message by ID.
   */
  getMessage(id: string): SwitchboardMessage | null {
    const row = this.db.prepare<MessageRow>(
      'SELECT rowid, * FROM messages WHERE id = ?'
    ).get(id)
    return row ? rowToMessage(row) : null
  }

  /**
   * Get pending messages addressed to a specific recipient.
   * Used by consumers to poll for inbound messages.
   */
  getPendingFor(addr: SwitchboardAddress, limit: number = 50): SwitchboardMessage[] {
    const rows = this.db.prepare<MessageRow>(
      `SELECT rowid, * FROM messages
       WHERE to_kind = ? AND to_id = ? AND status = 'pending'
       ORDER BY rowid ASC LIMIT ?`
    ).all(addr.kind, addr.id, limit) as unknown as MessageRow[]
    return rows.map(rowToMessage)
  }

  /**
   * Get pending event messages for a topic.
   * Used to fan out events to subscribers.
   */
  getPendingEvents(topic: string, afterRowId: number = 0, limit: number = 100): SwitchboardMessage[] {
    const rows = this.db.prepare<MessageRow>(
      `SELECT rowid, * FROM messages
       WHERE topic = ? AND pattern = 'event' AND status = 'pending' AND rowid > ?
       ORDER BY rowid ASC LIMIT ?`
    ).all(topic, afterRowId, limit) as unknown as MessageRow[]
    return rows.map(rowToMessage)
  }

  /**
   * Get a reply to a call by correlation ID.
   */
  getReply(correlationId: string): SwitchboardMessage | null {
    const row = this.db.prepare<MessageRow>(
      `SELECT rowid, * FROM messages
       WHERE correlation_id = ? AND pattern = 'reply'
       ORDER BY rowid DESC LIMIT 1`
    ).get(correlationId)
    return row ? rowToMessage(row) : null
  }

  /**
   * Mark a message as delivered.
   */
  markDelivered(id: string): void {
    const now = new Date().toISOString()
    this.db.prepare(
      "UPDATE messages SET status = 'delivered', delivered_at = ? WHERE id = ?"
    ).run(now, id)
  }

  /**
   * Mark a message as failed.
   */
  markFailed(id: string): void {
    this.db.prepare(
      "UPDATE messages SET status = 'failed', retries = retries + 1 WHERE id = ?"
    ).run(id)
  }

  /**
   * Mark expired messages based on TTL.
   * Returns the number of messages expired.
   */
  expireMessages(): number {
    const now = new Date().toISOString()
    const result = this.db.prepare(`
      UPDATE messages SET status = 'expired'
      WHERE status = 'pending'
        AND ttl_seconds IS NOT NULL
        AND datetime(created_at, '+' || ttl_seconds || ' seconds') < datetime(?)
    `).run(now)
    return result.changes
  }

  /**
   * List messages with optional filters.
   */
  listMessages(filter?: {
    status?: SwitchboardMessageStatus
    pattern?: SwitchboardPattern
    topic?: string
    limit?: number
  }): SwitchboardMessage[] {
    let query = 'SELECT rowid, * FROM messages WHERE 1=1'
    const params: (string | number)[] = []

    if (filter?.status) {
      query += ' AND status = ?'
      params.push(filter.status)
    }
    if (filter?.pattern) {
      query += ' AND pattern = ?'
      params.push(filter.pattern)
    }
    if (filter?.topic) {
      query += ' AND topic = ?'
      params.push(filter.topic)
    }

    query += ' ORDER BY rowid DESC'

    if (filter?.limit) {
      query += ' LIMIT ?'
      params.push(filter.limit)
    }

    const rows = this.db.prepare(query).all(...params) as unknown as MessageRow[]
    return rows.map(rowToMessage)
  }

  /**
   * Count messages by status.
   */
  countByStatus(): Record<SwitchboardMessageStatus, number> {
    const rows = this.db.prepare<{ status: string; n: number }>(
      'SELECT status, COUNT(*) as n FROM messages GROUP BY status'
    ).all() as unknown as { status: string; n: number }[]

    const counts: Record<string, number> = { pending: 0, delivered: 0, expired: 0, failed: 0 }
    for (const row of rows) {
      counts[row.status] = row.n
    }
    return counts as Record<SwitchboardMessageStatus, number>
  }

  // ===========================================================================
  // Subscriptions — pub/sub registry
  // ===========================================================================

  /**
   * Subscribe an address to a topic. Returns the subscription.
   * Idempotent — reactivates if already exists.
   */
  subscribe(topic: string, subscriber: SwitchboardAddress): SwitchboardSubscription {
    const existing = this.db.prepare<SubscriptionRow>(
      `SELECT * FROM subscriptions
       WHERE topic = ? AND subscriber_kind = ? AND subscriber_id = ?`
    ).get(topic, subscriber.kind, subscriber.id)

    if (existing) {
      this.db.prepare(
        'UPDATE subscriptions SET active = 1 WHERE id = ?'
      ).run(existing.id)
      return rowToSubscription({ ...existing, active: 1 })
    }

    const id = `SUB-${randomUUID().substring(0, 8).toUpperCase()}`
    const now = new Date().toISOString()

    this.db.prepare(`
      INSERT INTO subscriptions (
        id, topic, subscriber_kind, subscriber_id, subscriber_container_id,
        created_at, active
      ) VALUES (?, ?, ?, ?, ?, ?, 1)
    `).run(id, topic, subscriber.kind, subscriber.id, subscriber.containerId ?? null, now)

    return this.getSubscription(id)!
  }

  /**
   * Unsubscribe from a topic (marks inactive, keeps record).
   */
  unsubscribe(topic: string, subscriber: SwitchboardAddress): void {
    this.db.prepare(
      `UPDATE subscriptions SET active = 0
       WHERE topic = ? AND subscriber_kind = ? AND subscriber_id = ?`
    ).run(topic, subscriber.kind, subscriber.id)
  }

  /**
   * Get a subscription by ID.
   */
  getSubscription(id: string): SwitchboardSubscription | null {
    const row = this.db.prepare<SubscriptionRow>(
      'SELECT * FROM subscriptions WHERE id = ?'
    ).get(id)
    return row ? rowToSubscription(row) : null
  }

  /**
   * Get all active subscribers for a topic.
   */
  getSubscribers(topic: string): SwitchboardSubscription[] {
    const rows = this.db.prepare<SubscriptionRow>(
      'SELECT * FROM subscriptions WHERE topic = ? AND active = 1'
    ).all(topic) as unknown as SubscriptionRow[]
    return rows.map(rowToSubscription)
  }

  /**
   * List all subscriptions for a subscriber address.
   */
  getSubscriptionsFor(subscriber: SwitchboardAddress): SwitchboardSubscription[] {
    const rows = this.db.prepare<SubscriptionRow>(
      `SELECT * FROM subscriptions
       WHERE subscriber_kind = ? AND subscriber_id = ? AND active = 1`
    ).all(subscriber.kind, subscriber.id) as unknown as SubscriptionRow[]
    return rows.map(rowToSubscription)
  }

  // ===========================================================================
  // Cursors — consumer read positions
  // ===========================================================================

  /**
   * Get or create a cursor for a consumer.
   */
  getCursor(consumerId: string): SwitchboardCursor {
    const row = this.db.prepare<CursorRow>(
      'SELECT * FROM cursors WHERE consumer_id = ?'
    ).get(consumerId)

    if (row) return rowToCursor(row)

    const now = new Date().toISOString()
    this.db.prepare(
      'INSERT INTO cursors (consumer_id, last_rowid, updated_at) VALUES (?, 0, ?)'
    ).run(consumerId, now)

    return { consumerId, lastRowId: 0, updatedAt: now }
  }

  /**
   * Advance a cursor to a new position.
   */
  advanceCursor(consumerId: string, lastRowId: number): void {
    const now = new Date().toISOString()
    this.db.prepare(
      `INSERT INTO cursors (consumer_id, last_rowid, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(consumer_id) DO UPDATE SET last_rowid = ?, updated_at = ?`
    ).run(consumerId, lastRowId, now, lastRowId, now)
  }

  // ===========================================================================
  // Garbage Collection
  // ===========================================================================

  /**
   * Delete old delivered messages (older than retentionHours).
   * Returns the number of messages deleted.
   */
  purgeDelivered(retentionHours: number = 24): number {
    const cutoff = new Date(Date.now() - retentionHours * 60 * 60 * 1000).toISOString()
    const result = this.db.prepare(
      "DELETE FROM messages WHERE status = 'delivered' AND delivered_at < ?"
    ).run(cutoff)
    return result.changes
  }

  /**
   * Delete old expired messages (older than retentionDays).
   * Returns the number of messages deleted.
   */
  purgeExpired(retentionDays: number = 7): number {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString()
    const result = this.db.prepare(
      "DELETE FROM messages WHERE status = 'expired' AND created_at < ?"
    ).run(cutoff)
    return result.changes
  }

  /**
   * Delete old failed messages (older than retentionDays).
   * Returns the number of messages deleted.
   */
  purgeFailed(retentionDays: number = 7): number {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString()
    const result = this.db.prepare(
      "DELETE FROM messages WHERE status = 'failed' AND created_at < ?"
    ).run(cutoff)
    return result.changes
  }

  /**
   * Delete inactive subscriptions older than retentionDays.
   */
  purgeInactiveSubscriptions(retentionDays: number = 30): number {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString()
    const result = this.db.prepare(
      'DELETE FROM subscriptions WHERE active = 0 AND created_at < ?'
    ).run(cutoff)
    return result.changes
  }

  /**
   * Run all garbage collection passes. Returns summary.
   */
  gc(): { delivered: number; expired: number; failed: number; subscriptions: number; messagesExpired: number } {
    const messagesExpired = this.expireMessages()
    const delivered = this.purgeDelivered()
    const expired = this.purgeExpired()
    const failed = this.purgeFailed()
    const subscriptions = this.purgeInactiveSubscriptions()
    return { delivered, expired, failed, subscriptions, messagesExpired }
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  close(): void {
    this.db.close()
  }

  get isOpen(): boolean {
    return this.db.open
  }
}

/**
 * Ensure the switchboard database exists and has its schema initialized.
 * Safe to call repeatedly (idempotent).
 */
export function ensureSwitchboardDb(): void {
  const db = new SwitchboardDB()
  db.close()
}

/**
 * Analytics Queue Storage
 *
 * Manages offline event batching using SQLite.
 * Events are queued locally and batch-sent when online.
 */

import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { QueuedEvent } from './types.js'
import { PMO_TABLES } from '../pmo/schema.js'

const QUEUE_TABLE = PMO_TABLES.analytics_queue

// Events older than 7 days are dropped
const MAX_EVENT_AGE_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Ensure analytics queue table exists (for migration from older databases)
 */
export function ensureAnalyticsQueueTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${QUEUE_TABLE} (
      id TEXT PRIMARY KEY,
      event TEXT NOT NULL,
      properties TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pmo_analytics_queue_created ON ${QUEUE_TABLE}(created_at);
  `)
}

/**
 * Add an event to the offline queue
 */
export function queueEvent(
  db: Database.Database,
  event: string,
  properties: Record<string, string | number | boolean | null>
): void {
  ensureAnalyticsQueueTable(db)

  const id = randomUUID()
  const now = Date.now()
  const propsJson = JSON.stringify(properties)

  db.prepare(`
    INSERT INTO ${QUEUE_TABLE} (id, event, properties, created_at)
    VALUES (?, ?, ?, ?)
  `).run(id, event, propsJson, now)
}

/**
 * Get all queued events (oldest first)
 */
export function getQueuedEvents(db: Database.Database, limit?: number): QueuedEvent[] {
  ensureAnalyticsQueueTable(db)

  const query = limit
    ? `SELECT * FROM ${QUEUE_TABLE} ORDER BY created_at ASC LIMIT ?`
    : `SELECT * FROM ${QUEUE_TABLE} ORDER BY created_at ASC`

  const rows = limit
    ? db.prepare(query).all(limit)
    : db.prepare(query).all()

  return rows as QueuedEvent[]
}

/**
 * Get count of queued events
 */
export function getQueueCount(db: Database.Database): number {
  ensureAnalyticsQueueTable(db)

  const row = db.prepare(`SELECT COUNT(*) as count FROM ${QUEUE_TABLE}`).get() as { count: number }
  return row.count
}

/**
 * Remove events from the queue by their IDs
 */
export function removeEvents(db: Database.Database, eventIds: string[]): void {
  if (eventIds.length === 0) return

  ensureAnalyticsQueueTable(db)

  const placeholders = eventIds.map(() => '?').join(', ')
  db.prepare(`DELETE FROM ${QUEUE_TABLE} WHERE id IN (${placeholders})`).run(...eventIds)
}

/**
 * Remove all events from the queue
 */
export function clearQueue(db: Database.Database): void {
  ensureAnalyticsQueueTable(db)

  db.prepare(`DELETE FROM ${QUEUE_TABLE}`).run()
}

/**
 * Remove events older than the retention period (7 days)
 * Returns number of events purged
 */
export function purgeOldEvents(db: Database.Database): number {
  ensureAnalyticsQueueTable(db)

  const cutoff = Date.now() - MAX_EVENT_AGE_MS
  const result = db.prepare(`DELETE FROM ${QUEUE_TABLE} WHERE created_at < ?`).run(cutoff)
  return result.changes
}

/**
 * Get queue statistics
 */
export function getQueueStats(db: Database.Database): {
  totalEvents: number
  oldestEventAge: number | null
  newestEventAge: number | null
} {
  ensureAnalyticsQueueTable(db)

  const now = Date.now()

  const countRow = db.prepare(`SELECT COUNT(*) as count FROM ${QUEUE_TABLE}`).get() as { count: number }
  const oldestRow = db.prepare(`SELECT MIN(created_at) as oldest FROM ${QUEUE_TABLE}`).get() as { oldest: number | null }
  const newestRow = db.prepare(`SELECT MAX(created_at) as newest FROM ${QUEUE_TABLE}`).get() as { newest: number | null }

  return {
    totalEvents: countRow.count,
    oldestEventAge: oldestRow.oldest ? now - oldestRow.oldest : null,
    newestEventAge: newestRow.newest ? now - newestRow.newest : null,
  }
}

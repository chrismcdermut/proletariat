/**
 * Switchboard Database Schema
 *
 * Defines the SQLite schema for switchboard.db — the durable message queue.
 * Three tables: messages (the queue), subscriptions (pub/sub registry),
 * cursors (consumer read positions).
 *
 * This is a separate database from machine.db to allow independent WAL
 * and the ability to wipe message traffic without losing execution history.
 *
 * See: PRLT-1371
 */

/**
 * SQL to create the switchboard schema.
 * Idempotent — uses CREATE TABLE IF NOT EXISTS.
 */
export const SWITCHBOARD_SCHEMA_SQL = `
  -- Messages: the durable message queue
  CREATE TABLE IF NOT EXISTS messages (
    rowid INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    pattern TEXT NOT NULL CHECK(pattern IN ('cast', 'call', 'reply', 'event')),
    from_kind TEXT NOT NULL,
    from_id TEXT NOT NULL,
    from_container_id TEXT,
    to_kind TEXT,
    to_id TEXT,
    to_container_id TEXT,
    correlation_id TEXT,
    topic TEXT,
    type TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'delivered', 'expired', 'failed')),
    created_at TEXT NOT NULL,
    delivered_at TEXT,
    ttl_seconds INTEGER,
    retries INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);
  CREATE INDEX IF NOT EXISTS idx_messages_to ON messages(to_kind, to_id, status);
  CREATE INDEX IF NOT EXISTS idx_messages_correlation ON messages(correlation_id);
  CREATE INDEX IF NOT EXISTS idx_messages_topic ON messages(topic, status);
  CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);

  -- Subscriptions: pub/sub topic registry
  CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY,
    topic TEXT NOT NULL,
    subscriber_kind TEXT NOT NULL,
    subscriber_id TEXT NOT NULL,
    subscriber_container_id TEXT,
    created_at TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE INDEX IF NOT EXISTS idx_subscriptions_topic ON subscriptions(topic, active);
  CREATE INDEX IF NOT EXISTS idx_subscriptions_subscriber ON subscriptions(subscriber_kind, subscriber_id);

  -- Cursors: consumer read positions
  CREATE TABLE IF NOT EXISTS cursors (
    consumer_id TEXT PRIMARY KEY,
    last_rowid INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );
`

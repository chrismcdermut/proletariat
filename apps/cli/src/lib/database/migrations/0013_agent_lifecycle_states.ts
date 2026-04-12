/**
 * Migration 0013 — Agent lifecycle states
 *
 * Adds lifecycle state tracking columns to agent_work table.
 * Enables tracking of agent lifecycle events (spawned, idle, died, completed).
 */

import type { SqliteDatabase } from '../sqlite.js'
import type { Migration } from '../migrator.js'

export const agentLifecycleStates: Migration = {
  id: '0013',
  name: 'agent_lifecycle_states',
  up: (db: SqliteDatabase) => {
    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='agent_work'"
    ).get()
    if (!tableExists) return

    const tableInfo = db.prepare("PRAGMA table_info(agent_work)").all() as { name: string }[]

    if (!tableInfo.some(col => col.name === 'lifecycle_state')) {
      db.exec(
        "ALTER TABLE agent_work ADD COLUMN lifecycle_state TEXT DEFAULT 'active'"
      )
    }

    if (!tableInfo.some(col => col.name === 'last_heartbeat_at')) {
      db.exec(
        "ALTER TABLE agent_work ADD COLUMN last_heartbeat_at INTEGER"
      )
    }
  },
}

/**
 * Migration 0014 — Agent Work Lifecycle States
 *
 * Adds lifecycle tracking columns to agent_work for the orchestrate daemon.
 * - last_heartbeat: tracks when the agent last reported activity
 * - retries: tracks respawn attempts for on_agent_died hooks
 * - lifecycle_state: high-level state (healthy, idle, died, completed)
 */

import type Database from 'better-sqlite3'
import type { Migration } from '../migrator.js'

export const agentWorkLifecycle: Migration = {
  id: '0014',
  name: 'agent_work_lifecycle',
  up: (db: Database.Database) => {
    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='agent_work'"
    ).get()
    if (!tableExists) return

    const tableInfo = db.prepare("PRAGMA table_info(agent_work)").all() as { name: string }[]
    const existingCols = new Set(tableInfo.map(col => col.name))

    if (!existingCols.has('last_heartbeat')) {
      db.exec(
        "ALTER TABLE agent_work ADD COLUMN last_heartbeat TEXT"
      )
    }

    if (!existingCols.has('retries')) {
      db.exec(
        "ALTER TABLE agent_work ADD COLUMN retries INTEGER NOT NULL DEFAULT 0"
      )
    }

    if (!existingCols.has('lifecycle_state')) {
      db.exec(
        "ALTER TABLE agent_work ADD COLUMN lifecycle_state TEXT DEFAULT 'healthy' CHECK (lifecycle_state IN ('healthy', 'idle', 'died', 'completed'))"
      )
    }

    // Index for lifecycle state queries (used by orchestrate polling)
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_agent_work_lifecycle ON agent_work(lifecycle_state, status)"
    )
  },
}

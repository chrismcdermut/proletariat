/**
 * Migration 0023 — Add daemon role to agent_work
 *
 * Adds a `role` column to the agent_work table to distinguish between
 * worker, orchestrator, and daemon sessions. Daemons are long-running
 * infrastructure processes (reconciler, rebase coordinator, etc.) that
 * should not be pruned and survive orchestrator restarts.
 */

import type Database from 'better-sqlite3'
import type { Migration } from '../migrator.js'

export const addDaemonRole: Migration = {
  id: '0023',
  name: 'add_daemon_role',
  up: (db: Database.Database) => {
    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='agent_work'"
    ).get()
    if (!tableExists) return

    const tableInfo = db.prepare("PRAGMA table_info(agent_work)").all() as { name: string }[]
    if (tableInfo.some(col => col.name === 'role')) {
      return // Column already exists
    }

    db.exec("ALTER TABLE agent_work ADD COLUMN role TEXT NOT NULL DEFAULT 'worker'")
  },
}

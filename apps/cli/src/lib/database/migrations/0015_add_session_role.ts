/**
 * Migration 0015 — Add session role to agent_work
 *
 * Adds a `role` column to the agent_work table to distinguish between
 * workers, orchestrators, daemons, and headless sessions.
 *
 * Daemon-role sessions (like the reconciler) are long-running infrastructure
 * that should not be pruned and should be supervised by the orchestrator.
 */

import type { SqliteDatabase } from '../sqlite.js'
import type { Migration } from '../migrator.js'

export const addSessionRole: Migration = {
  id: '0015',
  name: 'add_session_role',
  up: (db: SqliteDatabase) => {
    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='agent_work'"
    ).get()
    if (!tableExists) return

    const tableInfo = db.prepare("PRAGMA table_info(agent_work)").all() as { name: string }[]
    const existingCols = new Set(tableInfo.map(col => col.name))

    if (!existingCols.has('role')) {
      db.exec(
        "ALTER TABLE agent_work ADD COLUMN role TEXT NOT NULL DEFAULT 'worker'"
      )
    }
  },
}

/**
 * Migration 0008 — Add mount_mode column to agents table
 *
 * Supports worktree vs clone mount modes for agent repositories.
 * Defaults to 'worktree' for backward compatibility.
 */

import type { SqliteDatabase } from '../sqlite.js'
import type { Migration } from '../migrator.js'

export const addAgentMountMode: Migration = {
  id: '0008',
  name: 'add_agent_mount_mode',
  up: (db: SqliteDatabase) => {
    const tableInfo = db.prepare("PRAGMA table_info(agents)").all() as { name: string }[]
    if (tableInfo.some(col => col.name === 'mount_mode')) {
      return // Column already exists
    }

    db.exec(
      "ALTER TABLE agents ADD COLUMN mount_mode TEXT NOT NULL DEFAULT 'worktree' CHECK (mount_mode IN ('worktree', 'clone'))"
    )
  },
}

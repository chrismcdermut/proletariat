/**
 * Migration 0007 — Add tracking columns to agent_worktrees
 *
 * Adds last_commit_hash, commits_ahead, is_clean, and last_checked
 * columns for worktree status tracking.
 */

import type { SqliteDatabase } from '../sqlite.js'
import type { Migration } from '../migrator.js'

export const addWorktreeColumns: Migration = {
  id: '0007',
  name: 'add_worktree_columns',
  up: (db: SqliteDatabase) => {
    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='agent_worktrees'"
    ).get()
    if (!tableExists) return

    const tableInfo = db.prepare("PRAGMA table_info(agent_worktrees)").all() as { name: string }[]
    if (tableInfo.some(col => col.name === 'commits_ahead')) {
      return // Columns already exist
    }

    db.exec("ALTER TABLE agent_worktrees ADD COLUMN last_commit_hash TEXT")
    db.exec("ALTER TABLE agent_worktrees ADD COLUMN commits_ahead INTEGER NOT NULL DEFAULT 0")
    db.exec("ALTER TABLE agent_worktrees ADD COLUMN is_clean INTEGER NOT NULL DEFAULT 1")
    db.exec("ALTER TABLE agent_worktrees ADD COLUMN last_checked TEXT")
  },
}

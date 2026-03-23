/**
 * Migration 0014 — Orchestrate Hooks
 *
 * Extends pmo_work_hooks with mode (auto/confirm/notify/off), priority,
 * project_id, source, and config columns for the orchestrate daemon.
 */

import type { SqliteDatabase } from '../sqlite.js'
import type { Migration } from '../migrator.js'

export const orchestrateHooks: Migration = {
  id: '0014',
  name: 'orchestrate_hooks',
  up: (db: SqliteDatabase) => {
    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pmo_work_hooks'"
    ).get()
    if (!tableExists) return

    const tableInfo = db.prepare("PRAGMA table_info(pmo_work_hooks)").all() as { name: string }[]
    const existingCols = new Set(tableInfo.map(col => col.name))

    if (!existingCols.has('mode')) {
      db.exec(
        "ALTER TABLE pmo_work_hooks ADD COLUMN mode TEXT NOT NULL DEFAULT 'auto' CHECK (mode IN ('auto', 'confirm', 'notify', 'off'))"
      )
    }

    if (!existingCols.has('priority')) {
      db.exec(
        "ALTER TABLE pmo_work_hooks ADD COLUMN priority INTEGER NOT NULL DEFAULT 0"
      )
    }

    if (!existingCols.has('project_id')) {
      db.exec(
        "ALTER TABLE pmo_work_hooks ADD COLUMN project_id TEXT"
      )
    }

    if (!existingCols.has('source')) {
      db.exec(
        "ALTER TABLE pmo_work_hooks ADD COLUMN source TEXT NOT NULL DEFAULT 'cli' CHECK (source IN ('yaml', 'cli', 'preset'))"
      )
    }

    if (!existingCols.has('config')) {
      db.exec(
        "ALTER TABLE pmo_work_hooks ADD COLUMN config TEXT"
      )
    }

    // Create index for priority-ordered lookup
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_pmo_work_hooks_priority ON pmo_work_hooks(event, priority)"
    )
  },
}

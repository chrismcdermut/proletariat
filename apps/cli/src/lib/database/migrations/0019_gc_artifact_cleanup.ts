/**
 * Migration 0019 — GC Artifact Cleanup Columns
 *
 * Adds gc_cleaned_at column to agent_work table to track when
 * execution records have been processed by garbage collection.
 * Records are marked (not deleted) by default, preserving audit trail.
 */

import type Database from 'better-sqlite3'
import type { Migration } from '../migrator.js'

export const gcArtifactCleanup: Migration = {
  id: '0019',
  name: 'gc_artifact_cleanup',
  up: (db: Database.Database) => {
    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='agent_work'"
    ).get()
    if (!tableExists) return

    const tableInfo = db.prepare("PRAGMA table_info(agent_work)").all() as { name: string }[]
    const existingCols = new Set(tableInfo.map(col => col.name))

    if (!existingCols.has('gc_cleaned_at')) {
      db.exec(
        "ALTER TABLE agent_work ADD COLUMN gc_cleaned_at TEXT"
      )
    }

    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_agent_work_gc_cleaned ON agent_work(gc_cleaned_at)"
    )
  },
}

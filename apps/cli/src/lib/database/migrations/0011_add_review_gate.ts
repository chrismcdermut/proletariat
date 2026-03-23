/**
 * Migration 0011 — Add review_gate column to pmo_actions
 *
 * Enables per-action review gate configuration.
 * Values: 'required' | 'auto' | 'post' | NULL (use workspace default).
 */

import type { SqliteDatabase } from '../sqlite.js'
import type { Migration } from '../migrator.js'

export const addReviewGate: Migration = {
  id: '0011',
  name: 'add_review_gate',
  up: (db: SqliteDatabase) => {
    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pmo_actions'"
    ).get()
    if (!tableExists) return

    const tableInfo = db.prepare("PRAGMA table_info(pmo_actions)").all() as { name: string }[]
    if (tableInfo.some(col => col.name === 'review_gate')) {
      return // Column already exists
    }

    db.exec(
      "ALTER TABLE pmo_actions ADD COLUMN review_gate TEXT CHECK (review_gate IN ('required', 'auto', 'post'))"
    )
  },
}

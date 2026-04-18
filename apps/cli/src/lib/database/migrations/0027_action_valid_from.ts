/**
 * Migration 0027 — Action Valid-From Guardrails
 *
 * Adds `valid_from` column (TEXT, nullable) to `pmo_actions`.
 * Stores a JSON array of intent names that the action may be invoked from.
 * Empty/null means the action can be invoked from any state.
 *
 * Also populates sensible defaults for built-in actions.
 */

import type Database from 'better-sqlite3'
import type { Migration } from '../migrator.js'

export const actionValidFrom: Migration = {
  id: '0027',
  name: 'action_valid_from',
  up: (db: Database.Database) => {
    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pmo_actions'"
    ).get()
    if (!tableExists) return

    // Check if column already exists
    const columns = db.prepare('PRAGMA table_info(pmo_actions)').all() as Array<{ name: string }>
    if (columns.some(c => c.name === 'valid_from')) return

    // Add the valid_from column (TEXT, nullable — stores JSON array)
    db.exec('ALTER TABLE pmo_actions ADD COLUMN valid_from TEXT')

    // Set sensible defaults for built-in actions
    const updateStmt = db.prepare(
      'UPDATE pmo_actions SET valid_from = ? WHERE id = ? AND is_builtin = 1'
    )

    // implement: can run from ready, backlog, or started (continue)
    updateStmt.run(JSON.stringify(['ready', 'backlog', 'started']), 'implement')

    // review: only when ticket is in needs_review
    updateStmt.run(JSON.stringify(['needs_review']), 'review')

    // merge: only when ticket is in needs_review
    updateStmt.run(JSON.stringify(['needs_review']), 'merge')

    // groom: null (any state) — intentionally not set
    // resolve: null (any state) — intentionally not set
  },
}

/**
 * Migration 0026 — Action-Level Guardrails
 *
 * Adds `valid_from` column to pmo_actions (TEXT, JSON array of intent names).
 * Migrates existing `from_intent` single-value data into the new array column.
 *
 * valid_from stores the list of intents from which an action may be invoked.
 * An empty/null valid_from means the action can run from any state.
 *
 * PRLT-1317: Action-level guardrails — validate invocation state regardless of caller.
 */

import type Database from 'better-sqlite3'
import type { Migration } from '../migrator.js'

export const actionGuardrails: Migration = {
  id: '0026',
  name: 'action_guardrails',
  up: (db: Database.Database) => {
    const actionsExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pmo_actions'"
    ).get()
    if (!actionsExists) return

    const cols = db.prepare("PRAGMA table_info(pmo_actions)").all() as { name: string }[]
    const colNames = new Set(cols.map(c => c.name))

    if (colNames.has('valid_from')) return // Already migrated

    // Add valid_from column (TEXT — stores JSON array of intent strings)
    db.exec('ALTER TABLE pmo_actions ADD COLUMN valid_from TEXT')

    // Migrate existing from_intent values into valid_from as single-element arrays
    db.prepare(`
      UPDATE pmo_actions
      SET valid_from = json_array(from_intent)
      WHERE from_intent IS NOT NULL AND from_intent != ''
    `).run()
  },
}

/**
 * Migration 0025 — Action-Level Guardrails
 *
 * Adds `valid_from` column to pmo_actions table. This is a JSON array of
 * intent names (e.g., '["ready","backlog"]') that restrict which ticket
 * states an action can be invoked from. NULL means the action can run
 * from any state.
 *
 * Also seeds default valid_from values for built-in actions:
 *   groom:     ["backlog"]
 *   implement: ["ready","backlog"]
 *   review:    ["needs_review"]
 *   merge:     ["needs_review"]
 *   resolve:   NULL (any state)
 *
 * PRLT-1317
 */

import type Database from 'better-sqlite3'
import type { Migration } from '../migrator.js'

/** Default valid_from values for built-in actions */
const BUILTIN_VALID_FROM: Record<string, string[]> = {
  groom: ['backlog'],
  implement: ['ready', 'backlog'],
  review: ['needs_review'],
  merge: ['needs_review'],
  // resolve: omitted — null means any state
}

export const actionGuardrails: Migration = {
  id: '0025',
  name: 'action_guardrails',
  up: (db: Database.Database) => {
    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pmo_actions'"
    ).get()
    if (!tableExists) return

    const cols = db.prepare("PRAGMA table_info(pmo_actions)").all() as { name: string }[]
    const colNames = new Set(cols.map(c => c.name))

    if (!colNames.has('valid_from')) {
      db.exec('ALTER TABLE pmo_actions ADD COLUMN valid_from TEXT')

      // Seed defaults for built-in actions
      const stmt = db.prepare('UPDATE pmo_actions SET valid_from = ? WHERE id = ? AND is_builtin = 1')
      for (const [actionId, intents] of Object.entries(BUILTIN_VALID_FROM)) {
        stmt.run(JSON.stringify(intents), actionId)
      }
    }
  },
}

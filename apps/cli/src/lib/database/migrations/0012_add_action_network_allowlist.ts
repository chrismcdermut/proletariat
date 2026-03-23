/**
 * Migration 0012 — Add network_allowlist column to pmo_actions
 *
 * Enables per-action network allowlist configuration.
 * Stores a JSON array of domain strings (e.g., '["api.linear.app"]').
 * NULL means use workspace/global defaults only.
 */

import type { SqliteDatabase } from '../sqlite.js'
import type { Migration } from '../migrator.js'

export const addActionNetworkAllowlist: Migration = {
  id: '0012',
  name: 'add_action_network_allowlist',
  up: (db: SqliteDatabase) => {
    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pmo_actions'"
    ).get()
    if (!tableExists) return

    const tableInfo = db.prepare("PRAGMA table_info(pmo_actions)").all() as { name: string }[]
    if (tableInfo.some(col => col.name === 'network_allowlist')) {
      return // Column already exists
    }

    db.exec(
      "ALTER TABLE pmo_actions ADD COLUMN network_allowlist TEXT"
    )
  },
}

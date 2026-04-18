/**
 * Migration 0025 — Hook Action Types
 *
 * Expands the action_type CHECK constraint on pmo_work_hooks to include
 * 'poke', 'action', and 'llm' alongside existing 'shell', 'webhook', 'log'.
 *
 * Adds an action_ref column for referencing shared action definitions by name,
 * enabling multiple events to point to the same action definition without
 * duplicating config in each hook row.
 *
 * SQLite doesn't support ALTER COLUMN to modify CHECK constraints,
 * so we recreate the table with the updated constraint.
 */

import type Database from 'better-sqlite3'
import type { Migration } from '../migrator.js'

export const hookActionTypes: Migration = {
  id: '0025',
  name: 'hook_action_types',
  up: (db: Database.Database) => {
    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pmo_work_hooks'"
    ).get()
    if (!tableExists) return

    // Check if already migrated — look for 'poke' in the constraint
    const createSql = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='pmo_work_hooks'"
    ).get() as { sql: string } | undefined
    if (createSql?.sql?.includes("'poke'")) return

    // Recreate with expanded action_type CHECK and new action_ref column
    db.exec(`
      CREATE TABLE pmo_work_hooks_new (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        event TEXT NOT NULL,
        action_type TEXT NOT NULL DEFAULT 'shell' CHECK (action_type IN ('shell', 'webhook', 'log', 'poke', 'action', 'llm')),
        action_value TEXT NOT NULL DEFAULT '',
        action_ref TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        description TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        mode TEXT NOT NULL DEFAULT 'auto' CHECK (mode IN ('auto', 'confirm', 'notify', 'llm', 'human', 'off')),
        priority INTEGER NOT NULL DEFAULT 0,
        project_id TEXT,
        source TEXT NOT NULL DEFAULT 'cli' CHECK (source IN ('yaml', 'cli', 'preset')),
        config TEXT
      )
    `)

    // Copy all existing data (action_ref defaults to NULL for existing rows)
    db.exec(`
      INSERT INTO pmo_work_hooks_new (id, name, event, action_type, action_value, enabled, description, created_at, mode, priority, project_id, source, config)
      SELECT id, name, event, action_type, action_value, enabled, description, created_at, mode, priority, project_id, source, config
      FROM pmo_work_hooks
    `)

    // Swap tables
    db.exec('DROP TABLE pmo_work_hooks')
    db.exec('ALTER TABLE pmo_work_hooks_new RENAME TO pmo_work_hooks')

    // Recreate indexes
    db.exec('CREATE INDEX IF NOT EXISTS idx_pmo_work_hooks_event ON pmo_work_hooks(event)')
    db.exec('CREATE INDEX IF NOT EXISTS idx_pmo_work_hooks_enabled ON pmo_work_hooks(enabled)')
    db.exec('CREATE INDEX IF NOT EXISTS idx_pmo_work_hooks_priority ON pmo_work_hooks(event, priority)')
    db.exec('CREATE INDEX IF NOT EXISTS idx_pmo_work_hooks_action_ref ON pmo_work_hooks(action_ref)')
  },
}

/**
 * Migration 0027 — Expand Hook Action Types
 *
 * Adds 'poke' and 'llm' to the action_type CHECK constraint on pmo_work_hooks.
 * Adds 'action_ref' column for shared action definitions (multiple events
 * can reference the same action definition without duplicating config).
 *
 * - poke: Send a message to a named session via tmux (in-process, no shell)
 * - llm: Send payload to LLM for judgment/triage
 * - action_ref: Points to a shared action definition by name
 */

import type Database from 'better-sqlite3'
import type { Migration } from '../migrator.js'

export const hookActionTypesExpand: Migration = {
  id: '0027',
  name: 'hook_action_types_expand',
  up: (db: Database.Database) => {
    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pmo_work_hooks'"
    ).get()
    if (!tableExists) return

    // Check if 'poke' is already in the constraint — skip if already migrated
    const createSql = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='pmo_work_hooks'"
    ).get() as { sql: string } | undefined
    if (createSql?.sql?.includes("'poke'")) return

    // SQLite doesn't allow modifying CHECK constraints via ALTER TABLE.
    // Recreate the table with the expanded constraint + action_ref column.
    db.exec(`
      CREATE TABLE pmo_work_hooks_new (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        event TEXT NOT NULL,
        action_type TEXT NOT NULL DEFAULT 'shell' CHECK (action_type IN ('shell', 'webhook', 'log', 'action', 'poke', 'llm')),
        action_value TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        description TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        mode TEXT NOT NULL DEFAULT 'auto' CHECK (mode IN ('auto', 'confirm', 'notify', 'llm', 'human', 'off')),
        priority INTEGER NOT NULL DEFAULT 0,
        project_id TEXT,
        source TEXT NOT NULL DEFAULT 'cli' CHECK (source IN ('yaml', 'cli', 'preset')),
        config TEXT,
        action_ref TEXT
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

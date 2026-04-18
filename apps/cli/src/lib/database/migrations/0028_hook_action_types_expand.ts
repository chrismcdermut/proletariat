/**
 * Migration 0028 — Expand Hook Action Types & Add action_ref
 *
 * 1. Expands the action_type CHECK constraint to include 'poke' and 'llm'
 *    alongside existing 'shell', 'webhook', 'log', 'action'.
 *
 * 2. Adds 'action_ref' column — allows multiple hook rows to reference
 *    a shared action definition by name (e.g., 'poke-orchestrator'),
 *    avoiding config duplication across events.
 *
 * PRLT-1295: Clean up hook/action data model
 */

import type Database from 'better-sqlite3'
import type { Migration } from '../migrator.js'

export const hookActionTypesExpand: Migration = {
  id: '0028',
  name: 'hook_action_types_expand',
  up: (db: Database.Database) => {
    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pmo_work_hooks'"
    ).get()
    if (!tableExists) return

    // Check if the constraint already includes 'poke' — skip if already migrated
    const createSql = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='pmo_work_hooks'"
    ).get() as { sql: string } | undefined
    if (createSql?.sql?.includes("'poke'")) return

    // SQLite doesn't allow modifying CHECK constraints via ALTER TABLE.
    // Recreate the table with the expanded constraint and new action_ref column.
    db.exec(`
      CREATE TABLE pmo_work_hooks_new (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        event TEXT NOT NULL,
        action_type TEXT NOT NULL DEFAULT 'shell' CHECK (action_type IN ('shell', 'webhook', 'log', 'action', 'poke', 'llm')),
        action_value TEXT NOT NULL,
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

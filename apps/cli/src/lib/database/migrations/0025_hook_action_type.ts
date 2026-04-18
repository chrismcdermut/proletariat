/**
 * Migration 0025 — Hook Action Type
 *
 * Adds 'action' to the action_type CHECK constraint on pmo_work_hooks.
 * The 'action' type allows hooks to call built-in action handlers
 * directly in-process instead of shelling out to prlt CLI commands.
 *
 * Also migrates existing preset hooks from shell-based indirection
 * (action_type='shell', action_value='prlt hook fire ... --action <name>')
 * to direct action invocation (action_type='action', action_value='<name>').
 */

import type Database from 'better-sqlite3'
import type { Migration } from '../migrator.js'

export const hookActionType: Migration = {
  id: '0025',
  name: 'hook_action_type',
  up: (db: Database.Database) => {
    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pmo_work_hooks'"
    ).get()
    if (!tableExists) return

    // Check if the constraint already includes 'action' — skip if already migrated
    const createSql = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='pmo_work_hooks'"
    ).get() as { sql: string } | undefined
    if (createSql?.sql?.includes("'action'")) return

    // SQLite doesn't allow modifying CHECK constraints via ALTER TABLE.
    // Recreate the table with the expanded constraint.
    db.exec(`
      CREATE TABLE pmo_work_hooks_new (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        event TEXT NOT NULL,
        action_type TEXT NOT NULL DEFAULT 'shell' CHECK (action_type IN ('shell', 'webhook', 'log', 'action')),
        action_value TEXT NOT NULL,
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

    // Copy all existing data
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

    // Migrate existing preset hooks from shell indirection to direct action type.
    // Pattern: action_value = 'prlt hook fire <event> --action <action-name>'
    // → action_type = 'action', action_value = '<action-name>'
    const presetHooks = db.prepare(
      "SELECT id, action_value FROM pmo_work_hooks WHERE source = 'preset' AND action_type = 'shell'"
    ).all() as Array<{ id: string; action_value: string }>

    const updateStmt = db.prepare(
      "UPDATE pmo_work_hooks SET action_type = 'action', action_value = ? WHERE id = ?"
    )

    for (const hook of presetHooks) {
      const match = hook.action_value.match(/--action\s+(\S+)/)
      if (match) {
        updateStmt.run(match[1], hook.id)
      }
    }
  },
}

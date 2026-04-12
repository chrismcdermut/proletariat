/**
 * Migration 0023 — Intent-Based Actions
 *
 * Decouples pmo_actions from provider-specific state names by renaming:
 *   from_state → from_intent
 *   to_state   → to_intent
 *
 * Existing state name values are mapped to canonical intent names:
 *   'Backlog'     → 'backlog'
 *   'Todo'        → 'ready'
 *   'In Progress' → 'started'
 *   'Review'      → 'needs_review'
 *   'Done'        → 'completed'
 *
 * Also adds default_executor to workspace_settings.
 */

import type Database from 'better-sqlite3'
import type { Migration } from '../migrator.js'

// State name → intent name mapping
const STATE_TO_INTENT: Record<string, string> = {
  'Backlog': 'backlog',
  'Todo': 'ready',
  'In Progress': 'started',
  'Review': 'needs_review',
  'Done': 'completed',
  // Lower-case variants
  'backlog': 'backlog',
  'todo': 'ready',
  'in progress': 'started',
  'review': 'needs_review',
  'done': 'completed',
}

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info('${table}')`).all() as Array<{ name: string }>
  return rows.some(r => r.name === column)
}

function hasTable(db: Database.Database, table: string): boolean {
  const row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
  ).get(table) as { name: string } | undefined
  return !!row
}

export const intentBasedActions: Migration = {
  id: '0023_intent_based_actions',
  name: 'intent_based_actions',

  up(db: Database.Database): void {
    // =====================================================================
    // 1. Rename from_state/to_state → from_intent/to_intent in pmo_actions
    // =====================================================================
    if (hasTable(db, 'pmo_actions') && hasColumn(db, 'pmo_actions', 'from_state')) {
      // SQLite doesn't support RENAME COLUMN in older versions, so we
      // recreate the table with new column names and copy data.
      db.exec(`
        CREATE TABLE IF NOT EXISTS pmo_actions_new (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          description TEXT,
          prompt TEXT NOT NULL,
          end_prompt TEXT,
          from_intent TEXT,
          to_intent TEXT,
          executor TEXT CHECK (executor IN ('claude', 'codex', 'opencode', 'custom')),
          environment TEXT CHECK (environment IN ('devcontainer', 'docker', 'host', 'vm')),
          permission_mode TEXT CHECK (permission_mode IN ('full', 'readonly', 'bypassPermissions')),
          timeout INTEGER,
          model TEXT,
          review_gate TEXT CHECK (review_gate IN ('required', 'auto', 'post')),
          network_allowlist TEXT,
          modifies_code INTEGER NOT NULL DEFAULT 1,
          is_default INTEGER NOT NULL DEFAULT 0,
          is_builtin INTEGER NOT NULL DEFAULT 0,
          position INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP
        )
      `)

      // Copy data from old table to new, mapping state names to intents
      const rows = db.prepare('SELECT * FROM pmo_actions').all() as Array<Record<string, unknown>>
      const insert = db.prepare(`
        INSERT INTO pmo_actions_new (
          id, name, description, prompt, end_prompt, from_intent, to_intent,
          executor, environment, permission_mode, timeout, model, review_gate,
          network_allowlist, modifies_code, is_default, is_builtin, position,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      for (const row of rows) {
        const fromState = row.from_state as string | null
        const toState = row.to_state as string | null
        const fromIntent = fromState ? (STATE_TO_INTENT[fromState] ?? fromState.toLowerCase().replace(/\s+/g, '_')) : null
        const toIntent = toState ? (STATE_TO_INTENT[toState] ?? toState.toLowerCase().replace(/\s+/g, '_')) : null

        insert.run(
          row.id,
          row.name,
          row.description,
          row.prompt,
          row.end_prompt,
          fromIntent,
          toIntent,
          row.executor,
          row.environment,
          row.permission_mode,
          row.timeout,
          row.model,
          row.review_gate,
          row.network_allowlist,
          row.modifies_code,
          row.is_default,
          row.is_builtin,
          row.position,
          row.created_at,
          row.updated_at,
        )
      }

      // Drop old table and rename new one
      db.exec('DROP TABLE pmo_actions')
      db.exec('ALTER TABLE pmo_actions_new RENAME TO pmo_actions')
    }

    // If the table already has from_intent (fresh db or already migrated), skip
    // but ensure columns exist
    if (hasTable(db, 'pmo_actions') && !hasColumn(db, 'pmo_actions', 'from_intent')) {
      // Edge case: table exists but with neither old nor new columns
      // This shouldn't happen, but be safe
      return
    }

    // =====================================================================
    // 2. Add default_executor to workspace_settings
    // =====================================================================
    if (hasTable(db, 'workspace_settings')) {
      const existing = db.prepare(
        "SELECT value FROM workspace_settings WHERE key = 'default_executor'"
      ).get() as { value: string } | undefined

      if (!existing) {
        db.prepare(
          "INSERT INTO workspace_settings (key, value) VALUES ('default_executor', 'claude')"
        ).run()
      }
    }
  },
}

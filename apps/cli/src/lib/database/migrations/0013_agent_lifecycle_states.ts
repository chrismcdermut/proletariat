/**
 * Migration 0013 — Add agent lifecycle states
 *
 * Extends the agents.status column to support lifecycle states:
 * 'active', 'running', 'completed', 'dead', 'cleaned'
 *
 * SQLite doesn't support ALTER CHECK constraints directly,
 * so we recreate the table with the new constraint.
 */

import type { SqliteDatabase } from '../sqlite.js'
import type { Migration } from '../migrator.js'

export const agentLifecycleStates: Migration = {
  id: '0013',
  name: 'agent_lifecycle_states',
  up: (db: SqliteDatabase) => {
    // SQLite doesn't support modifying CHECK constraints, so we need to
    // recreate the table. We use a migration-safe approach:
    // 1. Create new table with updated constraint
    // 2. Copy data
    // 3. Drop old table
    // 4. Rename new table

    db.exec(`
      CREATE TABLE IF NOT EXISTS agents_new (
        name TEXT PRIMARY KEY,
        type TEXT NOT NULL DEFAULT 'persistent' CHECK (type IN ('persistent', 'ephemeral')),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'running', 'completed', 'dead', 'cleaned')),
        base_name TEXT,
        theme_id TEXT,
        worktree_path TEXT,
        mount_mode TEXT NOT NULL DEFAULT 'worktree' CHECK (mount_mode IN ('worktree', 'clone')),
        created_at TEXT NOT NULL,
        cleaned_at TEXT,
        FOREIGN KEY (theme_id) REFERENCES agent_themes(id) ON DELETE SET NULL
      );

      INSERT OR IGNORE INTO agents_new (name, type, status, base_name, theme_id, worktree_path, mount_mode, created_at, cleaned_at)
        SELECT name, type, status, base_name, theme_id, worktree_path, mount_mode, created_at, cleaned_at
        FROM agents;

      DROP TABLE agents;

      ALTER TABLE agents_new RENAME TO agents;

      CREATE INDEX IF NOT EXISTS idx_agents_theme ON agents(theme_id);
      CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
    `)
  },
}

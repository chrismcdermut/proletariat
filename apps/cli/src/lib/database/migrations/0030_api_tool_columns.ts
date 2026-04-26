/**
 * Migration 0030 — API Tool Columns
 *
 * Adds auth_header and docs columns to tool_registry, and extends
 * the type CHECK constraint to allow 'api' in addition to 'mcp'/'cli'.
 *
 * PRLT-1361: Add api type to prlt tools
 */

import type Database from 'better-sqlite3'
import type { Migration } from '../migrator.js'

export const apiToolColumns: Migration = {
  id: '0030',
  name: 'api_tool_columns',
  up: (db: Database.Database) => {
    // Add new columns for API tools
    db.exec(`ALTER TABLE tool_registry ADD COLUMN auth_header TEXT`)
    db.exec(`ALTER TABLE tool_registry ADD COLUMN docs TEXT`)

    // SQLite cannot ALTER CHECK constraints directly.
    // Recreate the table to widen the type constraint.
    db.exec(`
      CREATE TABLE tool_registry_new (
        name TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('mcp', 'cli', 'api')),
        description TEXT NOT NULL,
        url TEXT,
        command TEXT,
        args TEXT,
        auth TEXT,
        auth_header TEXT,
        detect TEXT,
        install TEXT,
        builtin INTEGER NOT NULL DEFAULT 0,
        docs TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)

    db.exec(`
      INSERT INTO tool_registry_new
        (name, type, description, url, command, args, auth, auth_header, detect, install, builtin, docs, created_at)
      SELECT
        name, type, description, url, command, args, auth, auth_header, detect, install, builtin, docs, created_at
      FROM tool_registry
    `)

    db.exec(`DROP TABLE tool_registry`)
    db.exec(`ALTER TABLE tool_registry_new RENAME TO tool_registry`)
  },
}

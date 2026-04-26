/**
 * Migration 0029 — Tool Registry Table
 *
 * Moves tool registration from .proletariat/tools.yaml into
 * workspace.db. A single `tool_registry` table stores both MCP
 * servers (type='mcp') and CLI tools (type='cli').
 *
 * PRLT-1360: Move tool registry from tools.yaml to workspace DB
 */

import type Database from 'better-sqlite3'
import type { Migration } from '../migrator.js'

export const toolRegistry: Migration = {
  id: '0029',
  name: 'tool_registry',
  up: (db: Database.Database) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS tool_registry (
        name TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('mcp', 'cli')),
        description TEXT NOT NULL,
        url TEXT,
        command TEXT,
        args TEXT,
        auth TEXT,
        detect TEXT,
        install TEXT,
        builtin INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)
  },
}

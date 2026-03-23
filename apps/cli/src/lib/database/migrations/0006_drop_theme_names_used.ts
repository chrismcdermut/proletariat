/**
 * Migration 0006 — Drop 'used' column from agent_theme_names
 *
 * SQLite doesn't support DROP COLUMN directly, so we recreate the table
 * without the column. Safe to run on databases where the column never existed.
 */

import type { SqliteDatabase } from '../sqlite.js'
import type { Migration } from '../migrator.js'

export const dropThemeNamesUsed: Migration = {
  id: '0006',
  name: 'drop_theme_names_used',
  up: (db: SqliteDatabase) => {
    const tableInfo = db.prepare("PRAGMA table_info(agent_theme_names)").all() as { name: string }[]
    if (!tableInfo.some(col => col.name === 'used')) {
      return // Column doesn't exist, nothing to do
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_theme_names_new (
        theme_id TEXT NOT NULL,
        name TEXT NOT NULL,
        PRIMARY KEY (theme_id, name),
        FOREIGN KEY (theme_id) REFERENCES agent_themes(id) ON DELETE CASCADE
      );
      INSERT OR IGNORE INTO agent_theme_names_new (theme_id, name)
        SELECT theme_id, name FROM agent_theme_names;
      DROP TABLE agent_theme_names;
      ALTER TABLE agent_theme_names_new RENAME TO agent_theme_names;
      CREATE INDEX IF NOT EXISTS idx_theme_names_theme ON agent_theme_names(theme_id);
    `)
  },
}

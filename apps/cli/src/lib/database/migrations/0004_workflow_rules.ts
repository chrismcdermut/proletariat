import type { SqliteDatabase } from '../sqlite.js'
import type { Migration } from '../migrator.js'

export const workflowRules: Migration = {
  id: '0004',
  name: 'workflow_rules',
  up: (db: SqliteDatabase) => {
    // Check if table already exists
    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pmo_workflow_rules'"
    ).get()
    if (tableExists) return

    // Create the workflow_rules table
    db.exec(`
      CREATE TABLE IF NOT EXISTS pmo_workflow_rules (
        id TEXT PRIMARY KEY,
        from_state TEXT,
        to_state TEXT NOT NULL,
        action_id TEXT NOT NULL,
        trigger TEXT NOT NULL DEFAULT 'manual' CHECK (trigger IN ('manual', 'on_enter')),
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP,
        FOREIGN KEY (action_id) REFERENCES pmo_actions(id) ON DELETE CASCADE
      )
    `)
  },
}

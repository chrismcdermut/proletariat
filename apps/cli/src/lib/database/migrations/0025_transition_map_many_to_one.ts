import type Database from 'better-sqlite3'
import type { Migration } from '../migrator.js'

export const transitionMapManyToOne: Migration = {
  id: '0025',
  name: 'transition_map_many_to_one',
  up: (db: Database.Database) => {
    // Allow multiple board columns to map to the same intent.
    // e.g., "New Issues" + "New Functionality Requests" → backlog
    //       "Canceled" + "Duplicate" → dropped
    //
    // SQLite doesn't support ALTER TABLE ... DROP CONSTRAINT, so we
    // recreate the table with the new unique constraint.
    db.exec(`
      CREATE TABLE IF NOT EXISTS pmo_transition_map_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        intent TEXT NOT NULL,
        provider_state_name TEXT NOT NULL,
        provider_state_id TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(provider, intent, provider_state_name)
      )
    `)

    db.exec(`
      INSERT OR IGNORE INTO pmo_transition_map_new
        (provider, intent, provider_state_name, provider_state_id, created_at, updated_at)
      SELECT provider, intent, provider_state_name, provider_state_id, created_at, updated_at
      FROM pmo_transition_map
    `)

    db.exec(`DROP TABLE IF EXISTS pmo_transition_map`)
    db.exec(`ALTER TABLE pmo_transition_map_new RENAME TO pmo_transition_map`)
  },
}

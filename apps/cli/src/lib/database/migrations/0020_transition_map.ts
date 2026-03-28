import type Database from 'better-sqlite3'
import type { Migration } from '../migrator.js'

export const transitionMap: Migration = {
  id: '0020',
  name: 'transition_map',
  up: (db: Database.Database) => {
    // Intent-based transition mapping: maps work primitive intents
    // to provider-specific state names for each connected board.
    //
    // Intents: started, needs_review, completed, paused, ready, dropped
    //
    // When a work command runs (e.g., `work start` → intent 'started'),
    // the system looks up the provider_state_name for that intent+provider
    // and moves the ticket to that state.
    db.exec(`
      CREATE TABLE IF NOT EXISTS pmo_transition_map (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        intent TEXT NOT NULL,
        provider_state_name TEXT NOT NULL,
        provider_state_id TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(provider, intent)
      )
    `)
  },
}

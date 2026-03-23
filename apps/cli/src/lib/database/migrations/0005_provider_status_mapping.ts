import type { SqliteDatabase } from '../sqlite.js'
import type { Migration } from '../migrator.js'

export const providerStatusMapping: Migration = {
  id: '0005',
  name: 'provider_status_mapping',
  up: (db: SqliteDatabase) => {
    // Provider status mapping: maps provider-specific status names
    // to the canonical workflow status names used internally.
    // Each provider can have its own status vocabulary.
    db.exec(`
      CREATE TABLE IF NOT EXISTS pmo_provider_status_map (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        provider_status TEXT NOT NULL,
        canonical_status TEXT NOT NULL,
        canonical_category TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(provider, provider_status)
      )
    `)

    // Configurable triggers: map lifecycle events to automatic
    // column/status transitions. E.g., "when pr_created → move to Review".
    db.exec(`
      CREATE TABLE IF NOT EXISTS pmo_provider_triggers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL DEFAULT '*',
        trigger_event TEXT NOT NULL,
        target_status TEXT NOT NULL,
        project_id TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(provider, trigger_event, project_id)
      )
    `)
  },
}

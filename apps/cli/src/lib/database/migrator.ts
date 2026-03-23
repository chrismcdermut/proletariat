/**
 * Database migration runner for Proletariat workspace databases.
 *
 * Tracks applied migrations in a `prlt_migrations` table and runs
 * pending migrations on startup. Handles the initial state where
 * existing databases have no migrations table yet.
 */

import { type SqliteDatabase } from './sqlite.js'

export interface Migration {
  /** Unique, sortable migration ID (e.g. "0001") */
  id: string
  /** Human-readable name (e.g. "baseline") */
  name: string
  /** Apply the migration to the database */
  up: (db: SqliteDatabase) => void
}

/**
 * Run all pending migrations against the database.
 *
 * - Creates the `prlt_migrations` tracking table if it doesn't exist.
 * - Skips migrations that have already been applied.
 * - Each migration runs in its own transaction so partial failures
 *   don't leave the tracking table out of sync.
 *
 * Safe to call on both brand-new and existing databases.
 */
export function runDrizzleMigrations(db: SqliteDatabase, migrations: Migration[]): void {
  // Ensure the tracking table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS prlt_migrations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `)

  // Collect already-applied IDs
  const applied = db.prepare('SELECT id FROM prlt_migrations').all() as { id: string }[]
  const appliedSet = new Set(applied.map(m => m.id))

  // Apply pending migrations in order
  for (const migration of migrations) {
    if (appliedSet.has(migration.id)) {
      continue
    }

    const applyMigration = db.transaction(() => {
      migration.up(db)
      db.prepare(
        'INSERT INTO prlt_migrations (id, name, applied_at) VALUES (?, ?, ?)'
      ).run(migration.id, migration.name, new Date().toISOString())
    })

    applyMigration()
  }
}

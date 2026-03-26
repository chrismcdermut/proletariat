/**
 * PMO Bootstrap Operations
 *
 * Raw SQL operations required for PMO initialization and teardown.
 * These run before the storage layer is available.
 *
 * All database opens go through openSafeDatabase() which provides:
 * - Rotating backup before open
 * - Quick integrity check on startup
 * - Auto-repair on corruption (dump/reimport or backup restore)
 *
 * See: PRLT-1152
 */

import Database from 'better-sqlite3'
import { throwIfNativeBindingError } from './native-validation.js'
import { createDrizzleConnection } from './drizzle.js'
import {
  workspaceSettings as workspaceSettingsTable,
} from './drizzle-schema.js'
import {
  createRotatingBackup,
  quickCheckIntegrity,
  repairDatabase,
} from './db-safety.js'

/**
 * Open a database connection with safety features (backup, integrity check, auto-repair).
 * Used by PMO bootstrap functions that need raw SQL access before the full workspace
 * database lifecycle is available.
 */
function openSafeDatabase(dbPath: string, caller: string): Database.Database {
  // Create backup before opening (cheap insurance against corruption)
  createRotatingBackup(dbPath)

  let db: Database.Database
  try {
    db = new Database(dbPath)
  } catch (error) {
    throwIfNativeBindingError(error, caller)
    throw error
  }

  // Quick integrity check — auto-repair if corrupt
  const integrity = quickCheckIntegrity(db)
  if (!integrity.ok) {
    db.close()

    const repair = repairDatabase(dbPath)
    if (!repair.success) {
      throw new Error(
        `Database corruption detected in ${dbPath}.\n` +
        `Integrity errors: ${integrity.errors.join('; ')}\n` +
        `Auto-repair failed: ${repair.message}\n` +
        `Run 'prlt db repair' for manual recovery options.`
      )
    }

    // Re-open the repaired database
    try {
      db = new Database(dbPath)
    } catch (error) {
      throwIfNativeBindingError(error, `${caller} (post-repair)`)
      throw error
    }
  }

  return db
}

/**
 * Check if PMO tables exist and get basic stats.
 * Raw SQL: uses sqlite_master introspection (pre-migration bootstrap).
 */
export function checkPMOExists(dbPath: string): { exists: boolean; projectCount: number; ticketCount: number } {
  const db = openSafeDatabase(dbPath, 'checkPMOExists')
  try {
    const result = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pmo_projects'"
    ).get()

    if (result === undefined) {
      return { exists: false, projectCount: 0, ticketCount: 0 }
    }

    const projectCountResult = db.prepare('SELECT COUNT(*) as count FROM pmo_projects').get() as { count: number } | undefined
    const ticketCountResult = db.prepare('SELECT COUNT(*) as count FROM pmo_tickets').get() as { count: number } | undefined

    return {
      exists: true,
      projectCount: projectCountResult?.count ?? 0,
      ticketCount: ticketCountResult?.count ?? 0,
    }
  } finally {
    db.close()
  }
}

/**
 * Get a PMO setting from the pmo_settings table.
 * Raw SQL: pre-migration bootstrap query.
 */
export function getPMOSetting(dbPath: string, key: string): string | null {
  const db = openSafeDatabase(dbPath, 'getPMOSetting')
  try {
    const result = db.prepare('SELECT value FROM pmo_settings WHERE key = ?').get(key) as { value: string } | undefined
    return result?.value ?? null
  } catch {
    return null
  } finally {
    db.close()
  }
}

/**
 * Drop PMO tables from the database.
 * Raw SQL: DDL operations (DROP TABLE) are not supported by Drizzle.
 */
export function dropPMOTables(dbPath: string, tables: string[]): void {
  const db = openSafeDatabase(dbPath, 'dropPMOTables')
  try {
    for (const table of tables) {
      try {
        db.prepare(`DROP TABLE IF EXISTS ${table}`).run()
      } catch {
        // Ignore errors - table might not exist
      }
    }
  } finally {
    db.close()
  }
}

/**
 * Upsert a workspace setting (key-value pair).
 */
export function upsertWorkspaceSetting(db: Database.Database, key: string, value: string): void {
  const ddb = createDrizzleConnection(db)
  ddb.insert(workspaceSettingsTable)
    .values({ key, value })
    .onConflictDoUpdate({
      target: workspaceSettingsTable.key,
      set: { value },
    })
    .run()
}

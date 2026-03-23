/**
 * PMO Bootstrap Operations
 *
 * Raw SQL operations required for PMO initialization and teardown.
 * These run before the storage layer is available.
 */

import { SqliteDatabase } from './sqlite.js'
import { createDrizzleConnection } from './drizzle.js'
import {
  workspaceSettings as workspaceSettingsTable,
} from './drizzle-schema.js'

/**
 * Check if PMO tables exist and get basic stats.
 * Raw SQL: uses sqlite_master introspection (pre-migration bootstrap).
 */
export function checkPMOExists(dbPath: string): { exists: boolean; projectCount: number; ticketCount: number } {
  const db = new SqliteDatabase(dbPath)
  try {
    const result = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pmo_projects'"
    ).get()

    if (result === undefined) {
      return { exists: false, projectCount: 0, ticketCount: 0 }
    }

    const projectCountResult = db.prepare('SELECT COUNT(*) as count FROM pmo_projects').get() as { count: number }
    const ticketCountResult = db.prepare('SELECT COUNT(*) as count FROM pmo_tickets').get() as { count: number }

    return {
      exists: true,
      projectCount: projectCountResult.count,
      ticketCount: ticketCountResult.count,
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
  const db = new SqliteDatabase(dbPath)
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
  const db = new SqliteDatabase(dbPath)
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
export function upsertWorkspaceSetting(db: SqliteDatabase, key: string, value: string): void {
  const ddb = createDrizzleConnection(db)
  ddb.insert(workspaceSettingsTable)
    .values({ key, value })
    .onConflictDoUpdate({
      target: workspaceSettingsTable.key,
      set: { value },
    })
    .run()
}

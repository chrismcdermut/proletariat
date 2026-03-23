/**
 * Drizzle ORM Database Connection
 *
 * This module provides type-safe database connections using Drizzle ORM
 * with sql.js as the underlying driver.
 */

import { drizzle } from 'drizzle-orm/sql-js'
import type { SQLJsDatabase as DrizzleSqlJsDatabase } from 'drizzle-orm/sql-js'
import { SqliteDatabase } from './sqlite.js'
import * as schema from './drizzle-schema.js'

export type DrizzleDB = DrizzleSqlJsDatabase<typeof schema>

/**
 * Create a Drizzle database connection from an existing SqliteDatabase.
 * This allows gradual migration by wrapping existing database connections.
 */
export function createDrizzleConnection(db: SqliteDatabase): DrizzleDB {
  return drizzle(db.rawDatabase, { schema })
}

/**
 * Create a new Drizzle database connection from a file path.
 * Configures pragmas for optimal performance and reliability.
 */
export function openDrizzleDatabase(dbPath: string): { db: DrizzleDB; sqliteDb: SqliteDatabase } {
  const sqliteDb = new SqliteDatabase(dbPath)

  // Configure pragmas
  sqliteDb.pragma('foreign_keys = ON')
  sqliteDb.pragma('busy_timeout = 5000')

  const db = drizzle(sqliteDb.rawDatabase, { schema })

  return { db, sqliteDb }
}

/**
 * Close a Drizzle database connection.
 * Closes the underlying SqliteDatabase, which also saves changes to disk.
 */
export function closeDrizzleDatabase(sqliteDb: SqliteDatabase): void {
  sqliteDb.close()
}

// Re-export schema for convenience
export * from './drizzle-schema.js'

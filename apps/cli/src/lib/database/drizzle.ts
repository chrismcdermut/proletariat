/**
 * Drizzle ORM Database Connection
 *
 * This module provides type-safe database connections using Drizzle ORM
 * with better-sqlite3 as the underlying driver.
 */

import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import * as schema from './drizzle-schema.js'

export type DrizzleDB = BetterSQLite3Database<typeof schema>

/**
 * Create a Drizzle database connection from an existing better-sqlite3 database.
 * This allows gradual migration by wrapping existing database connections.
 */
export function createDrizzleConnection(db: Database.Database): DrizzleDB {
  return drizzle(db, { schema })
}

/**
 * Create a new Drizzle database connection from a file path.
 * Configures pragmas for optimal performance and reliability.
 */
export function openDrizzleDatabase(dbPath: string): { db: DrizzleDB; sqliteDb: Database.Database } {
  const sqliteDb = new Database(dbPath)

  // Configure pragmas
  sqliteDb.pragma('foreign_keys = ON')
  sqliteDb.pragma('busy_timeout = 5000') // Wait up to 5 seconds if database is locked

  const db = drizzle(sqliteDb, { schema })

  return { db, sqliteDb }
}

/**
 * Close a Drizzle database connection.
 * Since Drizzle wraps better-sqlite3, we need to close the underlying connection.
 */
export function closeDrizzleDatabase(sqliteDb: Database.Database): void {
  sqliteDb.close()
}

// Re-export schema for convenience
export * from './drizzle-schema.js'

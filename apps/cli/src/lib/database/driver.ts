/**
 * Database Driver Abstraction Layer
 *
 * Defines a driver-agnostic interface for SQLite database access.
 * Uses SqliteDatabase (sql.js/WASM) as the underlying implementation.
 *
 * All database access in the codebase should go through this interface
 * rather than using raw sql.js directly.
 */

import { SqliteDatabase } from './sqlite.js'

// =============================================================================
// Driver Interface
// =============================================================================

/**
 * Result of executing a statement that modifies data.
 */
export interface RunResult {
  /** Number of rows changed by the statement */
  changes: number
  /** Row ID of the last inserted row */
  lastInsertRowid: number | bigint
}

/**
 * A prepared SQL statement that can be executed with parameters.
 */
export interface PreparedStatement<T = Record<string, unknown>> {
  /** Execute the statement and return change info (INSERT/UPDATE/DELETE) */
  run(...params: unknown[]): RunResult
  /** Execute the statement and return the first matching row */
  get(...params: unknown[]): T | undefined
  /** Execute the statement and return all matching rows */
  all(...params: unknown[]): T[]
}

/**
 * Database driver interface that abstracts over the underlying SQLite implementation.
 *
 * This is the single interface through which all database access should flow.
 * Backed by sql.js (pure JS/WASM SQLite, zero native dependencies).
 *
 * Usage:
 * ```typescript
 * const driver = openDriver(dbPath)
 * const row = driver.prepare<{ count: number }>('SELECT COUNT(*) as count FROM users').get()
 * driver.close()
 * ```
 */
export interface DatabaseDriver {
  /** Prepare a SQL statement for execution */
  prepare<T = Record<string, unknown>>(sql: string): PreparedStatement<T>

  /** Execute raw SQL (DDL, multi-statement, no return value) */
  exec(sql: string): void

  /** Get or set SQLite pragmas */
  pragma(source: string, options?: { simple?: boolean }): unknown

  /**
   * Create a transaction function.
   * Returns a new function that, when called, runs the wrapped function
   * inside a SQLite transaction.
   */
  transaction<F extends (...args: unknown[]) => unknown>(fn: F): F

  /** Close the database connection */
  close(): void

  /** Whether the connection is open */
  readonly open: boolean

  /**
   * Access the underlying raw database connection.
   * Use this ONLY for interop with libraries that need the raw connection
   * (e.g., Drizzle ORM). New code should use the driver interface instead.
   * @internal
   */
  readonly raw: unknown
}

// =============================================================================
// SqliteDatabase Driver Implementation
// =============================================================================

/**
 * DatabaseDriver implementation backed by sql.js (WASM SQLite).
 *
 * This is the primary driver used in production. It wraps a SqliteDatabase
 * instance behind the DatabaseDriver interface.
 */
export class SqlJsDriver implements DatabaseDriver {
  constructor(private db: SqliteDatabase) {}

  prepare<T = Record<string, unknown>>(sql: string): PreparedStatement<T> {
    return this.db.prepare<T>(sql)
  }

  exec(sql: string): void {
    this.db.exec(sql)
  }

  pragma(source: string, options?: { simple?: boolean }): unknown {
    return this.db.pragma(source, options)
  }

  transaction<F extends (...args: unknown[]) => unknown>(fn: F): F {
    return this.db.transaction(fn)
  }

  close(): void {
    this.db.close()
  }

  get open(): boolean {
    return this.db.open
  }

  /**
   * Access the underlying SqliteDatabase instance.
   * @internal Use for Drizzle ORM interop only.
   */
  get raw(): SqliteDatabase {
    return this.db
  }
}

// Keep the old name as an alias for backward compatibility during migration
export { SqlJsDriver as BetterSqlite3Driver }

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a DatabaseDriver from an existing SqliteDatabase instance.
 */
export function wrapDatabase(db: SqliteDatabase): DatabaseDriver {
  return new SqlJsDriver(db)
}

/**
 * Create a DatabaseDriver by opening a new sql.js connection.
 * Configures standard pragmas (foreign keys, busy timeout).
 */
export function openDriver(dbPath: string, options?: { foreignKeys?: boolean; busyTimeout?: number; readonly?: boolean }): DatabaseDriver {
  const readOnly = options?.readonly ?? false
  const db = new SqliteDatabase(dbPath, readOnly ? { readonly: true } : undefined)
  if (!readOnly) {
    db.pragma('journal_mode = WAL')
  }
  if (options?.foreignKeys !== false) {
    db.pragma('foreign_keys = ON')
  }
  if (options?.busyTimeout !== undefined) {
    db.pragma(`busy_timeout = ${options.busyTimeout}`)
  } else {
    db.pragma('busy_timeout = 5000')
  }
  return new SqlJsDriver(db)
}

/**
 * Extract the raw SqliteDatabase from a driver.
 *
 * Use this for interop with code that still requires the raw connection
 * (e.g., Drizzle ORM).
 */
export function getRawDatabase(driver: DatabaseDriver): SqliteDatabase {
  if (driver instanceof SqlJsDriver) {
    return driver.raw
  }
  const raw = driver.raw
  if (raw instanceof SqliteDatabase) {
    return raw
  }
  throw new Error('Cannot extract raw database from this driver implementation')
}

/**
 * Database Driver Abstraction Layer
 *
 * Defines a driver-agnostic interface for SQLite database access.
 * This allows swapping the underlying implementation (better-sqlite3, sql.js, etc.)
 * without changing consumer code.
 *
 * All database access in the codebase should go through this interface
 * rather than importing better-sqlite3 directly.
 */

import Database from 'better-sqlite3'

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
 * Implementations exist for better-sqlite3 (current) with sql.js planned.
 *
 * Usage:
 * ```typescript
 * const driver = createDriver(dbPath)
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
// BetterSqlite3 Driver Implementation
// =============================================================================

/**
 * DatabaseDriver implementation backed by better-sqlite3.
 *
 * This is the primary driver used in production. It wraps a better-sqlite3
 * Database instance behind the DatabaseDriver interface.
 */
export class BetterSqlite3Driver implements DatabaseDriver {
  constructor(private db: Database.Database) {}

  prepare<T = Record<string, unknown>>(sql: string): PreparedStatement<T> {
    const stmt = this.db.prepare(sql)
    return {
      run: (...params: unknown[]): RunResult => {
        const result = stmt.run(...params)
        return { changes: result.changes, lastInsertRowid: result.lastInsertRowid }
      },
      get: (...params: unknown[]): T | undefined => {
        return stmt.get(...params) as T | undefined
      },
      all: (...params: unknown[]): T[] => {
        return stmt.all(...params) as T[]
      },
    }
  }

  exec(sql: string): void {
    this.db.exec(sql)
  }

  pragma(source: string, options?: { simple?: boolean }): unknown {
    return this.db.pragma(source, options)
  }

  transaction<F extends (...args: unknown[]) => unknown>(fn: F): F {
    return this.db.transaction(fn) as unknown as F
  }

  close(): void {
    this.db.close()
  }

  get open(): boolean {
    return this.db.open
  }

  /**
   * Access the underlying better-sqlite3 Database instance.
   * @internal Use for Drizzle ORM interop only.
   */
  get raw(): Database.Database {
    return this.db
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a DatabaseDriver from an existing better-sqlite3 Database instance.
 * Useful when migrating existing code that already has a Database object.
 */
export function wrapDatabase(db: Database.Database): DatabaseDriver {
  return new BetterSqlite3Driver(db)
}

/**
 * Create a DatabaseDriver by opening a new better-sqlite3 connection.
 * Configures standard pragmas (WAL mode, foreign keys, busy timeout).
 */
export function openDriver(dbPath: string, options?: { foreignKeys?: boolean; busyTimeout?: number }): DatabaseDriver {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  if (options?.foreignKeys !== false) {
    db.pragma('foreign_keys = ON')
  }
  if (options?.busyTimeout !== undefined) {
    db.pragma(`busy_timeout = ${options.busyTimeout}`)
  } else {
    db.pragma('busy_timeout = 5000')
  }
  return new BetterSqlite3Driver(db)
}

/**
 * Extract the raw better-sqlite3 Database from a driver.
 * Throws if the driver is not a BetterSqlite3Driver.
 *
 * Use this for interop with code that still requires the raw connection
 * (e.g., Drizzle ORM, legacy code being migrated).
 */
export function getRawDatabase(driver: DatabaseDriver): Database.Database {
  if (driver instanceof BetterSqlite3Driver) {
    return driver.raw
  }
  // For other driver implementations, check the raw property
  const raw = driver.raw
  if (raw && typeof raw === 'object' && 'prepare' in raw) {
    return raw as Database.Database
  }
  throw new Error('Cannot extract raw database from this driver implementation')
}

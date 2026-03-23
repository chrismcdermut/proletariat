/**
 * sql.js SQLite Compatibility Layer
 *
 * Provides a SqliteDatabase class that wraps sql.js (pure JS/WASM SQLite)
 * with a better-sqlite3-compatible API. This allows the rest of the codebase
 * to use the same .prepare(), .exec(), .pragma(), .transaction() methods
 * without modification.
 *
 * Key differences from better-sqlite3:
 * - Database is loaded into memory from file on open
 * - Changes are written back to file on close() or save()
 * - No native module compilation required
 * - WASM must be initialized once via initSqlite() before use
 *
 * Memory management (PRLT-1100):
 * - Use SqliteDatabase.open() to share connections for the same file path
 * - Reference counting prevents duplicate WASM memory allocations
 * - Dirty tracking skips saves when nothing changed
 *
 * See: PRLT-1074, PRLT-1100
 */

import initSqlJs, { type Database as RawSqlJsDatabase, type SqlJsStatic } from 'sql.js'
import * as fs from 'node:fs'
import * as nodePath from 'node:path'

// =============================================================================
// WASM Module Initialization
// =============================================================================

let _SQL: SqlJsStatic | null = null

/**
 * Initialize the sql.js WASM module. Must be called once before creating
 * any SqliteDatabase instances (typically in the init hook).
 *
 * This is the only async operation — after initialization, all database
 * operations are synchronous.
 */
export async function initSqlite(): Promise<void> {
  if (!_SQL) {
    _SQL = await initSqlJs()
  }
}

/**
 * Get the initialized sql.js module. Throws if initSqlite() hasn't been called.
 */
function getSqlJs(): SqlJsStatic {
  if (!_SQL) {
    throw new Error(
      'sql.js WASM module not initialized. Call initSqlite() before creating databases.\n' +
      'This usually means the init hook did not run — check apps/cli/src/hooks/init.ts.'
    )
  }
  return _SQL
}

// =============================================================================
// Prepared Statement Wrapper
// =============================================================================

/**
 * Result of executing a statement that modifies data.
 * Compatible with better-sqlite3's RunResult.
 */
export interface RunResult {
  changes: number
  lastInsertRowid: number | bigint
}

/**
 * Wraps sql.js statement execution to provide better-sqlite3-compatible
 * .run(), .get(), .all() methods.
 *
 * Statements are re-prepared on each call for simplicity and safety.
 * For a CLI doing dozens of queries per command, the overhead is negligible.
 */
class SqlitePreparedStatement<T = any> {
  constructor(
    private db: RawSqlJsDatabase,
    private sql: string,
    private readonly _readonly: boolean = false,
    private readonly _onWrite?: () => void,
  ) {}

  /**
   * Execute the statement and return change info (INSERT/UPDATE/DELETE).
   */
  run(...params: unknown[]): RunResult {
    if (this._readonly) {
      const trimmed = this.sql.trimStart().toUpperCase()
      if (trimmed.startsWith('INSERT') || trimmed.startsWith('UPDATE') ||
          trimmed.startsWith('DELETE') || trimmed.startsWith('DROP') ||
          trimmed.startsWith('ALTER') || trimmed.startsWith('CREATE')) {
        throw new Error('attempt to write a readonly database')
      }
    }
    const stmt = this.db.prepare(this.sql)
    try {
      if (params.length > 0) {
        stmt.bind(params.map(p => p === undefined ? null : p) as any[])
      }
      stmt.step()
    } finally {
      stmt.free()
    }
    const changes = this.db.getRowsModified()
    // Get lastInsertRowid via SQL (sql.js doesn't expose it directly)
    const ridStmt = this.db.prepare('SELECT last_insert_rowid()')
    let lastInsertRowid: number = 0
    try {
      if (ridStmt.step()) {
        lastInsertRowid = ridStmt.get()[0] as number
      }
    } finally {
      ridStmt.free()
    }
    // Auto-save to disk after write (matches better-sqlite3 behavior)
    this._onWrite?.()
    return { changes, lastInsertRowid }
  }

  /**
   * Execute the statement and return the first matching row.
   */
  get(...params: unknown[]): T | undefined {
    const stmt = this.db.prepare(this.sql)
    try {
      if (params.length > 0) {
        stmt.bind(params.map(p => p === undefined ? null : p) as any[])
      }
      if (stmt.step()) {
        return stmt.getAsObject() as T
      }
      return undefined
    } finally {
      stmt.free()
    }
  }

  /**
   * Execute the statement and return all matching rows.
   */
  all(...params: unknown[]): T[] {
    const stmt = this.db.prepare(this.sql)
    const results: T[] = []
    try {
      if (params.length > 0) {
        stmt.bind(params.map(p => p === undefined ? null : p) as any[])
      }
      while (stmt.step()) {
        results.push(stmt.getAsObject() as T)
      }
      return results
    } finally {
      stmt.free()
    }
  }
}

// =============================================================================
// Shared Connection Pool (PRLT-1100)
// =============================================================================

interface SharedEntry {
  db: SqliteDatabase
  refCount: number
}

/**
 * Pool of shared database connections keyed by resolved file path.
 *
 * When multiple callers open the same database file (e.g., PMOCommand storage
 * and ExecutionStorage both opening workspace.db), they share a single
 * SqliteDatabase instance. This prevents:
 * - Duplicate WASM memory allocations for the same data
 * - Ping-pong reload cycles where each instance detects the other's saves
 *   as "external changes" and reloads the entire database
 *
 * Reference counting ensures the underlying connection stays open until
 * all callers have closed their handle.
 */
const _sharedPool: Map<string, SharedEntry> = new Map()

/**
 * Get the canonical key for a file path (resolves symlinks, relative paths).
 */
function poolKey(filePath: string): string {
  try {
    return fs.realpathSync(filePath)
  } catch {
    // File may not exist yet — use resolved absolute path
    return nodePath.resolve(filePath)
  }
}

/**
 * Clear all shared connections. Intended for tests only.
 * @internal
 */
export function _resetConnectionPool(): void {
  for (const entry of _sharedPool.values()) {
    if (entry.db.open) {
      // Force-close regardless of refCount
      entry.db._forceClose()
    }
  }
  _sharedPool.clear()
}

/**
 * Get the current number of shared entries in the pool. For diagnostics/tests.
 * @internal
 */
export function _getPoolSize(): number {
  return _sharedPool.size
}

// =============================================================================
// SqliteDatabase Class
// =============================================================================

/**
 * A synchronous SQLite database backed by sql.js (WASM).
 *
 * Provides the same API surface as better-sqlite3's Database class:
 * .prepare(), .exec(), .pragma(), .transaction(), .close()
 *
 * File persistence: Write operations automatically flush changes to disk,
 * matching better-sqlite3's write-through behavior. This ensures that
 * separate connections reading the same file see committed changes.
 *
 * ## Shared connections (PRLT-1100)
 *
 * Use `SqliteDatabase.open()` instead of `new SqliteDatabase()` to share
 * a single WASM instance for the same file path. This prevents OOM errors
 * when multiple subsystems (e.g., PMO storage + execution storage) access
 * the same database during heavy operations like `work start`.
 */
export class SqliteDatabase {
  private _db: RawSqlJsDatabase
  private _dbPath: string | null
  private _open: boolean = true
  private _readonly: boolean = false
  private _savepointCounter: number = 0
  private _transactionDepth: number = 0
  /** Timestamp of last load/save — used to detect external file modifications */
  private _lastSyncMs: number = 0
  /** Whether the in-memory state has been modified since the last save */
  private _dirty: boolean = false
  /** Whether this instance is managed by the shared connection pool */
  private _shared: boolean = false

  /**
   * Open a shared database connection for the given file path.
   *
   * If a connection to this file already exists in the pool, returns the
   * same instance with an incremented reference count. The underlying
   * connection is only closed when all callers have called close().
   *
   * This is the preferred way to open database connections. Use the
   * constructor directly only for in-memory databases or one-off opens
   * that must not be shared (e.g., backup validation in db-safety).
   */
  static open(filePath: string, options?: { readonly?: boolean }): SqliteDatabase {
    if (filePath === ':memory:') {
      return new SqliteDatabase(filePath, options)
    }

    const key = poolKey(filePath)
    const existing = _sharedPool.get(key)

    if (existing && existing.db._open) {
      existing.refCount++
      return existing.db
    }

    const db = new SqliteDatabase(filePath, options)
    db._shared = true
    _sharedPool.set(key, { db, refCount: 1 })
    return db
  }

  constructor(pathOrMemory: string, options?: { readonly?: boolean }) {
    const SQL = getSqlJs()
    this._readonly = options?.readonly ?? false

    if (pathOrMemory === ':memory:') {
      this._db = new SQL.Database()
      this._dbPath = null
    } else {
      this._dbPath = pathOrMemory
      if (fs.existsSync(pathOrMemory)) {
        const buf = fs.readFileSync(pathOrMemory)
        this._db = new SQL.Database(buf)
        this._lastSyncMs = fs.statSync(pathOrMemory).mtimeMs
      } else {
        // Create new empty database; write immediately so the file exists
        this._db = new SQL.Database()
        if (!this._readonly) {
          const data = this._db.export()
          fs.writeFileSync(pathOrMemory, data)
          this._lastSyncMs = fs.statSync(pathOrMemory).mtimeMs
        }
      }
    }
  }

  /**
   * Check if the underlying file was modified by another connection.
   * If so, reload the database from disk to see the latest changes.
   * This provides behavior similar to better-sqlite3's shared file access.
   */
  private _checkForExternalChanges(): void {
    if (!this._dbPath || !this._open || this._transactionDepth > 0) return
    try {
      const currentMtime = fs.statSync(this._dbPath).mtimeMs
      if (currentMtime > this._lastSyncMs) {
        this.reload()
      }
    } catch {
      // File may have been deleted — ignore
    }
  }

  /**
   * Prepare a SQL statement for execution.
   * Returns an object with .run(), .get(), .all() methods
   * compatible with better-sqlite3's prepared statements.
   */
  prepare<T = any>(sql: string): SqlitePreparedStatement<T> {
    this._checkForExternalChanges()
    return new SqlitePreparedStatement<T>(this._db, sql, this._readonly, () => this._autoSave())
  }

  /**
   * Execute raw SQL (DDL, multi-statement). No return value.
   */
  exec(sql: string): void {
    this._checkForExternalChanges()
    if (this._readonly) {
      const trimmed = sql.trimStart().toUpperCase()
      if (trimmed.startsWith('INSERT') || trimmed.startsWith('UPDATE') ||
          trimmed.startsWith('DELETE') || trimmed.startsWith('DROP') ||
          trimmed.startsWith('ALTER') || trimmed.startsWith('CREATE')) {
        throw new Error('attempt to write a readonly database')
      }
    }
    this._db.run(sql)
    this._autoSave()
  }

  /**
   * Get or set SQLite pragmas.
   * Converts better-sqlite3's pragma syntax to sql.js exec calls.
   *
   * Note: WAL mode and busy_timeout are no-ops in sql.js (in-memory).
   * They execute without error but don't change behavior.
   */
  pragma(source: string, options?: { simple?: boolean }): unknown {
    try {
      const results = this._db.exec(`PRAGMA ${source}`)
      if (results.length === 0) {
        return options?.simple ? undefined : []
      }

      const columns = results[0].columns
      if (options?.simple) {
        return results[0].values[0]?.[0]
      }

      // Return as array of objects (same shape as better-sqlite3)
      return results[0].values.map((row: any[]) => {
        const obj: Record<string, unknown> = {}
        columns.forEach((col: string, i: number) => {
          obj[col] = row[i]
        })
        return obj
      })
    } catch {
      // Some pragmas may not be supported in sql.js; return safe defaults
      return options?.simple ? undefined : []
    }
  }

  /**
   * Create a transaction function.
   * Returns a new function that, when called, runs the wrapped function
   * inside a SQLite transaction.
   *
   * Uses SAVEPOINT/RELEASE for all levels, which correctly handles:
   * - Top-level calls (SAVEPOINT implicitly starts a transaction)
   * - Nested calls within other transactions
   * - Calls within externally-created savepoints (e.g., test helpers)
   *
   * Auto-save is deferred until the outermost transaction completes,
   * so nested writes don't flush to disk until the whole transaction commits.
   */
  transaction<F extends (...args: unknown[]) => unknown>(fn: F): F {
    return ((...args: unknown[]) => {
      const savepointName = `sp_${++this._savepointCounter}`
      this._transactionDepth++
      this._db.run(`SAVEPOINT ${savepointName}`)
      try {
        const result = fn(...args)
        this._db.run(`RELEASE ${savepointName}`)
        this._transactionDepth--
        if (this._transactionDepth === 0) {
          this._autoSave()
        }
        return result
      } catch (e) {
        this._db.run(`ROLLBACK TO ${savepointName}`)
        this._db.run(`RELEASE ${savepointName}`)
        this._transactionDepth--
        throw e
      }
    }) as unknown as F
  }

  /**
   * Auto-save to disk after write operations when not inside a transaction.
   * This matches better-sqlite3's write-through behavior where changes
   * are visible to other connections immediately.
   */
  private _autoSave(): void {
    this._dirty = true
    if (this._transactionDepth === 0) {
      this.save()
    }
  }

  /**
   * Close the database connection and write changes to disk.
   *
   * For shared connections (created via SqliteDatabase.open()), this
   * decrements the reference count. The underlying WASM database is
   * only closed when the last reference is released.
   */
  close(): void {
    if (!this._open) return

    if (this._shared && this._dbPath) {
      const key = poolKey(this._dbPath)
      const entry = _sharedPool.get(key)
      if (entry && entry.refCount > 1) {
        entry.refCount--
        // Don't close — other callers still using this instance.
        // Flush any pending changes so they're visible on disk.
        if (this._dirty) this.save()
        return
      }
      // Last reference — remove from pool and close for real
      _sharedPool.delete(key)
    }

    this._flushToDisk()
    this._db.close()
    this._open = false
  }

  /**
   * Force-close the database regardless of reference count.
   * Used only by _resetConnectionPool() for test cleanup.
   * @internal
   */
  _forceClose(): void {
    if (!this._open) return
    this._flushToDisk()
    this._db.close()
    this._open = false
  }

  /**
   * Write the current in-memory database to the file on disk.
   * No-op for in-memory databases, readonly connections, or clean state.
   *
   * PRLT-1100: Writes the Uint8Array from export() directly instead of
   * copying through Buffer.from(), saving ~2MB per save for a typical
   * workspace database.
   */
  save(): void {
    if (this._dbPath && !this._readonly && this._open && this._dirty) {
      this._flushToDisk()
    }
  }

  /**
   * Unconditional write to disk. Used by close() for final flush
   * and by save() when dirty.
   */
  private _flushToDisk(): void {
    if (this._dbPath && !this._readonly && this._open) {
      const data = this._db.export()
      fs.writeFileSync(this._dbPath, data)
      this._lastSyncMs = fs.statSync(this._dbPath).mtimeMs
      this._dirty = false
    }
  }

  /**
   * Reload the database from disk, refreshing the in-memory state.
   * Useful when another connection has modified the same file.
   * No-op for in-memory databases.
   */
  reload(): void {
    if (!this._dbPath || !this._open) return
    if (fs.existsSync(this._dbPath)) {
      const buf = fs.readFileSync(this._dbPath)
      this._db.close()
      const SQL = getSqlJs()
      this._db = new SQL.Database(buf)
      this._lastSyncMs = fs.statSync(this._dbPath).mtimeMs
      this._dirty = false
    }
  }

  /**
   * Whether the database connection is open.
   */
  get open(): boolean {
    return this._open
  }

  /**
   * Whether this connection is shared via the connection pool.
   */
  get isShared(): boolean {
    return this._shared
  }

  /**
   * Access the underlying raw sql.js Database instance.
   * Used for Drizzle ORM interop.
   * @internal
   */
  get rawDatabase(): RawSqlJsDatabase {
    return this._db
  }
}

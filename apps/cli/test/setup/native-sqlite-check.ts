import { initSqlite } from '../../src/lib/database/sqlite.js'

/**
 * Initialize sql.js WASM module before tests run.
 * This replaces the old better-sqlite3 native binding check.
 */
await initSqlite()

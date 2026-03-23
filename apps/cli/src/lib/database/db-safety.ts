/**
 * Database Safety — WAL mode, auto-backup, corruption recovery.
 *
 * Provides:
 * - WAL journal mode configuration
 * - Rotating backup (keeps last 5 copies)
 * - Integrity check on open with auto-recovery
 * - Manual repair via dump/reimport
 *
 * See: PRLT-1081
 */

import { SqliteDatabase } from './sqlite.js'
import * as fs from 'node:fs'
import * as path from 'node:path'

const MAX_BACKUPS = 5

/**
 * Enable WAL journal mode on a database connection.
 * WAL allows concurrent readers with one writer and is significantly
 * more resistant to corruption than the default journal_mode=delete.
 *
 * Note: With sql.js (in-memory), WAL mode is a no-op but executes without error.
 */
export function enableWALMode(db: SqliteDatabase): void {
  db.pragma('journal_mode = WAL')
}

/**
 * Get the backup path for a given database path and backup number.
 */
export function getBackupPath(dbPath: string, n: number): string {
  return `${dbPath}.backup.${n}`
}

/**
 * Create a rotating backup of the database file.
 * Keeps the last MAX_BACKUPS copies, numbered 1 (newest) through MAX_BACKUPS (oldest).
 * Rotates existing backups before copying the current database.
 *
 * Returns true if backup was created, false if source didn't exist.
 */
export function createRotatingBackup(dbPath: string): boolean {
  if (!fs.existsSync(dbPath)) {
    return false
  }

  // Rotate existing backups: delete oldest, shift others up
  const oldest = getBackupPath(dbPath, MAX_BACKUPS)
  if (fs.existsSync(oldest)) {
    fs.unlinkSync(oldest)
  }

  for (let i = MAX_BACKUPS - 1; i >= 1; i--) {
    const src = getBackupPath(dbPath, i)
    const dst = getBackupPath(dbPath, i + 1)
    if (fs.existsSync(src)) {
      fs.renameSync(src, dst)
    }
  }

  // Copy current database as backup.1 (newest)
  try {
    fs.copyFileSync(dbPath, getBackupPath(dbPath, 1))
    // Also copy WAL and SHM files if they exist (for WAL-mode databases)
    const walPath = `${dbPath}-wal`
    const shmPath = `${dbPath}-shm`
    if (fs.existsSync(walPath)) {
      fs.copyFileSync(walPath, `${getBackupPath(dbPath, 1)}-wal`)
    }
    if (fs.existsSync(shmPath)) {
      fs.copyFileSync(shmPath, `${getBackupPath(dbPath, 1)}-shm`)
    }
    return true
  } catch {
    // Backup failure is not fatal — log and continue
    return false
  }
}

export interface IntegrityCheckResult {
  ok: boolean
  errors: string[]
}

/**
 * Run PRAGMA integrity_check on a database.
 * Returns { ok: true } if the database is healthy, or { ok: false, errors } with details.
 */
export function checkIntegrity(db: SqliteDatabase): IntegrityCheckResult {
  try {
    const rows = db.pragma('integrity_check') as { integrity_check: string }[]
    const errors = rows
      .map(r => r.integrity_check)
      .filter(msg => msg !== 'ok')

    return { ok: errors.length === 0, errors }
  } catch (error) {
    return {
      ok: false,
      errors: [error instanceof Error ? error.message : String(error)],
    }
  }
}

/**
 * Quick integrity check using PRAGMA quick_check (faster than full integrity_check).
 * Skips checking that the contents of table rows match the indexes.
 */
export function quickCheckIntegrity(db: SqliteDatabase): IntegrityCheckResult {
  try {
    const rows = db.pragma('quick_check') as { quick_check: string }[]
    const errors = rows
      .map(r => r.quick_check)
      .filter(msg => msg !== 'ok')

    return { ok: errors.length === 0, errors }
  } catch (error) {
    return {
      ok: false,
      errors: [error instanceof Error ? error.message : String(error)],
    }
  }
}

export interface RepairResult {
  success: boolean
  method: 'dump-reimport' | 'backup-restore' | 'none'
  message: string
}

/**
 * Attempt to repair a corrupted database.
 *
 * Strategy:
 * 1. Try dump/reimport — opens the corrupt DB, dumps all SQL, creates a new DB
 * 2. If dump fails, fall back to the most recent backup
 *
 * The original corrupt file is preserved as dbPath.corrupt for forensics.
 */
export function repairDatabase(dbPath: string): RepairResult {
  // Try dump/reimport first
  const dumpResult = attemptDumpReimport(dbPath)
  if (dumpResult.success) {
    return dumpResult
  }

  // Fall back to backup restore
  const backupResult = attemptBackupRestore(dbPath)
  if (backupResult.success) {
    return backupResult
  }

  return {
    success: false,
    method: 'none',
    message: `Could not repair database. Dump failed: ${dumpResult.message}. No usable backups found.`,
  }
}

/**
 * Attempt recovery via .dump and reimport.
 * Opens the corrupt database, extracts as much SQL as possible,
 * then creates a fresh database from that SQL.
 */
function attemptDumpReimport(dbPath: string): RepairResult {
  let corruptDb: SqliteDatabase | null = null
  let newDb: SqliteDatabase | null = null
  const tempPath = `${dbPath}.repair-temp`

  try {
    // Open corrupt database — may partially work
    corruptDb = new SqliteDatabase(dbPath, { readonly: true })

    // Dump all recoverable SQL
    const tables = corruptDb.prepare(
      "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY CASE type WHEN 'table' THEN 1 WHEN 'index' THEN 2 ELSE 3 END"
    ).all() as { sql: string }[]

    if (tables.length === 0) {
      return { success: false, method: 'dump-reimport', message: 'No tables found in corrupt database' }
    }

    // Create new database with recovered schema
    newDb = new SqliteDatabase(tempPath)
    newDb.pragma('journal_mode = WAL')

    for (const { sql } of tables) {
      try {
        newDb.exec(sql)
      } catch {
        // Skip objects that fail to recreate (e.g., references to missing tables)
      }
    }

    // Copy data table by table
    const tableNames = corruptDb.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).all() as { name: string }[]

    let rowsRecovered = 0
    for (const { name } of tableNames) {
      try {
        const rows = corruptDb.prepare(`SELECT * FROM "${name}"`).all()
        if (rows.length === 0) continue

        const columns = Object.keys(rows[0] as Record<string, unknown>)
        const placeholders = columns.map(() => '?').join(', ')
        const insertSql = `INSERT OR IGNORE INTO "${name}" (${columns.map(c => `"${c}"`).join(', ')}) VALUES (${placeholders})`

        const insertStmt = newDb.prepare(insertSql)
        const insertAll = newDb.transaction((data: Record<string, unknown>[]) => {
          for (const row of data) {
            insertStmt.run(...columns.map(c => row[c]))
          }
        })

        insertAll(rows as Record<string, unknown>[])
        rowsRecovered += rows.length
      } catch {
        // Skip tables that can't be read
      }
    }

    corruptDb.close()
    corruptDb = null
    newDb.close()
    newDb = null

    // Swap files: corrupt → .corrupt, repaired → original
    const corruptBackupPath = `${dbPath}.corrupt`
    if (fs.existsSync(corruptBackupPath)) {
      fs.unlinkSync(corruptBackupPath)
    }
    fs.renameSync(dbPath, corruptBackupPath)
    fs.renameSync(tempPath, dbPath)

    // Clean up old WAL/SHM files from the corrupt database
    for (const suffix of ['-wal', '-shm']) {
      const f = `${dbPath}${suffix}`
      if (fs.existsSync(f)) {
        fs.unlinkSync(f)
      }
    }

    return {
      success: true,
      method: 'dump-reimport',
      message: `Recovered ${rowsRecovered} rows from ${tableNames.length} tables. Corrupt file saved as ${path.basename(corruptBackupPath)}.`,
    }
  } catch (error) {
    // Clean up on failure
    if (corruptDb) {
      try { corruptDb.close() } catch { /* ignore */ }
    }
    if (newDb) {
      try { newDb.close() } catch { /* ignore */ }
    }
    if (fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath) } catch { /* ignore */ }
    }

    return {
      success: false,
      method: 'dump-reimport',
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Attempt recovery by restoring from the most recent valid backup.
 * Tries backups 1 through MAX_BACKUPS, validates each with integrity_check.
 */
function attemptBackupRestore(dbPath: string): RepairResult {
  for (let i = 1; i <= MAX_BACKUPS; i++) {
    const backupPath = getBackupPath(dbPath, i)
    if (!fs.existsSync(backupPath)) {
      continue
    }

    // Validate the backup
    let backupDb: SqliteDatabase | null = null
    try {
      backupDb = new SqliteDatabase(backupPath, { readonly: true })
      const check = checkIntegrity(backupDb)
      backupDb.close()
      backupDb = null

      if (!check.ok) {
        continue
      }

      // Backup is valid — swap it in
      const corruptBackupPath = `${dbPath}.corrupt`
      if (fs.existsSync(corruptBackupPath)) {
        fs.unlinkSync(corruptBackupPath)
      }
      fs.renameSync(dbPath, corruptBackupPath)
      fs.copyFileSync(backupPath, dbPath)

      // Clean up old WAL/SHM files
      for (const suffix of ['-wal', '-shm']) {
        const f = `${dbPath}${suffix}`
        if (fs.existsSync(f)) {
          fs.unlinkSync(f)
        }
      }

      return {
        success: true,
        method: 'backup-restore',
        message: `Restored from backup.${i}. Corrupt file saved as ${path.basename(corruptBackupPath)}.`,
      }
    } catch {
      if (backupDb) {
        try { backupDb.close() } catch { /* ignore */ }
      }
      continue
    }
  }

  return {
    success: false,
    method: 'backup-restore',
    message: 'No valid backups found',
  }
}

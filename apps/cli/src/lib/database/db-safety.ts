/**
 * Database Safety — WAL mode, auto-backup, corruption recovery.
 *
 * Provides:
 * - WAL journal mode configuration
 * - Timestamped backup in .proletariat/backups/ (keeps last 5)
 * - Integrity check on open with auto-recovery
 * - Manual repair via dump/reimport
 * - Migration of legacy scattered backup files
 *
 * See: PRLT-1081, PRLT-1154
 */

import Database from 'better-sqlite3'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { throwIfNativeBindingError } from './native-validation.js'

const MAX_BACKUPS = 5

/**
 * Enable WAL journal mode on a database connection.
 * WAL allows concurrent readers with one writer and is significantly
 * more resistant to corruption than the default journal_mode=delete.
 */
export function enableWALMode(db: Database.Database): void {
  db.pragma('journal_mode = WAL')
}

/**
 * Get the backups directory for a given database path.
 * The backups directory is always a sibling `backups/` directory
 * relative to the database file (e.g., `.proletariat/backups/`).
 */
export function getBackupsDir(dbPath: string): string {
  return path.join(path.dirname(dbPath), 'backups')
}

/**
 * Get the backup path for a given database path and backup number.
 * Backups are stored in the backups/ directory with timestamps.
 *
 * For numbered access (used by backup restore), returns a path
 * based on sorted backup files in the directory.
 * Returns null if the backup doesn't exist.
 */
export function getBackupPath(dbPath: string, n: number): string | null {
  const backupsDir = getBackupsDir(dbPath)
  if (!fs.existsSync(backupsDir)) {
    return null
  }

  const backups = listBackupFiles(backupsDir)
  if (n < 1 || n > backups.length) {
    return null
  }

  // backups are sorted newest-first, so n=1 is the most recent
  return backups[n - 1]
}

/**
 * List backup files in the backups directory, sorted newest-first.
 * Only returns .db files (excludes -wal, -shm, and .corrupt files).
 */
function listBackupFiles(backupsDir: string): string[] {
  if (!fs.existsSync(backupsDir)) {
    return []
  }

  const files = fs.readdirSync(backupsDir)
    .filter(f => f.endsWith('.db') && !f.endsWith('.corrupt.db'))
    .map(f => path.join(backupsDir, f))
    .sort((a, b) => {
      // Sort by modification time, newest first
      const statA = fs.statSync(a)
      const statB = fs.statSync(b)
      return statB.mtimeMs - statA.mtimeMs
    })

  return files
}

/**
 * Generate a timestamped backup filename.
 */
function generateBackupName(): string {
  const now = new Date()
  const ts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '-',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('')
  return `workspace-${ts}.db`
}

/**
 * Create a timestamped backup of the database file in the backups/ directory.
 * Keeps the last MAX_BACKUPS copies, deletes older ones.
 *
 * Returns the backup path if created, null if source didn't exist.
 */
export function createRotatingBackup(dbPath: string): string | null {
  if (!fs.existsSync(dbPath)) {
    return null
  }

  const backupsDir = getBackupsDir(dbPath)
  fs.mkdirSync(backupsDir, { recursive: true })

  const backupName = generateBackupName()
  const backupPath = path.join(backupsDir, backupName)

  // Copy current database as timestamped backup
  try {
    fs.copyFileSync(dbPath, backupPath)
    // Also copy WAL and SHM files if they exist (for WAL-mode databases)
    const walPath = `${dbPath}-wal`
    const shmPath = `${dbPath}-shm`
    if (fs.existsSync(walPath)) {
      fs.copyFileSync(walPath, `${backupPath}-wal`)
    }
    if (fs.existsSync(shmPath)) {
      fs.copyFileSync(shmPath, `${backupPath}-shm`)
    }
  } catch {
    // Backup failure is not fatal — log and continue
    return null
  }

  // Rotate: delete older backups beyond MAX_BACKUPS
  rotateBackups(backupsDir)

  return backupPath
}

/**
 * Delete older backups beyond MAX_BACKUPS.
 * Keeps the newest MAX_BACKUPS .db files, deletes the rest
 * (along with their -wal and -shm companions).
 */
function rotateBackups(backupsDir: string): void {
  const backups = listBackupFiles(backupsDir)

  // Keep the first MAX_BACKUPS, delete the rest
  for (let i = MAX_BACKUPS; i < backups.length; i++) {
    const bp = backups[i]
    try {
      fs.unlinkSync(bp)
      // Also clean up WAL and SHM companions
      for (const suffix of ['-wal', '-shm']) {
        const companion = `${bp}${suffix}`
        if (fs.existsSync(companion)) {
          fs.unlinkSync(companion)
        }
      }
    } catch {
      // Best-effort cleanup
    }
  }
}

/**
 * Create a manual backup with an optional label.
 * Unlike auto-backups, manual backups include a "manual" prefix.
 * Returns the backup path.
 */
export function createManualBackup(dbPath: string, label?: string): string | null {
  if (!fs.existsSync(dbPath)) {
    return null
  }

  const backupsDir = getBackupsDir(dbPath)
  fs.mkdirSync(backupsDir, { recursive: true })

  const now = new Date()
  const ts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '-',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('')

  const suffix = label ? `-${label}` : ''
  const backupName = `workspace-manual-${ts}${suffix}.db`
  const backupPath = path.join(backupsDir, backupName)

  try {
    fs.copyFileSync(dbPath, backupPath)
    const walPath = `${dbPath}-wal`
    const shmPath = `${dbPath}-shm`
    if (fs.existsSync(walPath)) {
      fs.copyFileSync(walPath, `${backupPath}-wal`)
    }
    if (fs.existsSync(shmPath)) {
      fs.copyFileSync(shmPath, `${backupPath}-shm`)
    }
    return backupPath
  } catch {
    return null
  }
}

/**
 * Migrate legacy backup files from the .proletariat/ top level into backups/.
 *
 * Handles:
 * - workspace.db.backup (plain backup)
 * - workspace.db.backup-YYYYMMDD-HHMMSS (timestamped backups)
 * - workspace.db.backup.N (numbered backups with -wal/-shm companions)
 * - workspace.db.corrupt (corrupt file preservations)
 *
 * Called on first run after upgrade. Safe to call multiple times.
 */
export function migrateExistingBackups(dbPath: string): void {
  const proletariatDir = path.dirname(dbPath)
  const backupsDir = getBackupsDir(dbPath)
  const dbBasename = path.basename(dbPath) // workspace.db

  let files: string[]
  try {
    files = fs.readdirSync(proletariatDir)
  } catch {
    return
  }

  // Find legacy backup/corrupt files at the top level
  const legacyFiles = files.filter(f => {
    // Match workspace.db.backup*, workspace.db.corrupt*
    if (f.startsWith(`${dbBasename}.backup`) || f.startsWith(`${dbBasename}.corrupt`)) {
      return true
    }
    // Match workspace.db.repair-temp (leftover from failed repairs)
    if (f === `${dbBasename}.repair-temp`) {
      return true
    }
    return false
  })

  if (legacyFiles.length === 0) {
    return
  }

  // Ensure backups directory exists
  fs.mkdirSync(backupsDir, { recursive: true })

  for (const file of legacyFiles) {
    const srcPath = path.join(proletariatDir, file)
    let destName: string

    if (file.endsWith('.corrupt') || file.includes('.corrupt')) {
      // Corrupt files → workspace-corrupt-TIMESTAMP.db or just move as-is
      const stat = fs.statSync(srcPath)
      const ts = formatTimestamp(stat.mtime)
      destName = `workspace-corrupt-${ts}.db`
    } else if (file === `${dbBasename}.backup`) {
      // Plain backup → workspace-migrated-TIMESTAMP.db
      const stat = fs.statSync(srcPath)
      const ts = formatTimestamp(stat.mtime)
      destName = `workspace-migrated-${ts}.db`
    } else if (file.match(/\.backup-\d{8}-\d{6}$/)) {
      // Timestamped backup (workspace.db.backup-20260106-112422)
      const match = file.match(/\.backup-(\d{8}-\d{6})$/)
      destName = `workspace-migrated-${match![1]}.db`
    } else if (file.match(/\.backup\.\d+$/)) {
      // Numbered backup (workspace.db.backup.1)
      const stat = fs.statSync(srcPath)
      const ts = formatTimestamp(stat.mtime)
      destName = `workspace-migrated-${ts}.db`
    } else if (file.match(/\.backup\.\d+-(wal|shm)$/)) {
      // WAL/SHM companion for numbered backup — these follow their .db file
      // Skip them here; they'll be handled when we move the main backup
      continue
    } else if (file === `${dbBasename}.repair-temp`) {
      // Leftover repair temp file — just move it
      destName = 'workspace-repair-temp.db'
    } else {
      // Fallback: use file modification time
      const stat = fs.statSync(srcPath)
      const ts = formatTimestamp(stat.mtime)
      destName = `workspace-legacy-${ts}.db`
    }

    const destPath = path.join(backupsDir, destName)

    // Don't overwrite existing files in backups/
    if (fs.existsSync(destPath)) {
      // Add a suffix to avoid collision
      const ext = path.extname(destName)
      const base = destName.slice(0, -ext.length)
      const uniqueDest = path.join(backupsDir, `${base}-${Date.now()}${ext}`)
      try {
        fs.renameSync(srcPath, uniqueDest)
      } catch {
        // Best-effort migration
      }
    } else {
      try {
        fs.renameSync(srcPath, destPath)
      } catch {
        // Best-effort migration
      }
    }

    // Also move WAL/SHM companions if they exist
    for (const suffix of ['-wal', '-shm']) {
      const companionSrc = `${srcPath}${suffix}`
      if (fs.existsSync(companionSrc)) {
        const companionDest = `${destPath}${suffix}`
        try {
          fs.renameSync(companionSrc, companionDest)
        } catch {
          // Best-effort
        }
      }
    }
  }

  // After migration, rotate to keep only MAX_BACKUPS
  rotateBackups(backupsDir)
}

/**
 * Format a Date as YYYYMMDD-HHMMSS for backup filenames.
 */
function formatTimestamp(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
    '-',
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0'),
  ].join('')
}

/**
 * List all backup entries with metadata, sorted newest-first.
 * Used by the repair and backup commands to display backup info.
 */
export function listBackups(dbPath: string): Array<{
  path: string
  filename: string
  size: number
  mtime: Date
}> {
  const backupsDir = getBackupsDir(dbPath)
  const backups = listBackupFiles(backupsDir)

  return backups.map(bp => {
    const stat = fs.statSync(bp)
    return {
      path: bp,
      filename: path.basename(bp),
      size: stat.size,
      mtime: stat.mtime,
    }
  })
}

export interface IntegrityCheckResult {
  ok: boolean
  errors: string[]
}

/**
 * Run PRAGMA integrity_check on a database.
 * Returns { ok: true } if the database is healthy, or { ok: false, errors } with details.
 */
export function checkIntegrity(db: Database.Database): IntegrityCheckResult {
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
export function quickCheckIntegrity(db: Database.Database): IntegrityCheckResult {
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
 * The original corrupt file is preserved in backups/ for forensics.
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
 * Move a corrupt database file to the backups/ directory with a .corrupt suffix.
 * Returns the destination path.
 */
function moveCorruptToBackups(dbPath: string): string {
  const backupsDir = getBackupsDir(dbPath)
  fs.mkdirSync(backupsDir, { recursive: true })

  const ts = formatTimestamp(new Date())
  const corruptName = `workspace-corrupt-${ts}.db`
  const corruptPath = path.join(backupsDir, corruptName)

  fs.renameSync(dbPath, corruptPath)
  return corruptPath
}

/**
 * Attempt recovery via .dump and reimport.
 * Opens the corrupt database, extracts as much SQL as possible,
 * then creates a fresh database from that SQL.
 */
function attemptDumpReimport(dbPath: string): RepairResult {
  let corruptDb: Database.Database | null = null
  let newDb: Database.Database | null = null
  const tempPath = `${dbPath}.repair-temp`

  try {
    // Open corrupt database — may partially work
    corruptDb = new Database(dbPath, { readonly: true })

    // Dump all recoverable SQL
    const tables = corruptDb.prepare(
      "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY CASE type WHEN 'table' THEN 1 WHEN 'index' THEN 2 ELSE 3 END"
    ).all() as { sql: string }[]

    if (tables.length === 0) {
      return { success: false, method: 'dump-reimport', message: 'No tables found in corrupt database' }
    }

    // Create new database with recovered schema
    newDb = new Database(tempPath)
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

    // Move corrupt file to backups/ directory
    const corruptBackupPath = moveCorruptToBackups(dbPath)

    // Move repaired database into place
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
      try { corruptDb.close() } catch { /* db handle may already be invalid — safe to ignore during cleanup */ }
    }
    if (newDb) {
      try { newDb.close() } catch { /* db handle may already be invalid — safe to ignore during cleanup */ }
    }
    if (fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath) } catch { /* temp file cleanup is best-effort */ }
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
 * Tries backups from newest to oldest, validates each with integrity_check.
 */
function attemptBackupRestore(dbPath: string): RepairResult {
  const backupsDir = getBackupsDir(dbPath)
  const backups = listBackupFiles(backupsDir)

  for (let i = 0; i < backups.length; i++) {
    const backupPath = backups[i]

    // Validate the backup
    let backupDb: Database.Database | null = null
    try {
      backupDb = new Database(backupPath, { readonly: true })
      const check = checkIntegrity(backupDb)
      backupDb.close()
      backupDb = null

      if (!check.ok) {
        continue
      }

      // Backup is valid — swap it in
      const corruptBackupPath = moveCorruptToBackups(dbPath)
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
        message: `Restored from ${path.basename(backupPath)}. Corrupt file saved as ${path.basename(corruptBackupPath)}.`,
      }
    } catch {
      if (backupDb) {
        try { backupDb.close() } catch { /* db handle may already be invalid — safe to ignore during cleanup */ }
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

import { Command, Flags } from '@oclif/core'
import * as fs from 'node:fs'
import { SqliteDatabase } from '../../lib/database/sqlite.js'
import { styles } from '../../lib/styles.js'
import {
  getDatabasePath,
  checkIntegrity,
  repairDatabase,
  getBackupPath,
} from '../../lib/database/index.js'
import {
  getRegisteredHeadquarters,
  getActiveWorkspace,
} from '../../lib/machine-config.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import { shouldOutputJson, createMetadata } from '../../lib/prompt-json.js'

export default class DbRepair extends Command {
  static description = 'Check database integrity and repair corruption'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --check-only',
    '<%= config.bin %> <%= command.id %> --workspace /path/to/hq',
  ]

  static flags = {
    ...machineOutputFlags,
    'check-only': Flags.boolean({
      description: 'Only check integrity, do not attempt repair',
      default: false,
    }),
    workspace: Flags.string({
      char: 'w',
      description: 'Path to workspace (defaults to active workspace)',
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(DbRepair)

    const workspacePath = this.resolveWorkspacePath(flags.workspace)
    if (!workspacePath) {
      this.error('No workspace found. Run "prlt new" first or specify --workspace.')
    }

    const dbPath = getDatabasePath(workspacePath)
    if (!fs.existsSync(dbPath)) {
      this.error(`Database not found: ${dbPath}`)
    }

    // JSON output
    if (shouldOutputJson(flags)) {
      const result = this.runCheck(dbPath, flags['check-only'])
      this.log(JSON.stringify({
        ...result,
        dbPath,
        workspace: workspacePath,
      }, null, 2))
      return
    }

    this.log(`\n${styles.header('Database Repair')}`)
    this.log('─'.repeat(50))
    this.log(styles.muted(`Database: ${dbPath}`))

    // List available backups
    this.log(styles.subheader('\nBackups:'))
    let backupCount = 0
    for (let i = 1; i <= 5; i++) {
      const bp = getBackupPath(dbPath, i)
      if (fs.existsSync(bp)) {
        const stat = fs.statSync(bp)
        this.log(`  ${styles.code(`backup.${i}`)} — ${styles.muted(stat.mtime.toISOString())} (${formatBytes(stat.size)})`)
        backupCount++
      }
    }
    if (backupCount === 0) {
      this.log(styles.muted('  No backups found'))
    }

    // Run integrity check
    this.log(styles.subheader('\nIntegrity check:'))
    let db: SqliteDatabase | null = null
    try {
      db = new SqliteDatabase(dbPath, { readonly: true })
      const check = checkIntegrity(db)
      db.close()
      db = null

      if (check.ok) {
        this.log(styles.success('  Database is healthy.'))

        // Show journal mode
        const readDb = new SqliteDatabase(dbPath, { readonly: true })
        const mode = readDb.pragma('journal_mode', { simple: true })
        readDb.close()
        this.log(styles.muted(`  Journal mode: ${mode}`))
        this.log('')
        return
      }

      this.log(styles.error(`  Corruption detected (${check.errors.length} error(s)):`))
      for (const err of check.errors.slice(0, 10)) {
        this.log(styles.muted(`    - ${err}`))
      }
      if (check.errors.length > 10) {
        this.log(styles.muted(`    ... and ${check.errors.length - 10} more`))
      }
    } catch (error) {
      if (db) {
        try { db.close() } catch { /* ignore */ }
      }
      this.log(styles.error(`  Could not open database: ${error instanceof Error ? error.message : error}`))
    }

    if (flags['check-only']) {
      this.log(styles.muted('\n  --check-only: skipping repair'))
      this.log('')
      return
    }

    // Attempt repair
    this.log(styles.subheader('\nAttempting repair:'))
    const repair = repairDatabase(dbPath)

    if (repair.success) {
      this.log(styles.success(`  Repaired via ${repair.method}.`))
      this.log(styles.muted(`  ${repair.message}`))
    } else {
      this.log(styles.error('  Repair failed.'))
      this.log(styles.muted(`  ${repair.message}`))
      this.log(styles.muted('  You may need to manually restore from an external backup.'))
    }
    this.log('')
  }

  private resolveWorkspacePath(explicit?: string): string | null {
    if (explicit) {
      return fs.existsSync(explicit) ? explicit : null
    }

    // Try active workspace first (returns a path string or null)
    const active = getActiveWorkspace()
    if (active && fs.existsSync(active)) {
      return active
    }

    // Fall back to first registered HQ
    const hqs = getRegisteredHeadquarters()
    for (const hq of hqs) {
      if (fs.existsSync(hq.path)) {
        return hq.path
      }
    }

    return null
  }

  private runCheck(dbPath: string, checkOnly: boolean): Record<string, unknown> {
    let db: SqliteDatabase | null = null
    try {
      db = new SqliteDatabase(dbPath, { readonly: true })
      const check = checkIntegrity(db)
      db.close()
      db = null

      if (check.ok) {
        return { status: 'healthy', errors: [] }
      }

      if (checkOnly) {
        return { status: 'corrupt', errors: check.errors, repaired: false }
      }

      const repair = repairDatabase(dbPath)
      return {
        status: 'corrupt',
        errors: check.errors,
        repaired: repair.success,
        repairMethod: repair.method,
        repairMessage: repair.message,
      }
    } catch (error) {
      if (db) {
        try { db.close() } catch { /* ignore */ }
      }

      if (checkOnly) {
        return { status: 'error', errors: [error instanceof Error ? error.message : String(error)], repaired: false }
      }

      const repair = repairDatabase(dbPath)
      return {
        status: 'error',
        errors: [error instanceof Error ? error.message : String(error)],
        repaired: repair.success,
        repairMethod: repair.method,
        repairMessage: repair.message,
      }
    }
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

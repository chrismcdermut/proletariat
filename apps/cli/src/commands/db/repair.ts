import { Command, Flags } from '@oclif/core'
import * as fs from 'node:fs'
import Database from 'better-sqlite3'
import { styles } from '../../lib/styles.js'
import {
  getDatabasePath,
  checkIntegrity,
  checkSchemaCompleteness,
  addMissingColumns,
  repairDatabase,
  listBackups,
} from '../../lib/database/index.js'
import { runDrizzleMigrations } from '../../lib/database/migrator.js'
import { ALL_MIGRATIONS } from '../../lib/database/migrations/index.js'
import {
  getRegisteredHeadquarters,
  getActiveWorkspace,
} from '../../lib/machine-config.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import { shouldOutputJson } from '../../lib/prompt-json.js'

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
    this.log('\u2500'.repeat(50))
    this.log(styles.muted(`Database: ${dbPath}`))

    // List available backups from backups/ directory
    this.log(styles.subheader('\nBackups:'))
    const backups = listBackups(dbPath)
    if (backups.length > 0) {
      for (const backup of backups) {
        this.log(`  ${styles.code(backup.filename)} \u2014 ${styles.muted(backup.mtime.toISOString())} (${formatBytes(backup.size)})`)
      }
    } else {
      this.log(styles.muted('  No backups found'))
    }

    // Run integrity check
    this.log(styles.subheader('\nIntegrity check:'))
    let db: Database.Database | null = null
    let corruptionDetected = false
    try {
      db = new Database(dbPath, { readonly: true })
      const check = checkIntegrity(db)

      if (check.ok) {
        this.log(styles.success('  PRAGMA integrity_check: ok'))
      } else {
        corruptionDetected = true
        this.log(styles.error(`  Corruption detected (${check.errors.length} error(s)):`))
        for (const err of check.errors.slice(0, 10)) {
          this.log(styles.muted(`    - ${err}`))
        }
        if (check.errors.length > 10) {
          this.log(styles.muted(`    ... and ${check.errors.length - 10} more`))
        }
      }

      // Schema completeness check (PRLT-1131)
      this.log(styles.subheader('\nSchema check:'))
      const schema = checkSchemaCompleteness(db)
      db.close()
      db = null

      if (schema.ok) {
        this.log(styles.success('  All expected columns present.'))
      } else {
        if (schema.missingTables.length > 0) {
          this.log(styles.error(`  Missing tables (${schema.missingTables.length}):`))
          for (const table of schema.missingTables) {
            this.log(styles.muted(`    - ${table}`))
          }
        }
        if (schema.missingColumns.length > 0) {
          this.log(styles.error(`  Missing columns (${schema.missingColumns.length}):`))
          for (const { table, column } of schema.missingColumns) {
            this.log(styles.muted(`    - ${table}.${column}`))
          }
        }
      }

      if (!corruptionDetected && schema.ok) {
        // Show journal mode
        const readDb = new Database(dbPath, { readonly: true })
        const mode = readDb.pragma('journal_mode', { simple: true })
        readDb.close()
        this.log(styles.subheader('\nResult:'))
        this.log(styles.success('  Database is healthy.'))
        this.log(styles.muted(`  Journal mode: ${mode}`))
        this.log('')
        return
      }

      if (flags['check-only']) {
        this.log(styles.muted('\n  --check-only: skipping repair'))
        this.log('')
        return
      }

      // Attempt repair
      this.log(styles.subheader('\nAttempting repair:'))

      if (corruptionDetected) {
        const repair = repairDatabase(dbPath)
        if (repair.success) {
          this.log(styles.success(`  Repaired corruption via ${repair.method}.`))
          this.log(styles.muted(`  ${repair.message}`))
        } else {
          this.log(styles.error('  Corruption repair failed.'))
          this.log(styles.muted(`  ${repair.message}`))
          this.log(styles.muted('  You may need to manually restore from an external backup.'))
          this.log('')
          return
        }
      }

      if (!schema.ok) {
        // Run pending migrations to fix missing tables/columns
        let migrateDb: Database.Database | null = null
        try {
          migrateDb = new Database(dbPath)
          runDrizzleMigrations(migrateDb, ALL_MIGRATIONS)

          // Check if migrations fixed everything
          let recheck = checkSchemaCompleteness(migrateDb)

          // If columns are still missing, add them via ALTER TABLE (PRLT-1339)
          if (!recheck.ok && recheck.missingColumns.length > 0) {
            const alterResult = addMissingColumns(migrateDb, recheck.missingColumns)
            if (alterResult.added.length > 0) {
              for (const { table, column } of alterResult.added) {
                this.log(styles.muted(`  Added column ${table}.${column}`))
              }
            }
            for (const { table, column, error: err } of alterResult.failed) {
              this.log(styles.error(`  Failed to add ${table}.${column}: ${err}`))
            }
            // Re-check after ALTER TABLE
            recheck = checkSchemaCompleteness(migrateDb)
          }

          migrateDb.close()
          migrateDb = null

          if (recheck.ok) {
            this.log(styles.success('  Schema repaired via catch-up migrations.'))
          } else {
            const remaining = recheck.missingTables.length + recheck.missingColumns.length
            this.log(styles.error(`  Migrations ran but ${remaining} schema issue(s) remain.`))
            this.log(styles.muted('  You may need to recreate the database.'))
          }
        } catch (error) {
          if (migrateDb) {
            try { migrateDb.close() } catch { /* cleanup — safe to ignore */ }
          }
          this.log(styles.error(`  Migration failed: ${error instanceof Error ? error.message : error}`))
        }
      }
    } catch (error) {
      if (db) {
        try { db.close() } catch { /* db.close() may fail if handle is already invalid — safe to ignore during cleanup */ }
      }
      this.log(styles.error(`  Could not open database: ${error instanceof Error ? error.message : error}`))

      if (!flags['check-only']) {
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
      }
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
    let db: Database.Database | null = null
    try {
      db = new Database(dbPath, { readonly: true })
      const check = checkIntegrity(db)
      const schema = checkSchemaCompleteness(db)
      db.close()
      db = null

      const isCorrupt = !check.ok
      const hasSchemaIssues = !schema.ok

      if (!isCorrupt && !hasSchemaIssues) {
        return { status: 'healthy', errors: [] }
      }

      // Build combined error list
      const errors = [...check.errors]
      for (const t of schema.missingTables) {
        errors.push(`missing table: ${t}`)
      }
      for (const { table, column } of schema.missingColumns) {
        errors.push(`missing column: ${table}.${column}`)
      }

      const status = isCorrupt ? 'corrupt' : 'schema_incomplete'

      if (checkOnly) {
        return {
          status,
          errors,
          missingTables: schema.missingTables,
          missingColumns: schema.missingColumns,
          repaired: false,
        }
      }

      // Attempt repair
      let repaired = false
      let repairMethod: string | undefined
      let repairMessage: string | undefined

      if (isCorrupt) {
        const repair = repairDatabase(dbPath)
        repaired = repair.success
        repairMethod = repair.method
        repairMessage = repair.message
        if (!repaired) {
          return { status, errors, repaired, repairMethod, repairMessage }
        }
      }

      if (hasSchemaIssues) {
        let migrateDb: Database.Database | null = null
        try {
          migrateDb = new Database(dbPath)
          runDrizzleMigrations(migrateDb, ALL_MIGRATIONS)

          // Check if migrations fixed everything; if not, try ALTER TABLE (PRLT-1339)
          const postMigCheck = checkSchemaCompleteness(migrateDb)
          if (!postMigCheck.ok && postMigCheck.missingColumns.length > 0) {
            addMissingColumns(migrateDb, postMigCheck.missingColumns)
          }

          migrateDb.close()
          migrateDb = null
          repaired = true
          repairMethod = repairMethod ? `${repairMethod}+migrations` : 'migrations'
          repairMessage = repairMessage
            ? `${repairMessage} Schema fixed via catch-up migrations.`
            : 'Schema fixed via catch-up migrations.'
        } catch (migError) {
          if (migrateDb) {
            try { migrateDb.close() } catch { /* cleanup */ }
          }
          repairMessage = `Migration failed: ${migError instanceof Error ? migError.message : String(migError)}`
        }
      }

      return { status, errors, missingTables: schema.missingTables, missingColumns: schema.missingColumns, repaired, repairMethod, repairMessage }
    } catch (error) {
      if (db) {
        try { db.close() } catch { /* db.close() may fail if handle is already invalid — safe to ignore during cleanup */ }
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

import { Command, Flags } from '@oclif/core'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { styles } from '../../lib/styles.js'
import {
  getDatabasePath,
  createManualBackup,
  listBackups,
} from '../../lib/database/index.js'
import {
  getRegisteredHeadquarters,
  getActiveWorkspace,
} from '../../lib/machine-config.js'
import { machineOutputFlags } from '../../lib/pmo/index.js'
import { shouldOutputJson } from '../../lib/prompt-json.js'

export default class DbBackup extends Command {
  static description = 'Create a manual backup of the workspace database'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --label pre-migration',
    '<%= config.bin %> <%= command.id %> --list',
    '<%= config.bin %> <%= command.id %> --workspace /path/to/hq',
  ]

  static flags = {
    ...machineOutputFlags,
    label: Flags.string({
      char: 'l',
      description: 'Optional label for the backup (e.g., pre-migration)',
    }),
    list: Flags.boolean({
      description: 'List existing backups instead of creating one',
      default: false,
    }),
    workspace: Flags.string({
      char: 'w',
      description: 'Path to workspace (defaults to active workspace)',
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(DbBackup)

    const workspacePath = this.resolveWorkspacePath(flags.workspace)
    if (!workspacePath) {
      this.error('No workspace found. Run "prlt new" first or specify --workspace.')
    }

    const dbPath = getDatabasePath(workspacePath)
    if (!fs.existsSync(dbPath)) {
      this.error(`Database not found: ${dbPath}`)
    }

    if (flags.list) {
      this.listBackups(dbPath, flags)
      return
    }

    this.createBackup(dbPath, flags)
  }

  private listBackups(dbPath: string, flags: Record<string, unknown>): void {
    const backups = listBackups(dbPath)

    if (shouldOutputJson(flags)) {
      this.log(JSON.stringify({
        backups: backups.map(b => ({
          filename: b.filename,
          path: b.path,
          size: b.size,
          mtime: b.mtime.toISOString(),
        })),
        count: backups.length,
      }, null, 2))
      return
    }

    this.log(`\n${styles.header('Database Backups')}`)
    this.log('\u2500'.repeat(50))

    if (backups.length === 0) {
      this.log(styles.muted('  No backups found'))
      this.log('')
      return
    }

    for (const backup of backups) {
      this.log(`  ${styles.code(backup.filename)} \u2014 ${styles.muted(backup.mtime.toISOString())} (${formatBytes(backup.size)})`)
    }
    this.log(styles.muted(`\n  ${backups.length} backup(s) in ${path.dirname(backups[0].path)}`))
    this.log('')
  }

  private createBackup(dbPath: string, flags: Record<string, unknown>): void {
    const label = flags.label as string | undefined
    const backupPath = createManualBackup(dbPath, label)

    if (!backupPath) {
      if (shouldOutputJson(flags)) {
        this.log(JSON.stringify({ success: false, error: 'Failed to create backup' }, null, 2))
        return
      }
      this.error('Failed to create backup.')
    }

    if (shouldOutputJson(flags)) {
      const stat = fs.statSync(backupPath)
      this.log(JSON.stringify({
        success: true,
        filename: path.basename(backupPath),
        path: backupPath,
        size: stat.size,
      }, null, 2))
      return
    }

    const stat = fs.statSync(backupPath)
    this.log(`\n${styles.success('Backup created successfully.')}`)
    this.log(`  ${styles.code(path.basename(backupPath))} (${formatBytes(stat.size)})`)
    this.log(styles.muted(`  ${backupPath}`))
    this.log('')
  }

  private resolveWorkspacePath(explicit?: string): string | null {
    if (explicit) {
      return fs.existsSync(explicit) ? explicit : null
    }

    const active = getActiveWorkspace()
    if (active && fs.existsSync(active)) {
      return active
    }

    const hqs = getRegisteredHeadquarters()
    for (const hq of hqs) {
      if (fs.existsSync(hq.path)) {
        return hq.path
      }
    }

    return null
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

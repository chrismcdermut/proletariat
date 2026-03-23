/**
 * Workspace Database Operations
 *
 * Core database lifecycle: open, create, get config, path resolution.
 */

import { SqliteDatabase } from './sqlite.js'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { isEphemeralAgentName } from '../themes.js'
import { isReadOnlyHQMount } from '../container.js'
import { runDrizzleMigrations } from './migrator.js'
import { ALL_MIGRATIONS } from './migrations/index.js'
import { createDrizzleConnection, type DrizzleDB } from './drizzle.js'
import {
  workspace as workspaceTable,
} from './drizzle-schema.js'
import { eq } from 'drizzle-orm'
import type { DatabaseDriver } from './driver.js'
import { SqlJsDriver } from './driver.js'
import {
  enableWALMode,
  createRotatingBackup,
  quickCheckIntegrity,
  repairDatabase,
} from './db-safety.js'

export interface WorkspaceConfig {
  id: number
  type: 'hq' | 'workspace'
  workspace_name: string
  has_pmo: boolean
  active_theme_id: string | null
  created_at: string
}

/**
 * Open the workspace database, wrap it with Drizzle, run a function,
 * and close the connection. Handles the open/close lifecycle.
 */
export function withDrizzle<T>(workspacePath: string, fn: (ddb: DrizzleDB, sqliteDb: SqliteDatabase) => T): T {
  const sqliteDb = openWorkspaceDatabase(workspacePath)
  const ddb = createDrizzleConnection(sqliteDb)
  try {
    return fn(ddb, sqliteDb)
  } finally {
    sqliteDb.close()
  }
}

/**
 * Ensure ephemeral agents are correctly typed based on their worktree path or naming pattern.
 * Uses raw SQL because it relies on SQLite-specific GLOB operator and sqlite_master introspection.
 */
function ensureEphemeralAgentTypes(db: SqliteDatabase): void {
  const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agents'").get()
  if (!tableExists) {
    return
  }

  db.exec("UPDATE agents SET type = 'ephemeral' WHERE worktree_path LIKE 'agents/temp/%' AND type != 'ephemeral'")

  db.exec(`
    UPDATE agents SET type = 'ephemeral'
    WHERE type != 'ephemeral'
    AND name GLOB '*-*-[0-9]*'
  `)

  const potentialEphemeral = db.prepare(`
    SELECT name FROM agents
    WHERE type != 'ephemeral'
    AND name LIKE '%-%'
    AND name NOT GLOB '*-*-[0-9]*'
  `).all() as { name: string }[]

  const updateStmt = db.prepare("UPDATE agents SET type = 'ephemeral' WHERE name = ?")
  for (const agent of potentialEphemeral) {
    if (isEphemeralAgentName(agent.name)) {
      updateStmt.run(agent.name)
    }
  }
}

/**
 * Get the database path for a workspace
 */
export function getDatabasePath(workspacePath: string): string {
  return path.join(workspacePath, '.proletariat', 'workspace.db')
}

/**
 * Get the config path for a workspace
 */
export function getConfigPath(workspacePath: string): string {
  return path.join(workspacePath, '.proletariat', 'config.json')
}

/**
 * Open workspace database connection.
 *
 * Safety features (PRLT-1081):
 * - Creates a rotating backup before opening (keeps last 5)
 * - Enables WAL journal mode for corruption resistance
 * - Runs a quick integrity check; auto-repairs if corruption detected
 */
export function openWorkspaceDatabase(workspacePath: string, options?: { readonly?: boolean }): SqliteDatabase {
  const dbPath = getDatabasePath(workspacePath)

  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database not found: ${dbPath}. Run 'prlt new' first.`)
  }

  // Determine if we should open read-only.
  // In container environments, the HQ mount at PRLT_HQ_PATH is typically
  // read-only. We detect this by checking if the workspace path matches
  // the HQ path AND we're in a container. This avoids accidentally opening
  // local/test databases as read-only.
  const readOnly = options?.readonly ?? isReadOnlyHQMount(workspacePath)

  if (!readOnly) {
    // Auto-backup before opening (cheap insurance against corruption)
    createRotatingBackup(dbPath)
  }

  let db = new SqliteDatabase(dbPath, readOnly ? { readonly: true } : undefined)

  if (!readOnly) {
    // Enable WAL mode — allows concurrent readers with one writer,
    // significantly more resistant to corruption than journal_mode=delete
    enableWALMode(db)
  }
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')

  if (!readOnly) {
    // Quick integrity check on startup
    const integrity = quickCheckIntegrity(db)
    if (!integrity.ok) {
      db.close()

      // Attempt auto-repair
      const repair = repairDatabase(dbPath)
      if (!repair.success) {
        throw new Error(
          `Database corruption detected in ${dbPath}.\n` +
          `Integrity errors: ${integrity.errors.join('; ')}\n` +
          `Auto-repair failed: ${repair.message}\n` +
          `Run 'prlt db repair' for manual recovery options.`
        )
      }

      // Re-open the repaired database
      db = new SqliteDatabase(dbPath)
      enableWALMode(db)
      db.pragma('foreign_keys = ON')
      db.pragma('busy_timeout = 5000')
    }

    runDrizzleMigrations(db, ALL_MIGRATIONS)
    ensureEphemeralAgentTypes(db)
  }

  return db
}

/**
 * Open workspace database and return a DatabaseDriver.
 * Preferred over openWorkspaceDatabase for new code.
 */
export function openWorkspaceDriver(workspacePath: string): DatabaseDriver {
  const db = openWorkspaceDatabase(workspacePath)
  return new SqlJsDriver(db)
}

/**
 * Create and initialize workspace database
 */
export function createWorkspaceDatabase(
  workspacePath: string,
  type: 'hq' | 'workspace',
  workspaceName: string,
  hasPMO: boolean = false
): SqliteDatabase {
  const dbPath = getDatabasePath(workspacePath)
  const configPath = getConfigPath(workspacePath)

  const proletariatDir = path.dirname(dbPath)
  if (!fs.existsSync(proletariatDir)) {
    fs.mkdirSync(proletariatDir, { recursive: true })
  }

  const bootstrapConfig = {
    version: "1.0.0",
    schemaVersion: 1
  }
  fs.writeFileSync(configPath, JSON.stringify(bootstrapConfig, null, 2))

  const db = new SqliteDatabase(dbPath)

  enableWALMode(db)
  db.pragma('foreign_keys = ON')
  runDrizzleMigrations(db, ALL_MIGRATIONS)

  const ddb = createDrizzleConnection(db)
  ddb.insert(workspaceTable).values({
    id: 1,
    type,
    workspaceName,
    hasPmo: hasPMO,
    createdAt: new Date().toISOString(),
  }).run()

  return db
}

/**
 * Get workspace configuration
 */
export function getWorkspaceConfig(workspacePath: string): WorkspaceConfig | null {
  try {
    return withDrizzle(workspacePath, (ddb) => {
      const row = ddb.select().from(workspaceTable).limit(1).get()
      if (!row) return null
      return {
        id: row.id ?? 1,
        type: row.type,
        workspace_name: row.workspaceName,
        has_pmo: Boolean(row.hasPmo),
        active_theme_id: row.activeThemeId,
        created_at: row.createdAt,
      }
    })
  } catch {
    return null
  }
}

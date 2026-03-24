/**
 * Credential Store
 *
 * Stores API keys and tokens in a separate credentials.db file
 * that is NOT mounted into agent containers. This prevents agents
 * from reading or leaking credentials.
 *
 * Credentials are stored at {workspacePath}/.proletariat-credentials/credentials.db
 * while the main workspace.db lives at {workspacePath}/.proletariat/workspace.db.
 * Only .proletariat/ is mounted into containers, keeping credentials isolated.
 *
 * PRLT-1114: Agent secret isolation
 */

import Database from 'better-sqlite3'
import * as fs from 'node:fs'
import * as path from 'node:path'

const CREDENTIALS_TABLE = 'credentials'

/** Known credential setting keys that must be stored in credentials.db */
const CREDENTIAL_KEYS = new Set([
  'linear.api_key',
  'jira.api_token',
  'asana.access_token',
  'trello.api_key',
  'trello.api_token',
  'shortcut.api_token',
  'monday.api_token',
])

/**
 * Check if a workspace_settings key stores a credential (API key or token).
 */
export function isCredentialKey(key: string): boolean {
  return CREDENTIAL_KEYS.has(key)
}

/**
 * Get the path to the credentials database for a workspace.
 */
export function getCredentialDatabasePath(workspacePath: string): string {
  return path.join(workspacePath, '.proletariat-credentials', 'credentials.db')
}

/**
 * Derive the workspace root path from a workspace.db Database instance.
 * workspace.db is at {workspacePath}/.proletariat/workspace.db
 * Returns empty string for in-memory databases (used in tests).
 */
function deriveWorkspacePath(db: Database.Database): string {
  const dbName = db.name
  // In-memory or unnamed databases don't have a filesystem path
  if (!dbName || dbName === ':memory:' || dbName === '') return ''
  return path.dirname(path.dirname(dbName))
}

/**
 * Open or create the credentials database.
 * Creates the directory and schema if they don't exist.
 */
function openCredentialDb(workspacePath: string): Database.Database {
  const dbPath = getCredentialDatabasePath(workspacePath)
  const dir = path.dirname(dbPath)

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  const credDb = new Database(dbPath)
  credDb.pragma('journal_mode = WAL')
  credDb.pragma('foreign_keys = ON')
  credDb.pragma('busy_timeout = 5000')

  credDb.exec(`
    CREATE TABLE IF NOT EXISTS ${CREDENTIALS_TABLE} (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)

  return credDb
}

// Cache open credential db connections keyed by workspace path
const credentialDbCache = new Map<string, Database.Database>()

/**
 * Get a cached credential database connection.
 * Returns null if credentials.db cannot be opened (e.g., in agent containers
 * where the credentials directory is not mounted).
 */
function getCachedCredentialDb(workspacePath: string, autoCreate: boolean): Database.Database | null {
  const cached = credentialDbCache.get(workspacePath)
  if (cached) {
    try {
      cached.pragma('journal_mode')
      return cached
    } catch {
      credentialDbCache.delete(workspacePath)
    }
  }

  const dbPath = getCredentialDatabasePath(workspacePath)
  const dir = path.dirname(dbPath)

  // If the credentials directory doesn't exist and we're not auto-creating,
  // return null. This is expected in agent containers where only .proletariat/
  // is mounted, not .proletariat-credentials/.
  if (!autoCreate && !fs.existsSync(dir)) {
    return null
  }

  try {
    const credDb = openCredentialDb(workspacePath)
    credentialDbCache.set(workspacePath, credDb)
    return credDb
  } catch {
    return null
  }
}

/**
 * Get a credential value, with automatic migration from workspace.db.
 *
 * Resolution order:
 * 1. Check credentials.db (if available)
 * 2. Fall back to workspace.db (for backward compatibility)
 * 3. If found in workspace.db, migrate to credentials.db and delete from workspace.db
 *
 * In agent containers, credentials.db won't exist and workspace.db will have
 * credentials removed — so this returns null, which is the desired behavior.
 *
 * For in-memory databases (tests), falls back to workspace_settings directly
 * since there's no filesystem path to store credentials.db.
 */
export function getCredential(workspaceDb: Database.Database, key: string): string | null {
  const workspacePath = deriveWorkspacePath(workspaceDb)

  // In-memory databases (tests) — use workspace_settings directly
  if (!workspacePath) {
    try {
      const row = workspaceDb
        .prepare('SELECT value FROM workspace_settings WHERE key = ?')
        .get(key) as { value: string } | undefined
      return row?.value ?? null
    } catch {
      return null
    }
  }

  // Check credentials.db first (don't auto-create just for reads)
  const credDb = getCachedCredentialDb(workspacePath, false)
  if (credDb) {
    const row = credDb
      .prepare(`SELECT value FROM ${CREDENTIALS_TABLE} WHERE key = ?`)
      .get(key) as { value: string } | undefined
    if (row) return row.value
  }

  // Fall back to workspace.db (backward compatibility + auto-migration)
  let fallbackValue: string | null = null
  try {
    const fallbackRow = workspaceDb
      .prepare('SELECT value FROM workspace_settings WHERE key = ?')
      .get(key) as { value: string } | undefined
    fallbackValue = fallbackRow?.value ?? null
  } catch {
    // workspace.db may not have the table yet
  }

  if (fallbackValue) {
    // Auto-migrate: move credential to credentials.db (auto-create on write)
    const writeDb = getCachedCredentialDb(workspacePath, true)
    if (writeDb) {
      writeDb
        .prepare(`INSERT OR REPLACE INTO ${CREDENTIALS_TABLE} (key, value) VALUES (?, ?)`)
        .run(key, fallbackValue)
    }
    // Remove from workspace.db so agents can't see it
    try {
      workspaceDb.prepare('DELETE FROM workspace_settings WHERE key = ?').run(key)
    } catch {
      // workspace.db may be read-only in containers
    }
    return fallbackValue
  }

  return null
}

/**
 * Set a credential value. Always writes to credentials.db.
 * Also removes from workspace.db if present (migration cleanup).
 * For in-memory databases (tests), writes to workspace_settings directly.
 */
export function setCredential(workspaceDb: Database.Database, key: string, value: string): void {
  const workspacePath = deriveWorkspacePath(workspaceDb)

  // In-memory databases (tests) — use workspace_settings directly
  if (!workspacePath) {
    workspaceDb.prepare(`
      INSERT INTO workspace_settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value)
    return
  }

  const credDb = getCachedCredentialDb(workspacePath, true)
  if (!credDb) {
    throw new Error(`Cannot open credential store at ${getCredentialDatabasePath(workspacePath)}`)
  }

  credDb
    .prepare(`INSERT OR REPLACE INTO ${CREDENTIALS_TABLE} (key, value) VALUES (?, ?)`)
    .run(key, value)

  // Clean up from workspace.db if it was there
  try {
    workspaceDb.prepare('DELETE FROM workspace_settings WHERE key = ?').run(key)
  } catch {
    // workspace.db may be read-only in containers
  }
}

/**
 * Delete a credential from both credentials.db and workspace.db.
 * For in-memory databases (tests), deletes from workspace_settings directly.
 */
export function deleteCredential(workspaceDb: Database.Database, key: string): void {
  const workspacePath = deriveWorkspacePath(workspaceDb)

  // In-memory databases (tests) — use workspace_settings directly
  if (!workspacePath) {
    try {
      workspaceDb.prepare('DELETE FROM workspace_settings WHERE key = ?').run(key)
    } catch {
      // Table may not exist
    }
    return
  }

  const credDb = getCachedCredentialDb(workspacePath, false)
  if (credDb) {
    credDb.prepare(`DELETE FROM ${CREDENTIALS_TABLE} WHERE key = ?`).run(key)
  }

  // Also delete from workspace.db in case it's still there
  try {
    workspaceDb.prepare('DELETE FROM workspace_settings WHERE key = ?').run(key)
  } catch {
    // workspace.db may be read-only
  }
}

/**
 * Check if a credential exists in either credentials.db or workspace.db.
 */
export function hasCredential(workspaceDb: Database.Database, key: string): boolean {
  return getCredential(workspaceDb, key) !== null
}

/**
 * Close all cached credential database connections.
 * Call this during cleanup/shutdown.
 */
export function closeAllCredentialStores(): void {
  for (const [, db] of credentialDbCache) {
    try {
      db.close()
    } catch {
      // Ignore close errors
    }
  }
  credentialDbCache.clear()
}

/**
 * Eagerly migrate all known credential keys from workspace.db to credentials.db.
 * This is safe to call multiple times (idempotent).
 * Useful during workspace open to proactively move all credentials out.
 * No-op for in-memory databases (tests).
 */
export function migrateCredentials(workspaceDb: Database.Database): void {
  const workspacePath = deriveWorkspacePath(workspaceDb)
  if (!workspacePath) return // In-memory databases (tests)

  // Check if any credentials exist in workspace.db
  let hasAny = false
  try {
    for (const key of CREDENTIAL_KEYS) {
      const row = workspaceDb
        .prepare('SELECT value FROM workspace_settings WHERE key = ?')
        .get(key) as { value: string } | undefined
      if (row) {
        hasAny = true
        break
      }
    }
  } catch {
    return // workspace_settings table may not exist
  }

  if (!hasAny) return

  // Open/create credentials.db and migrate
  const credDb = getCachedCredentialDb(workspacePath, true)
  if (!credDb) return

  for (const key of CREDENTIAL_KEYS) {
    try {
      const row = workspaceDb
        .prepare('SELECT value FROM workspace_settings WHERE key = ?')
        .get(key) as { value: string } | undefined
      if (row) {
        credDb
          .prepare(`INSERT OR REPLACE INTO ${CREDENTIALS_TABLE} (key, value) VALUES (?, ?)`)
          .run(key, row.value)
        workspaceDb.prepare('DELETE FROM workspace_settings WHERE key = ?').run(key)
      }
    } catch {
      // Skip individual key failures
    }
  }
}

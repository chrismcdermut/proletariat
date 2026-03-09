/**
 * Shortcut Configuration Storage
 *
 * Stores Shortcut credentials and preferences in the workspace_settings table.
 * Mirrors the Jira config module pattern.
 */

import Database from 'better-sqlite3'

const SETTINGS_TABLE = 'workspace_settings'

const SHORTCUT_CONFIG_KEYS = {
  apiToken: 'shortcut.api_token',
  workspaceSlug: 'shortcut.workspace_slug',
} as const

export interface ShortcutConfig {
  apiToken: string
  workspaceSlug?: string
}

function getSetting(db: Database.Database, key: string): string | null {
  const row = db
    .prepare(`SELECT value FROM ${SETTINGS_TABLE} WHERE key = ?`)
    .get(key) as { value: string } | undefined
  return row?.value ?? null
}

function setSetting(db: Database.Database, key: string, value: string): void {
  db.prepare(`
    INSERT INTO ${SETTINGS_TABLE} (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value)
}

function deleteSetting(db: Database.Database, key: string): void {
  db.prepare(`DELETE FROM ${SETTINGS_TABLE} WHERE key = ?`).run(key)
}

/**
 * Check if Shortcut is configured.
 * Returns true if either:
 * - Database has shortcut.api_token stored, OR
 * - Environment variables PRLT_SHORTCUT_API_TOKEN/SHORTCUT_API_TOKEN are set
 */
export function isShortcutConfigured(db: Database.Database): boolean {
  const hasDbConfig = getSetting(db, SHORTCUT_CONFIG_KEYS.apiToken) !== null
  if (hasDbConfig) return true

  const hasEnvToken = !!(process.env.PRLT_SHORTCUT_API_TOKEN || process.env.SHORTCUT_API_TOKEN)
  return hasEnvToken
}

/**
 * Load Shortcut configuration from the database + environment.
 * Returns null if not configured.
 */
export function loadShortcutConfig(db: Database.Database): ShortcutConfig | null {
  const apiToken = getSetting(db, SHORTCUT_CONFIG_KEYS.apiToken)
    || process.env.PRLT_SHORTCUT_API_TOKEN
    || process.env.SHORTCUT_API_TOKEN

  if (!apiToken) return null

  return {
    apiToken,
    workspaceSlug: getSetting(db, SHORTCUT_CONFIG_KEYS.workspaceSlug)
      || process.env.PRLT_SHORTCUT_WORKSPACE
      || process.env.SHORTCUT_WORKSPACE_SLUG
      || undefined,
  }
}

/**
 * Save Shortcut configuration to the database.
 */
export function saveShortcutConfig(db: Database.Database, config: ShortcutConfig): void {
  setSetting(db, SHORTCUT_CONFIG_KEYS.apiToken, config.apiToken)
  if (config.workspaceSlug) {
    setSetting(db, SHORTCUT_CONFIG_KEYS.workspaceSlug, config.workspaceSlug)
  }
}

/**
 * Save the Shortcut API token.
 */
export function saveShortcutApiToken(db: Database.Database, apiToken: string): void {
  setSetting(db, SHORTCUT_CONFIG_KEYS.apiToken, apiToken)
}

/**
 * Save the Shortcut workspace slug.
 */
export function saveShortcutWorkspaceSlug(db: Database.Database, slug: string): void {
  setSetting(db, SHORTCUT_CONFIG_KEYS.workspaceSlug, slug)
}

/**
 * Clear all Shortcut configuration from the database.
 */
export function clearShortcutConfig(db: Database.Database): void {
  for (const key of Object.values(SHORTCUT_CONFIG_KEYS)) {
    deleteSetting(db, key)
  }
}

/**
 * Get the stored Shortcut API token.
 * Also checks PRLT_SHORTCUT_API_TOKEN and SHORTCUT_API_TOKEN environment variables.
 */
export function getShortcutApiToken(db: Database.Database): string | null {
  const envKey = process.env.PRLT_SHORTCUT_API_TOKEN || process.env.SHORTCUT_API_TOKEN
  if (envKey) return envKey

  return getSetting(db, SHORTCUT_CONFIG_KEYS.apiToken)
}

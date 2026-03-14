/**
 * Shortcut Configuration Storage
 *
 * Stores Shortcut credentials and preferences in the workspace_settings table.
 * Mirrors the Jira config module pattern.
 */

import Database from 'better-sqlite3'
import { loadProviderSources, resolveApiKey } from '../work-source/provider-sources.js'

const SETTINGS_TABLE = 'workspace_settings'

/** Default environment variable name used as apiKeyRef for Shortcut provider sources. */
export const SHORTCUT_API_TOKEN_ENV_VAR = 'PRLT_SHORTCUT_API_TOKEN'

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
 * Check if Shortcut is configured (API token is available via any resolution path).
 */
export function isShortcutConfigured(db: Database.Database): boolean {
  return getShortcutApiToken(db) !== null
}

/**
 * Load Shortcut configuration by resolving the API token through the provider-sources
 * chain (provider source apiKeyRef → legacy env vars → legacy DB key).
 * Returns null if no API token can be resolved.
 */
export function loadShortcutConfig(db: Database.Database): ShortcutConfig | null {
  const apiToken = getShortcutApiToken(db)
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
  // 1. Try provider sources (supports custom apiKeyRef per source)
  try {
    const sources = loadProviderSources(db)
    for (const source of sources) {
      if (source.provider === 'shortcut') {
        const key = resolveApiKey(db, source)
        if (key) return key
      }
    }
  } catch {
    // Provider sources may not exist in older databases
  }

  // 2. Legacy: environment variables
  const envKey = process.env.PRLT_SHORTCUT_API_TOKEN || process.env.SHORTCUT_API_TOKEN
  if (envKey) return envKey

  // 3. Legacy: stored workspace setting
  return getSetting(db, SHORTCUT_CONFIG_KEYS.apiToken)
}

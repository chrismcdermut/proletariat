/**
 * Shortcut Configuration Storage
 *
 * Stores Shortcut credentials and preferences in the workspace_settings table.
 */

import type Database from 'better-sqlite3'
import { loadProviderSources, resolveApiKey } from '../work-source/provider-sources.js'
import { SettingsStore } from '../database/settings-store.js'
import { getCredential, setCredential, deleteCredential, hasCredential } from '../database/credential-store.js'

const SHORTCUT_CONFIG_KEYS = {
  apiToken: 'shortcut.api_token',
  workspaceSlug: 'shortcut.workspace_slug',
} as const

export interface ShortcutConfig {
  apiToken: string
  workspaceSlug?: string
}

/**
 * Check if Shortcut is configured.
 */
export function isShortcutConfigured(db: Database.Database): boolean {
  const hasDbConfig = hasCredential(db, SHORTCUT_CONFIG_KEYS.apiToken)
  if (hasDbConfig) return true

  const hasEnvToken = !!(process.env.PRLT_SHORTCUT_API_TOKEN || process.env.SHORTCUT_API_TOKEN)
  return hasEnvToken
}

/**
 * Load Shortcut configuration from the database + environment.
 */
export function loadShortcutConfig(db: Database.Database): ShortcutConfig | null {
  const settings = new SettingsStore(db)
  const apiToken = getCredential(db, SHORTCUT_CONFIG_KEYS.apiToken)
    || process.env.PRLT_SHORTCUT_API_TOKEN
    || process.env.SHORTCUT_API_TOKEN

  if (!apiToken) return null

  return {
    apiToken,
    workspaceSlug: settings.get(SHORTCUT_CONFIG_KEYS.workspaceSlug)
      || process.env.PRLT_SHORTCUT_WORKSPACE
      || process.env.SHORTCUT_WORKSPACE_SLUG
      || undefined,
  }
}

/**
 * Save Shortcut configuration to the database.
 */
export function saveShortcutConfig(db: Database.Database, config: ShortcutConfig): void {
  const settings = new SettingsStore(db)
  setCredential(db, SHORTCUT_CONFIG_KEYS.apiToken, config.apiToken)
  if (config.workspaceSlug) {
    settings.set(SHORTCUT_CONFIG_KEYS.workspaceSlug, config.workspaceSlug)
  }
}

/**
 * Save the Shortcut API token.
 */
export function saveShortcutApiToken(db: Database.Database, apiToken: string): void {
  setCredential(db, SHORTCUT_CONFIG_KEYS.apiToken, apiToken)
}

/**
 * Save the Shortcut workspace slug.
 */
export function saveShortcutWorkspaceSlug(db: Database.Database, slug: string): void {
  new SettingsStore(db).set(SHORTCUT_CONFIG_KEYS.workspaceSlug, slug)
}

/**
 * Clear all Shortcut configuration from the database.
 */
export function clearShortcutConfig(db: Database.Database): void {
  const settings = new SettingsStore(db)
  for (const key of Object.values(SHORTCUT_CONFIG_KEYS)) {
    if (key === SHORTCUT_CONFIG_KEYS.apiToken) {
      deleteCredential(db, key)
    } else {
      settings.delete(key)
    }
  }
}

/**
 * Get the stored Shortcut API token.
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

  // 3. Legacy: stored workspace setting (now in credentials.db)
  return getCredential(db, SHORTCUT_CONFIG_KEYS.apiToken)
}

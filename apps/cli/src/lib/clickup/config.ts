/**
 * ClickUp Configuration Storage
 *
 * Stores ClickUp credentials and preferences in the workspace_settings table.
 */

import type Database from 'better-sqlite3'
import type { ClickUpConfig } from './types.js'
import { loadProviderSources, resolveApiKey } from '../work-source/provider-sources.js'
import { SettingsStore } from '../database/settings-store.js'
import { getCredential, setCredential, deleteCredential, hasCredential } from '../database/credential-store.js'

const CLICKUP_CONFIG_KEYS = {
  apiKey: 'clickup.api_key',
  defaultListId: 'clickup.default_list_id',
  defaultListName: 'clickup.default_list_name',
  workspaceName: 'clickup.workspace_name',
} as const

// =============================================================================
// Public API
// =============================================================================

/**
 * Check if ClickUp is configured (API key is stored).
 */
export function isClickUpConfigured(db: Database.Database): boolean {
  return hasCredential(db, CLICKUP_CONFIG_KEYS.apiKey)
}

/**
 * Load ClickUp configuration from the database.
 * Returns null if not configured.
 */
export function loadClickUpConfig(db: Database.Database): ClickUpConfig | null {
  const apiKey = getCredential(db, CLICKUP_CONFIG_KEYS.apiKey)
  if (!apiKey) return null

  const settings = new SettingsStore(db)
  return {
    apiKey,
    defaultListId: settings.get(CLICKUP_CONFIG_KEYS.defaultListId) ?? undefined,
    defaultListName: settings.get(CLICKUP_CONFIG_KEYS.defaultListName) ?? undefined,
    workspaceName: settings.get(CLICKUP_CONFIG_KEYS.workspaceName) ?? undefined,
  }
}

/**
 * Save ClickUp API key to the database.
 */
export function saveClickUpApiKey(db: Database.Database, apiKey: string): void {
  setCredential(db, CLICKUP_CONFIG_KEYS.apiKey, apiKey)
}

/**
 * Save the default list for ClickUp operations.
 */
export function saveClickUpDefaultList(db: Database.Database, listId: string, listName: string): void {
  const settings = new SettingsStore(db)
  settings.set(CLICKUP_CONFIG_KEYS.defaultListId, listId)
  settings.set(CLICKUP_CONFIG_KEYS.defaultListName, listName)
}

/**
 * Save the workspace name.
 */
export function saveClickUpWorkspace(db: Database.Database, name: string): void {
  new SettingsStore(db).set(CLICKUP_CONFIG_KEYS.workspaceName, name)
}

/**
 * Clear all ClickUp configuration from the database.
 */
export function clearClickUpConfig(db: Database.Database): void {
  const settings = new SettingsStore(db)
  for (const key of Object.values(CLICKUP_CONFIG_KEYS)) {
    if (key === CLICKUP_CONFIG_KEYS.apiKey) {
      deleteCredential(db, key)
    } else {
      settings.delete(key)
    }
  }
}

/**
 * Get the ClickUp API key using the provider-sources resolution chain.
 *
 * Resolution order:
 * 1. If a ClickUp provider source is configured, resolve its apiKeyRef
 * 2. Legacy fallback: PRLT_CLICKUP_API_KEY or CLICKUP_API_KEY environment variables
 * 3. Legacy fallback: workspace_settings key 'clickup.api_key'
 */
export function getClickUpApiKey(db: Database.Database): string | null {
  // 1. Try provider sources (supports custom apiKeyRef per source)
  try {
    const sources = loadProviderSources(db)
    for (const source of sources) {
      if (source.provider === 'clickup') {
        const key = resolveApiKey(db, source)
        if (key) return key
      }
    }
  } catch {
    // Provider sources table may not exist in older databases
  }

  // 2. Legacy: environment variables
  const envKey = process.env.PRLT_CLICKUP_API_KEY || process.env.CLICKUP_API_KEY
  if (envKey) return envKey

  // 3. Legacy: stored workspace setting (now in credentials.db)
  return getCredential(db, CLICKUP_CONFIG_KEYS.apiKey)
}

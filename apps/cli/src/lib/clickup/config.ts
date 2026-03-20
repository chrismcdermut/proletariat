/**
 * ClickUp Configuration Storage
 *
 * Stores ClickUp credentials and preferences in the workspace_settings table.
 * Follows the same pattern as Linear/Trello config modules.
 */

import Database from 'better-sqlite3'
import type { ClickUpConfig } from './types.js'
import { loadProviderSources, resolveApiKey } from '../work-source/provider-sources.js'

const SETTINGS_TABLE = 'workspace_settings'

const CLICKUP_CONFIG_KEYS = {
  apiKey: 'clickup.api_key',
  workspaceId: 'clickup.workspace_id',
  workspaceName: 'clickup.workspace_name',
  spaceId: 'clickup.space_id',
  spaceName: 'clickup.space_name',
} as const

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

// =============================================================================
// Public API
// =============================================================================

/**
 * Check if ClickUp is configured.
 */
export function isClickUpConfigured(db: Database.Database): boolean {
  const hasDbConfig = getSetting(db, CLICKUP_CONFIG_KEYS.apiKey) !== null
  if (hasDbConfig) return true

  return !!(process.env.PRLT_CLICKUP_API_KEY || process.env.CLICKUP_API_KEY)
}

/**
 * Load ClickUp configuration from the database.
 * Returns null if not configured.
 */
export function loadClickUpConfig(db: Database.Database): ClickUpConfig | null {
  const apiKey = getSetting(db, CLICKUP_CONFIG_KEYS.apiKey)
    || process.env.PRLT_CLICKUP_API_KEY
    || process.env.CLICKUP_API_KEY

  if (!apiKey) return null

  return {
    apiKey,
    workspaceId: getSetting(db, CLICKUP_CONFIG_KEYS.workspaceId) || undefined,
    workspaceName: getSetting(db, CLICKUP_CONFIG_KEYS.workspaceName) || undefined,
    spaceId: getSetting(db, CLICKUP_CONFIG_KEYS.spaceId) || undefined,
    spaceName: getSetting(db, CLICKUP_CONFIG_KEYS.spaceName) || undefined,
  }
}

/**
 * Save ClickUp API key to the database.
 */
export function saveClickUpApiKey(db: Database.Database, apiKey: string): void {
  setSetting(db, CLICKUP_CONFIG_KEYS.apiKey, apiKey)
}

/**
 * Save the ClickUp workspace.
 */
export function saveClickUpWorkspace(db: Database.Database, workspaceId: string, workspaceName: string): void {
  setSetting(db, CLICKUP_CONFIG_KEYS.workspaceId, workspaceId)
  setSetting(db, CLICKUP_CONFIG_KEYS.workspaceName, workspaceName)
}

/**
 * Save the ClickUp space.
 */
export function saveClickUpSpace(db: Database.Database, spaceId: string, spaceName: string): void {
  setSetting(db, CLICKUP_CONFIG_KEYS.spaceId, spaceId)
  setSetting(db, CLICKUP_CONFIG_KEYS.spaceName, spaceName)
}

/**
 * Clear all ClickUp configuration from the database.
 */
export function clearClickUpConfig(db: Database.Database): void {
  for (const key of Object.values(CLICKUP_CONFIG_KEYS)) {
    deleteSetting(db, key)
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
  // 1. Try provider sources
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

  // 3. Legacy: stored workspace setting
  return getSetting(db, CLICKUP_CONFIG_KEYS.apiKey)
}

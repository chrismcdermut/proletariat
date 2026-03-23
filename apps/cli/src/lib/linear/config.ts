/**
 * Linear Configuration Storage
 *
 * Stores Linear credentials and preferences in the workspace_settings table.
 */

import type { SqliteDatabase } from '../database/sqlite.js'
import type { LinearConfig } from './types.js'
import { loadProviderSources, resolveApiKey } from '../work-source/provider-sources.js'
import { SettingsStore } from '../database/settings-store.js'

const LINEAR_CONFIG_KEYS = {
  apiKey: 'linear.api_key',
  defaultTeamId: 'linear.default_team_id',
  defaultTeamKey: 'linear.default_team_key',
  organizationName: 'linear.organization_name',
} as const

// =============================================================================
// Public API
// =============================================================================

/**
 * Check if Linear is configured (API key is stored).
 */
export function isLinearConfigured(db: SqliteDatabase): boolean {
  const settings = new SettingsStore(db)
  return settings.has(LINEAR_CONFIG_KEYS.apiKey)
}

/**
 * Load Linear configuration from the database.
 * Returns null if not configured.
 */
export function loadLinearConfig(db: SqliteDatabase): LinearConfig | null {
  const settings = new SettingsStore(db)
  const apiKey = settings.get(LINEAR_CONFIG_KEYS.apiKey)
  if (!apiKey) return null

  return {
    apiKey,
    defaultTeamId: settings.get(LINEAR_CONFIG_KEYS.defaultTeamId) ?? undefined,
    defaultTeamKey: settings.get(LINEAR_CONFIG_KEYS.defaultTeamKey) ?? undefined,
    organizationName: settings.get(LINEAR_CONFIG_KEYS.organizationName) ?? undefined,
  }
}

/**
 * Save Linear API key to the database.
 */
export function saveLinearApiKey(db: SqliteDatabase, apiKey: string): void {
  new SettingsStore(db).set(LINEAR_CONFIG_KEYS.apiKey, apiKey)
}

/**
 * Save the default team for Linear operations.
 */
export function saveLinearDefaultTeam(db: SqliteDatabase, teamId: string, teamKey: string): void {
  const settings = new SettingsStore(db)
  settings.set(LINEAR_CONFIG_KEYS.defaultTeamId, teamId)
  settings.set(LINEAR_CONFIG_KEYS.defaultTeamKey, teamKey)
}

/**
 * Save the organization name.
 */
export function saveLinearOrganization(db: SqliteDatabase, name: string): void {
  new SettingsStore(db).set(LINEAR_CONFIG_KEYS.organizationName, name)
}

/**
 * Clear all Linear configuration from the database.
 */
export function clearLinearConfig(db: SqliteDatabase): void {
  const settings = new SettingsStore(db)
  for (const key of Object.values(LINEAR_CONFIG_KEYS)) {
    settings.delete(key)
  }
}

/**
 * Get the Linear API key using the provider-sources resolution chain.
 *
 * Resolution order:
 * 1. If a Linear provider source is configured, resolve its apiKeyRef
 *    (checks env var named apiKeyRef, then workspace_settings key named apiKeyRef)
 * 2. Legacy fallback: PRLT_LINEAR_API_KEY or LINEAR_API_KEY environment variables
 * 3. Legacy fallback: workspace_settings key 'linear.api_key'
 */
export function getLinearApiKey(db: SqliteDatabase): string | null {
  // 1. Try provider sources (supports custom apiKeyRef per source)
  try {
    const sources = loadProviderSources(db)
    for (const source of sources) {
      if (source.provider === 'linear') {
        const key = resolveApiKey(db, source)
        if (key) return key
      }
    }
  } catch {
    // Provider sources table may not exist in older databases
  }

  // 2. Legacy: environment variables
  const envKey = process.env.PRLT_LINEAR_API_KEY || process.env.LINEAR_API_KEY
  if (envKey) return envKey

  // 3. Legacy: stored workspace setting
  return new SettingsStore(db).get(LINEAR_CONFIG_KEYS.apiKey)
}

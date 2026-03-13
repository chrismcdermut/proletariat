/**
 * Linear Configuration Storage
 *
 * Stores Linear credentials and preferences in the workspace_settings table.
 */

import Database from 'better-sqlite3'
import type { LinearConfig } from './types.js'
import { loadProviderSources, resolveApiKey } from '../work-source/provider-sources.js'

const SETTINGS_TABLE = 'workspace_settings'

// Config keys stored in workspace_settings table
const LINEAR_CONFIG_KEYS = {
  apiKey: 'linear.api_key',
  defaultTeamId: 'linear.default_team_id',
  defaultTeamKey: 'linear.default_team_key',
  organizationName: 'linear.organization_name',
} as const

/**
 * Get a setting value from the database.
 */
function getSetting(db: Database.Database, key: string): string | null {
  const row = db
    .prepare(`SELECT value FROM ${SETTINGS_TABLE} WHERE key = ?`)
    .get(key) as { value: string } | undefined
  return row?.value ?? null
}

/**
 * Set a setting value in the database.
 */
function setSetting(db: Database.Database, key: string, value: string): void {
  db.prepare(`
    INSERT INTO ${SETTINGS_TABLE} (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value)
}

/**
 * Delete a setting from the database.
 */
function deleteSetting(db: Database.Database, key: string): void {
  db.prepare(`DELETE FROM ${SETTINGS_TABLE} WHERE key = ?`).run(key)
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Check if Linear is configured (API key is stored).
 */
export function isLinearConfigured(db: Database.Database): boolean {
  return getSetting(db, LINEAR_CONFIG_KEYS.apiKey) !== null
}

/**
 * Load Linear configuration from the database.
 * Returns null if not configured.
 */
export function loadLinearConfig(db: Database.Database): LinearConfig | null {
  const apiKey = getSetting(db, LINEAR_CONFIG_KEYS.apiKey)
  if (!apiKey) return null

  return {
    apiKey,
    defaultTeamId: getSetting(db, LINEAR_CONFIG_KEYS.defaultTeamId) ?? undefined,
    defaultTeamKey: getSetting(db, LINEAR_CONFIG_KEYS.defaultTeamKey) ?? undefined,
    organizationName: getSetting(db, LINEAR_CONFIG_KEYS.organizationName) ?? undefined,
  }
}

/**
 * Save Linear API key to the database.
 */
export function saveLinearApiKey(db: Database.Database, apiKey: string): void {
  setSetting(db, LINEAR_CONFIG_KEYS.apiKey, apiKey)
}

/**
 * Save the default team for Linear operations.
 */
export function saveLinearDefaultTeam(db: Database.Database, teamId: string, teamKey: string): void {
  setSetting(db, LINEAR_CONFIG_KEYS.defaultTeamId, teamId)
  setSetting(db, LINEAR_CONFIG_KEYS.defaultTeamKey, teamKey)
}

/**
 * Save the organization name.
 */
export function saveLinearOrganization(db: Database.Database, name: string): void {
  setSetting(db, LINEAR_CONFIG_KEYS.organizationName, name)
}

/**
 * Clear all Linear configuration from the database.
 */
export function clearLinearConfig(db: Database.Database): void {
  for (const key of Object.values(LINEAR_CONFIG_KEYS)) {
    deleteSetting(db, key)
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
export function getLinearApiKey(db: Database.Database): string | null {
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
  return getSetting(db, LINEAR_CONFIG_KEYS.apiKey)
}

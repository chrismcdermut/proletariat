/**
 * Linear Configuration Storage
 *
 * Stores Linear credentials and preferences in the workspace_settings table.
 */

import type Database from 'better-sqlite3'
import type { LinearConfig } from './types.js'
import { loadProviderSources, resolveApiKey } from '../work-source/provider-sources.js'
import { SettingsStore } from '../database/settings-store.js'
import { getCredential, setCredential, deleteCredential, hasCredential } from '../database/credential-store.js'

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
export function isLinearConfigured(db: Database.Database): boolean {
  return hasCredential(db, LINEAR_CONFIG_KEYS.apiKey)
}

/**
 * Load Linear configuration from the database.
 * Returns null if not configured.
 */
export function loadLinearConfig(db: Database.Database): LinearConfig | null {
  const apiKey = getCredential(db, LINEAR_CONFIG_KEYS.apiKey)
  if (!apiKey) return null

  const settings = new SettingsStore(db)
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
export function saveLinearApiKey(db: Database.Database, apiKey: string): void {
  setCredential(db, LINEAR_CONFIG_KEYS.apiKey, apiKey)
}

/**
 * Save the default team for Linear operations.
 */
export function saveLinearDefaultTeam(db: Database.Database, teamId: string, teamKey: string): void {
  const settings = new SettingsStore(db)
  settings.set(LINEAR_CONFIG_KEYS.defaultTeamId, teamId)
  settings.set(LINEAR_CONFIG_KEYS.defaultTeamKey, teamKey)
}

/**
 * Save the organization name.
 */
export function saveLinearOrganization(db: Database.Database, name: string): void {
  new SettingsStore(db).set(LINEAR_CONFIG_KEYS.organizationName, name)
}

/**
 * Clear all Linear configuration from the database.
 */
export function clearLinearConfig(db: Database.Database): void {
  const settings = new SettingsStore(db)
  for (const key of Object.values(LINEAR_CONFIG_KEYS)) {
    if (key === LINEAR_CONFIG_KEYS.apiKey) {
      deleteCredential(db, key)
    } else {
      settings.delete(key)
    }
  }
}

/**
 * Check if this HQ has a Linear team key configured in HQ-local storage.
 *
 * Only checks workspace_settings and provider_sources — NOT environment
 * variables, which may leak from another HQ session.
 * Used by auto-mode provider resolution to avoid cross-HQ fallback.
 */
export function hasLinearTeamConfig(db: Database.Database): boolean {
  const settings = new SettingsStore(db)
  const teamKey = settings.get(LINEAR_CONFIG_KEYS.defaultTeamKey)
  if (teamKey) return true

  // Also check provider sources
  try {
    const sources = loadProviderSources(db)
    for (const source of sources) {
      if (source.provider === 'linear' && source.teamProjectId) return true
    }
  } catch {
    // Provider sources table may not exist in older databases
  }

  return false
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

  // 3. Legacy: stored workspace setting (now in credentials.db)
  return getCredential(db, LINEAR_CONFIG_KEYS.apiKey)
}

/**
 * Resolve the Linear team key from all available sources.
 *
 * Resolution order:
 * 1. Explicit override (e.g. --team flag)
 * 2. Workspace settings (linear.default_team_key) — set by `prlt linear connect`
 * 3. Provider sources (teamProjectId) — set by `prlt work source set linear`
 * 4. PRLT_LINEAR_TEAM / LINEAR_TEAM_KEY environment variables
 */
export function resolveLinearTeamKey(db: Database.Database, override?: string): string | null {
  // 1. Explicit override
  if (override) return override

  // 2. Workspace settings
  const settings = new SettingsStore(db)
  const dbTeamKey = settings.get(LINEAR_CONFIG_KEYS.defaultTeamKey)
  if (dbTeamKey) return dbTeamKey

  // 3. Provider sources
  try {
    const sources = loadProviderSources(db)
    for (const source of sources) {
      if (source.provider === 'linear' && source.teamProjectId) {
        return source.teamProjectId
      }
    }
  } catch {
    // Provider sources table may not exist in older databases
  }

  // 4. Environment variables
  return process.env.PRLT_LINEAR_TEAM || process.env.LINEAR_TEAM_KEY || null
}

/**
 * GitHub Issues Configuration Storage
 *
 * Stores GitHub connection credentials and preferences in workspace_settings.
 * Token is stored in the credential store (not mounted into agent containers).
 */

import type Database from 'better-sqlite3'
import type { GitHubConfig } from './types.js'
import { loadProviderSources, resolveApiKey } from '../work-source/provider-sources.js'
import { SettingsStore } from '../database/settings-store.js'
import { getCredential, setCredential, deleteCredential, hasCredential } from '../database/credential-store.js'

const GITHUB_CONFIG_KEYS = {
  token: 'github.token',
  owner: 'github.owner',
  repo: 'github.repo',
  statusLabelPrefix: 'github.status_label_prefix',
} as const

// =============================================================================
// Public API
// =============================================================================

/**
 * Check if GitHub Issues is configured (token + owner + repo are stored).
 */
export function isGitHubConfigured(db: Database.Database): boolean {
  if (!hasCredential(db, GITHUB_CONFIG_KEYS.token)) {
    // Also check GITHUB_TOKEN env var
    if (!process.env.GITHUB_TOKEN) return false
  }
  const settings = new SettingsStore(db)
  return !!settings.get(GITHUB_CONFIG_KEYS.owner) && !!settings.get(GITHUB_CONFIG_KEYS.repo)
}

/**
 * Load GitHub configuration from the database.
 * Returns null if not configured.
 */
export function loadGitHubConfig(db: Database.Database): GitHubConfig | null {
  const token = getGitHubToken(db)
  if (!token) return null

  const settings = new SettingsStore(db)
  const owner = settings.get(GITHUB_CONFIG_KEYS.owner)
  const repo = settings.get(GITHUB_CONFIG_KEYS.repo)

  if (!owner || !repo) return null

  return {
    token,
    owner,
    repo,
    statusLabelPrefix: settings.get(GITHUB_CONFIG_KEYS.statusLabelPrefix) ?? undefined,
  }
}

/**
 * Save GitHub token to the credential store.
 */
export function saveGitHubToken(db: Database.Database, token: string): void {
  setCredential(db, GITHUB_CONFIG_KEYS.token, token)
}

/**
 * Save the GitHub repo configuration.
 */
export function saveGitHubRepo(db: Database.Database, owner: string, repo: string): void {
  const settings = new SettingsStore(db)
  settings.set(GITHUB_CONFIG_KEYS.owner, owner)
  settings.set(GITHUB_CONFIG_KEYS.repo, repo)
}

/**
 * Save the status label prefix.
 */
export function saveGitHubStatusLabelPrefix(db: Database.Database, prefix: string): void {
  new SettingsStore(db).set(GITHUB_CONFIG_KEYS.statusLabelPrefix, prefix)
}

/**
 * Clear all GitHub configuration from the database.
 */
export function clearGitHubConfig(db: Database.Database): void {
  const settings = new SettingsStore(db)
  for (const key of Object.values(GITHUB_CONFIG_KEYS)) {
    if (key === GITHUB_CONFIG_KEYS.token) {
      deleteCredential(db, key)
    } else {
      settings.delete(key)
    }
  }
}

/**
 * Get the GitHub token using the provider-sources resolution chain.
 *
 * Resolution order:
 * 1. If a GitHub provider source is configured, resolve its apiKeyRef
 * 2. GITHUB_TOKEN environment variable
 * 3. Credential store key 'github.token'
 */
export function getGitHubToken(db: Database.Database): string | null {
  // 1. Try provider sources (supports custom apiKeyRef per source)
  try {
    const sources = loadProviderSources(db)
    for (const source of sources) {
      if (source.provider === 'github') {
        const key = resolveApiKey(db, source)
        if (key) return key
      }
    }
  } catch {
    // Provider sources table may not exist in older databases
  }

  // 2. GITHUB_TOKEN environment variable
  const envToken = process.env.GITHUB_TOKEN
  if (envToken) return envToken

  // 3. Stored credential
  return getCredential(db, GITHUB_CONFIG_KEYS.token)
}

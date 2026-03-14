import Database from 'better-sqlite3'
import type { AsanaConfig } from './types.js'
import { loadProviderSources, resolveApiKey } from '../work-source/provider-sources.js'

const SETTINGS_TABLE = 'workspace_settings'

/** Default environment variable name used as apiKeyRef for Asana provider sources. */
export const ASANA_ACCESS_TOKEN_ENV_VAR = 'PRLT_ASANA_ACCESS_TOKEN'

const ASANA_CONFIG_KEYS = {
  accessToken: 'asana.access_token',
  workspaceGid: 'asana.workspace_gid',
  workspaceName: 'asana.workspace_name',
  projectGid: 'asana.project_gid',
  projectName: 'asana.project_name',
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

/**
 * Check if Asana is configured (access token is available via any resolution path).
 */
export function isAsanaConfigured(db: Database.Database): boolean {
  return getAsanaAccessToken(db) !== null
}

/**
 * Load Asana configuration by resolving the access token through the provider-sources
 * chain (provider source apiKeyRef → legacy env vars → legacy DB key).
 * Returns null if no access token can be resolved.
 */
export function loadAsanaConfig(db: Database.Database): AsanaConfig | null {
  const accessToken = getAsanaAccessToken(db)
  if (!accessToken) return null

  return {
    accessToken,
    workspaceGid: getSetting(db, ASANA_CONFIG_KEYS.workspaceGid) ?? undefined,
    workspaceName: getSetting(db, ASANA_CONFIG_KEYS.workspaceName) ?? undefined,
    projectGid: getSetting(db, ASANA_CONFIG_KEYS.projectGid) ?? undefined,
    projectName: getSetting(db, ASANA_CONFIG_KEYS.projectName) ?? undefined,
  }
}

export function saveAsanaAccessToken(db: Database.Database, accessToken: string): void {
  setSetting(db, ASANA_CONFIG_KEYS.accessToken, accessToken)
}

export function saveAsanaWorkspace(db: Database.Database, workspaceGid: string, workspaceName: string): void {
  setSetting(db, ASANA_CONFIG_KEYS.workspaceGid, workspaceGid)
  setSetting(db, ASANA_CONFIG_KEYS.workspaceName, workspaceName)
}

export function saveAsanaProject(db: Database.Database, projectGid: string, projectName: string): void {
  setSetting(db, ASANA_CONFIG_KEYS.projectGid, projectGid)
  setSetting(db, ASANA_CONFIG_KEYS.projectName, projectName)
}

export function clearAsanaConfig(db: Database.Database): void {
  for (const key of Object.values(ASANA_CONFIG_KEYS)) {
    deleteSetting(db, key)
  }
}

export function getAsanaAccessToken(db: Database.Database): string | null {
  // 1. Try provider sources (supports custom apiKeyRef per source)
  try {
    const sources = loadProviderSources(db)
    for (const source of sources) {
      if (source.provider === 'asana') {
        const key = resolveApiKey(db, source)
        if (key) return key
      }
    }
  } catch {
    // Provider sources may not exist in older databases
  }

  // 2. Legacy: environment variables
  const envToken = process.env.PRLT_ASANA_ACCESS_TOKEN || process.env.ASANA_ACCESS_TOKEN
  if (envToken) return envToken

  // 3. Legacy: stored workspace setting
  return getSetting(db, ASANA_CONFIG_KEYS.accessToken)
}

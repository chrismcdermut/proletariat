import type { SqliteDatabase } from '../database/sqlite.js'
import type { AsanaConfig } from './types.js'
import { loadProviderSources, resolveApiKey } from '../work-source/provider-sources.js'
import { SettingsStore } from '../database/settings-store.js'

const ASANA_CONFIG_KEYS = {
  accessToken: 'asana.access_token',
  workspaceGid: 'asana.workspace_gid',
  workspaceName: 'asana.workspace_name',
  projectGid: 'asana.project_gid',
  projectName: 'asana.project_name',
} as const

export function isAsanaConfigured(db: SqliteDatabase): boolean {
  return new SettingsStore(db).has(ASANA_CONFIG_KEYS.accessToken)
}

export function loadAsanaConfig(db: SqliteDatabase): AsanaConfig | null {
  const settings = new SettingsStore(db)
  const accessToken = settings.get(ASANA_CONFIG_KEYS.accessToken)
  if (!accessToken) return null

  return {
    accessToken,
    workspaceGid: settings.get(ASANA_CONFIG_KEYS.workspaceGid) ?? undefined,
    workspaceName: settings.get(ASANA_CONFIG_KEYS.workspaceName) ?? undefined,
    projectGid: settings.get(ASANA_CONFIG_KEYS.projectGid) ?? undefined,
    projectName: settings.get(ASANA_CONFIG_KEYS.projectName) ?? undefined,
  }
}

export function saveAsanaAccessToken(db: SqliteDatabase, accessToken: string): void {
  new SettingsStore(db).set(ASANA_CONFIG_KEYS.accessToken, accessToken)
}

export function saveAsanaWorkspace(db: SqliteDatabase, workspaceGid: string, workspaceName: string): void {
  const settings = new SettingsStore(db)
  settings.set(ASANA_CONFIG_KEYS.workspaceGid, workspaceGid)
  settings.set(ASANA_CONFIG_KEYS.workspaceName, workspaceName)
}

export function saveAsanaProject(db: SqliteDatabase, projectGid: string, projectName: string): void {
  const settings = new SettingsStore(db)
  settings.set(ASANA_CONFIG_KEYS.projectGid, projectGid)
  settings.set(ASANA_CONFIG_KEYS.projectName, projectName)
}

export function clearAsanaConfig(db: SqliteDatabase): void {
  const settings = new SettingsStore(db)
  for (const key of Object.values(ASANA_CONFIG_KEYS)) {
    settings.delete(key)
  }
}

export function getAsanaAccessToken(db: SqliteDatabase): string | null {
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
  return new SettingsStore(db).get(ASANA_CONFIG_KEYS.accessToken)
}

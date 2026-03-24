import type Database from 'better-sqlite3'
import type { AsanaConfig } from './types.js'
import { loadProviderSources, resolveApiKey } from '../work-source/provider-sources.js'
import { SettingsStore } from '../database/settings-store.js'
import { getCredential, setCredential, deleteCredential, hasCredential } from '../database/credential-store.js'

const ASANA_CONFIG_KEYS = {
  accessToken: 'asana.access_token',
  workspaceGid: 'asana.workspace_gid',
  workspaceName: 'asana.workspace_name',
  projectGid: 'asana.project_gid',
  projectName: 'asana.project_name',
} as const

export function isAsanaConfigured(db: Database.Database): boolean {
  return hasCredential(db, ASANA_CONFIG_KEYS.accessToken)
}

export function loadAsanaConfig(db: Database.Database): AsanaConfig | null {
  const accessToken = getCredential(db, ASANA_CONFIG_KEYS.accessToken)
  if (!accessToken) return null

  const settings = new SettingsStore(db)
  return {
    accessToken,
    workspaceGid: settings.get(ASANA_CONFIG_KEYS.workspaceGid) ?? undefined,
    workspaceName: settings.get(ASANA_CONFIG_KEYS.workspaceName) ?? undefined,
    projectGid: settings.get(ASANA_CONFIG_KEYS.projectGid) ?? undefined,
    projectName: settings.get(ASANA_CONFIG_KEYS.projectName) ?? undefined,
  }
}

export function saveAsanaAccessToken(db: Database.Database, accessToken: string): void {
  setCredential(db, ASANA_CONFIG_KEYS.accessToken, accessToken)
}

export function saveAsanaWorkspace(db: Database.Database, workspaceGid: string, workspaceName: string): void {
  const settings = new SettingsStore(db)
  settings.set(ASANA_CONFIG_KEYS.workspaceGid, workspaceGid)
  settings.set(ASANA_CONFIG_KEYS.workspaceName, workspaceName)
}

export function saveAsanaProject(db: Database.Database, projectGid: string, projectName: string): void {
  const settings = new SettingsStore(db)
  settings.set(ASANA_CONFIG_KEYS.projectGid, projectGid)
  settings.set(ASANA_CONFIG_KEYS.projectName, projectName)
}

export function clearAsanaConfig(db: Database.Database): void {
  const settings = new SettingsStore(db)
  for (const key of Object.values(ASANA_CONFIG_KEYS)) {
    if (key === ASANA_CONFIG_KEYS.accessToken) {
      deleteCredential(db, key)
    } else {
      settings.delete(key)
    }
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

  // 3. Legacy: stored workspace setting (now in credentials.db)
  return getCredential(db, ASANA_CONFIG_KEYS.accessToken)
}
